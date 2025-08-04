const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

let polls = []; // This will store all polls in history
let students = new Map();
let chatMessages = [];

// API endpoint to check if a name is already taken
app.post('/check-name', (req, res) => {
  const { name } = req.body;
  const isNameTaken = Array.from(students.values()).some(student => student.name === name);
  res.json({ available: !isNameTaken });
});

io.on('connection', (socket) => {
  socket.on('join-teacher', () => {
    socket.join('teachers');
    socket.emit('poll-history', polls); // Send all polls to teacher
    socket.emit('students-list', Array.from(students.values()));
    socket.emit('chat-history', chatMessages);
  });

  socket.on('join-student', ({ name }) => {
    // Check if name is already taken
    const isNameTaken = Array.from(students.values()).some(student => student.name === name);
    if (isNameTaken) {
      socket.emit('name-taken');
      return;
    }
    
    students.set(socket.id, { id: socket.id, name, answered: {} });
    socket.join('students');
    socket.emit('poll-history', polls); // Send all polls to student
    socket.emit('chat-history', chatMessages);
    io.to('teachers').emit('students-list', Array.from(students.values()));
  });

  socket.on('create-poll', ({ question, options, correctOption, timeLimit }) => {
    // Close any existing active poll
    polls.forEach(poll => {
      if (poll.isActive) {
        poll.isActive = false;
      }
    });
    
    const poll = {
      id: uuidv4(),
      question,
      options: options.map((text, i) => ({ 
        id: i, 
        text, 
        votes: 0, 
        voters: [],
        isCorrect: correctOption === i
      })),
      isActive: true,
      timeLimit: timeLimit || 60,
      createdAt: Date.now(),
      correctSet: correctOption !== null,
      correctOption: correctOption
    };
    polls.push(poll);
    io.emit('poll-history', polls); // Broadcast updated poll history

    setTimeout(() => {
      const p = polls.find(x => x.id === poll.id);
      if (p && p.isActive) {
        p.isActive = false;
        io.emit('poll-history', polls); // Broadcast when poll becomes inactive
      }
    }, poll.timeLimit * 1000);
  });

  socket.on('submit-answer', ({ pollId, optionId }) => {
    const poll = polls.find(p => p.id === pollId && p.isActive);
    const student = students.get(socket.id);
    if (!poll || !student) return;
    if (student.answered[pollId]) {
      socket.emit('answer-error', 'Already answered');
      return;
    }
    const opt = poll.options.find(o => o.id === optionId);
    if (!opt) return;
    opt.votes++;
    opt.voters.push(student.name);
    student.answered[pollId] = true;
    students.set(socket.id, student);
    io.emit('poll-history', polls); // Broadcast updated results
    socket.emit('answer-success', pollId);
    io.to('teachers').emit('students-list', Array.from(students.values()));
  });

  socket.on('remove-student', id => {
    if (students.has(id)) {
      students.delete(id);
      io.to(id).emit('kicked');
      io.to('teachers').emit('students-list', Array.from(students.values()));
    }
  });

  socket.on('send-message', msg => {
    const m = { id: uuidv4(), ...msg, timestamp: Date.now() };
    chatMessages.push(m);
    if (chatMessages.length > 50) chatMessages.shift();
    io.emit('new-message', m);
  });

  socket.on('disconnect', () => {
    students.delete(socket.id);
    io.to('teachers').emit('students-list', Array.from(students.values()));
  });
});

server.listen(3001, () => console.log('Listening on 3001'));
