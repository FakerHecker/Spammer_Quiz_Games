const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// In-memory file upload
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Shuffle array (Fisher-Yates)
function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Game state (single source of truth)
let gameState = {
    players: [
        { name: 'A', score: 0 },
        { name: 'B', score: 0 }
    ],
    questionSets: [],       // Array of { id, source, type, questions[], count }
    questions: [],           // Flattened + shuffled from all sets
    usedQuestions: [],
    currentQuestionIndex: -1,
    questionCount: 0,
    showAnswer: false,
    buzzer: {
        active: false,
        winner: -1
    }
};

let nextSetId = 1;

// Rebuild flat questions array from all question sets
function rebuildQuestions() {
    const all = [];
    for (const set of gameState.questionSets) {
        all.push(...set.questions);
    }
    gameState.questions = shuffleArray(all);
    gameState.usedQuestions = [];
    gameState.currentQuestionIndex = -1;
    gameState.questionCount = 0;
    gameState.showAnswer = false;
    gameState.buzzer = { active: false, winner: -1 };
}

// Room PIN & buzzer player tracking
let roomPin = null; // null = no room created
const buzzerPlayers = {}; // socketId -> playerIndex (0 or 1)
const buzzerSlots = { 0: null, 1: null }; // playerIndex -> socketId

// API: Upload Excel file(s) and parse questions (supports multiple files)
app.post('/api/upload-excel', upload.array('files', 20), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        let totalNewQuestions = 0;
        const fileResults = [];

        for (const file of req.files) {
            const workbook = XLSX.read(file.buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            const questions = parseQuestions(data);

            if (questions.length > 0) {
                const setId = nextSetId++;
                gameState.questionSets.push({
                    id: setId,
                    source: file.originalname,
                    type: 'excel',
                    questions,
                    count: questions.length
                });
                totalNewQuestions += questions.length;
                fileResults.push({ id: setId, name: file.originalname, count: questions.length });
            }
        }

        if (totalNewQuestions === 0) {
            return res.status(400).json({ error: 'Không tìm thấy câu hỏi trong các file' });
        }

        rebuildQuestions();
        io.emit('state-update', gameState);
        res.json({ success: true, count: totalNewQuestions, files: fileResults });
    } catch (err) {
        console.error('Excel parse error:', err);
        res.status(500).json({ error: 'Lỗi đọc file Excel' });
    }
});

// API: Parse Google Sheets CSV
app.post('/api/import-sheet', express.json(), (req, res) => {
    const { questions, sourceName } = req.body;
    if (!questions || questions.length === 0) {
        return res.status(400).json({ error: 'Không có câu hỏi' });
    }

    const setId = nextSetId++;
    gameState.questionSets.push({
        id: setId,
        source: sourceName || 'Google Sheets',
        type: 'sheet',
        questions,
        count: questions.length
    });

    rebuildQuestions();
    io.emit('state-update', gameState);
    res.json({ success: true, count: questions.length, setId });
});

// Parse questions from 2D array data
function parseQuestions(data) {
    if (!data || data.length === 0) return [];

    const questions = [];
    const headerRow = data[0];

    // Try to find question and answer columns
    let qCol = -1, aCol = -1;

    if (headerRow) {
        for (let i = 0; i < headerRow.length; i++) {
            const h = String(headerRow[i] || '').toLowerCase().trim();
            if (qCol === -1 && (h.includes('câu hỏi') || h.includes('question') || h.includes('cau hoi') || h === 'q')) {
                qCol = i;
            }
            if (aCol === -1 && (h.includes('đáp án') || h.includes('answer') || h.includes('dap an') || h === 'a' || h.includes('trả lời'))) {
                aCol = i;
            }
        }
    }

    // Fallback: first column = question, second column = answer
    if (qCol === -1) qCol = 0;
    if (aCol === -1) aCol = 1;

    const startRow = (qCol === 0 && aCol === 1 && headerRow && isNaN(Number(headerRow[0]))) ? 1 : 0;

    for (let i = startRow; i < data.length; i++) {
        const row = data[i];
        if (!row || !row[qCol]) continue;

        const question = String(row[qCol]).trim();
        const answer = row[aCol] !== undefined ? String(row[aCol]).trim() : '';

        if (question) {
            questions.push({ question, answer });
        }
    }

    return questions;
}

// Socket.io
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Send current state to newly connected client
    socket.emit('state-update', gameState);

    // Update player name
    socket.on('update-player-name', ({ index, name }) => {
        if (index >= 0 && index < gameState.players.length) {
            gameState.players[index].name = name;
            io.emit('state-update', gameState);
        }
    });

    // Update score
    socket.on('update-score', ({ index, delta }) => {
        if (index >= 0 && index < gameState.players.length) {
            gameState.players[index].score += delta;
            io.emit('state-update', gameState);
            io.emit('score-animation', { index, delta });
        }
    });

    // Random question (no repeats) + activate buzzer
    socket.on('random-question', () => {
        if (gameState.questions.length === 0) return;

        // Find available (unused) question indices
        const available = gameState.questions
            .map((_, i) => i)
            .filter(i => !gameState.usedQuestions.includes(i));

        if (available.length === 0) return; // All questions used

        const pick = available[Math.floor(Math.random() * available.length)];
        gameState.currentQuestionIndex = pick;
        gameState.usedQuestions.push(pick);
        gameState.questionCount += 1;
        gameState.showAnswer = false;
        // Activate buzzer
        gameState.buzzer = { active: true, winner: -1 };
        io.emit('state-update', gameState);
    });

    // Buzzer press
    socket.on('buzzer-press', ({ playerIndex }) => {
        if (!gameState.buzzer.active) return;
        if (gameState.buzzer.winner !== -1) return; // Already buzzed
        if (playerIndex !== 0 && playerIndex !== 1) return;

        gameState.buzzer.winner = playerIndex;
        gameState.buzzer.active = false;
        io.emit('state-update', gameState);
        io.emit('buzzer-winner', { playerIndex, playerName: gameState.players[playerIndex].name });
    });

    // Generate room PIN (from controller) — also resets scores/counter
    socket.on('generate-pin', () => {
        roomPin = String(Math.floor(1000 + Math.random() * 9000)); // 4-digit
        // Kick existing buzzer players
        Object.keys(buzzerPlayers).forEach(sid => {
            const s = io.sockets.sockets.get(sid);
            if (s) s.emit('kicked', { reason: 'Phòng mới đã được tạo' });
        });
        // Clear slots
        Object.keys(buzzerPlayers).forEach(k => delete buzzerPlayers[k]);
        buzzerSlots[0] = null;
        buzzerSlots[1] = null;

        // Reset scores and counter
        gameState.players.forEach(p => p.score = 0);
        gameState.questionCount = 0;
        gameState.currentQuestionIndex = -1;
        gameState.showAnswer = false;
        gameState.buzzer = { active: false, winner: -1 };

        socket.emit('pin-created', { pin: roomPin });
        io.emit('room-pin', { pin: roomPin });
        io.emit('room-status', { slots: { 0: !!buzzerSlots[0], 1: !!buzzerSlots[1] } });
        io.emit('state-update', gameState);
    });

    // Register buzzer player (with PIN + name, auto-assign slot)
    socket.on('register-buzzer', ({ pin, name }) => {
        // Validate PIN
        if (!roomPin || pin !== roomPin) {
            socket.emit('buzzer-error', { message: 'Mã PIN không đúng' });
            return;
        }
        if (!name || !name.trim()) {
            socket.emit('buzzer-error', { message: 'Vui lòng nhập tên' });
            return;
        }

        // Check if this socket is already registered
        if (buzzerPlayers[socket.id] !== undefined) {
            const existingIndex = buzzerPlayers[socket.id];
            // Update name
            gameState.players[existingIndex].name = name.trim();
            io.emit('state-update', gameState);
            socket.emit('buzzer-registered', { playerIndex: existingIndex, playerName: name.trim() });
            return;
        }

        // Auto-assign to next available slot
        let assignedIndex = -1;
        if (buzzerSlots[0] === null) {
            assignedIndex = 0;
        } else if (buzzerSlots[1] === null) {
            assignedIndex = 1;
        } else {
            socket.emit('buzzer-error', { message: 'Phòng đã đầy (2/2 người chơi)' });
            return;
        }

        // Register
        buzzerPlayers[socket.id] = assignedIndex;
        buzzerSlots[assignedIndex] = socket.id;

        // Update player name
        gameState.players[assignedIndex].name = name.trim();
        io.emit('state-update', gameState);

        socket.emit('buzzer-registered', { playerIndex: assignedIndex, playerName: name.trim() });
        io.emit('room-status', { slots: { 0: !!buzzerSlots[0], 1: !!buzzerSlots[1] } });
    });

    // Toggle answer visibility
    socket.on('toggle-answer', () => {
        gameState.showAnswer = !gameState.showAnswer;
        io.emit('state-update', gameState);
    });

    // Reset (scores + counter only, keep used questions)
    socket.on('reset', () => {
        gameState.players.forEach(p => p.score = 0);
        gameState.questionCount = 0;
        gameState.currentQuestionIndex = -1;
        gameState.showAnswer = false;
        gameState.buzzer = { active: false, winner: -1 };
        io.emit('state-update', gameState);
    });

    // Delete a specific question set
    socket.on('delete-question-set', ({ setId }) => {
        const idx = gameState.questionSets.findIndex(s => s.id === setId);
        if (idx === -1) return;
        gameState.questionSets.splice(idx, 1);
        rebuildQuestions();
        io.emit('state-update', gameState);
    });

    // Full reset — everything back to initial state
    socket.on('full-reset', () => {
        // Reset game state
        gameState.players = [
            { name: 'A', score: 0 },
            { name: 'B', score: 0 }
        ];
        gameState.questionSets = [];
        gameState.questions = [];
        gameState.usedQuestions = [];
        gameState.currentQuestionIndex = -1;
        gameState.questionCount = 0;
        gameState.showAnswer = false;
        gameState.buzzer = { active: false, winner: -1 };

        // Clear room
        roomPin = null;
        // Kick buzzer players
        Object.keys(buzzerPlayers).forEach(sid => {
            const s = io.sockets.sockets.get(sid);
            if (s) s.emit('kicked', { reason: 'Trò chơi đã được reset toàn bộ' });
        });
        Object.keys(buzzerPlayers).forEach(k => delete buzzerPlayers[k]);
        buzzerSlots[0] = null;
        buzzerSlots[1] = null;

        io.emit('state-update', gameState);
        io.emit('room-pin', { pin: '----' });
        io.emit('room-status', { slots: { 0: false, 1: false } });
    });

    socket.on('disconnect', () => {
        // Free buzzer slot
        const playerIndex = buzzerPlayers[socket.id];
        if (playerIndex !== undefined) {
            buzzerSlots[playerIndex] = null;
            delete buzzerPlayers[socket.id];
            io.emit('room-status', { slots: { 0: !!buzzerSlots[0], 1: !!buzzerSlots[1] } });
        }
        console.log('Client disconnected:', socket.id);
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔══════════════════════════════════════════════╗
║         🎮 Quiz Game Server Started          ║
╠══════════════════════════════════════════════╣
║                                              ║
║  Display:    http://localhost:${PORT}/display.html    ║
║  Controller: http://localhost:${PORT}/controller.html ║
║  Buzzer:     http://localhost:${PORT}/buzzer.html     ║
║                                              ║
║  Mở controller trên điện thoại:              ║
║  → Dùng cùng WiFi, truy cập IP máy tính     ║
║                                              ║
╚══════════════════════════════════════════════╝
  `);
});
