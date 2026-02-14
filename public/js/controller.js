const socket = io();

// ===== State =====
let localState = null;

// ===== DOM Elements =====
const statusBar = document.getElementById('statusBar');
const statusText = document.getElementById('statusText');
const playerAInput = document.getElementById('playerAInput');
const playerBInput = document.getElementById('playerBInput');
const scorePlayerA = document.getElementById('scorePlayerA');
const scorePlayerB = document.getElementById('scorePlayerB');
const scoreA = document.getElementById('scoreA');
const scoreB = document.getElementById('scoreB');
const questionSection = document.getElementById('questionSection');
const questionPreview = document.getElementById('questionPreview');
const answerPreview = document.getElementById('answerPreview');
const btnAnswer = document.getElementById('btnAnswer');
const importStatus = document.getElementById('importStatus');

// ===== Connection =====
socket.on('connect', () => {
    statusBar.classList.add('connected');
    statusText.textContent = 'Đã kết nối';
});

socket.on('disconnect', () => {
    statusBar.classList.remove('connected');
    statusText.textContent = 'Mất kết nối...';
});

// ===== State Updates =====
socket.on('state-update', (state) => {
    localState = state;
    updateUI(state);
});

function updateUI(state) {
    // Player names
    if (document.activeElement !== playerAInput) {
        playerAInput.value = state.players[0].name;
    }
    if (document.activeElement !== playerBInput) {
        playerBInput.value = state.players[1].name;
    }

    scorePlayerA.textContent = state.players[0].name;
    scorePlayerB.textContent = state.players[1].name;

    // Scores
    scoreA.textContent = state.players[0].score;
    scoreB.textContent = state.players[1].score;

    // Questions - show section if questions loaded
    if (state.questions.length > 0) {
        questionSection.style.display = '';

        if (state.currentQuestionIndex >= 0) {
            const q = state.questions[state.currentQuestionIndex];
            questionPreview.textContent = q.question;

            if (state.showAnswer && q.answer) {
                answerPreview.textContent = '🔑 ' + q.answer;
                answerPreview.classList.remove('hidden');
                btnAnswer.textContent = '🙈 Ẩn đáp án';
                btnAnswer.classList.add('shown');
            } else {
                answerPreview.classList.add('hidden');
                btnAnswer.textContent = '👁 Hiện đáp án';
                btnAnswer.classList.remove('shown');
            }
        } else {
            questionPreview.textContent = 'Nhấn "Câu hỏi" để bắt đầu';
            answerPreview.classList.add('hidden');
        }
    } else {
        questionSection.style.display = 'none';
    }
}

// ===== Player Names =====
let nameTimeout;
playerAInput.addEventListener('input', () => {
    clearTimeout(nameTimeout);
    nameTimeout = setTimeout(() => {
        socket.emit('update-player-name', { index: 0, name: playerAInput.value || 'A' });
    }, 300);
});

playerBInput.addEventListener('input', () => {
    clearTimeout(nameTimeout);
    nameTimeout = setTimeout(() => {
        socket.emit('update-player-name', { index: 1, name: playerBInput.value || 'B' });
    }, 300);
});

// ===== Score Control =====
function addScore(playerIndex, delta) {
    socket.emit('update-score', { index: playerIndex, delta });
}

// ===== Question Control =====
function randomQuestion() {
    socket.emit('random-question');
}

function toggleAnswer() {
    socket.emit('toggle-answer');
}

// ===== Import: Tab Switch =====
function switchTab(tab) {
    document.getElementById('tabSheet').classList.toggle('active', tab === 'sheet');
    document.getElementById('tabExcel').classList.toggle('active', tab === 'excel');
    document.getElementById('sheetContent').classList.toggle('hidden', tab !== 'sheet');
    document.getElementById('excelContent').classList.toggle('hidden', tab !== 'excel');
}

// ===== Import: Google Sheets =====
async function importSheet() {
    const url = document.getElementById('sheetUrl').value.trim();
    if (!url) {
        showImportStatus('Vui lòng nhập link Google Sheets', 'error');
        return;
    }

    showImportStatus('Đang tải...', '');

    try {
        const csvUrl = convertToCsvUrl(url);
        if (!csvUrl) {
            showImportStatus('Link không hợp lệ. Hãy dùng link Google Sheets public.', 'error');
            return;
        }

        const response = await fetch(csvUrl);
        if (!response.ok) throw new Error('Không thể tải sheet. Hãy đảm bảo sheet được public.');

        const csv = await response.text();
        const questions = parseCsv(csv);

        if (questions.length === 0) {
            showImportStatus('Không tìm thấy câu hỏi trong sheet', 'error');
            return;
        }

        const res = await fetch('/api/import-sheet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ questions })
        });

        const data = await res.json();
        if (data.success) {
            showImportStatus(`✅ Đã import ${data.count} câu hỏi`, 'success');
        } else {
            showImportStatus(data.error || 'Lỗi import', 'error');
        }
    } catch (err) {
        console.error(err);
        showImportStatus('Lỗi: ' + err.message, 'error');
    }
}

function convertToCsvUrl(url) {
    let match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (match) {
        const id = match[1];
        const gidMatch = url.match(/gid=(\d+)/);
        const gid = gidMatch ? gidMatch[1] : '0';
        return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
    }
    return null;
}

function parseCsv(csv) {
    const lines = csv.split('\n').map(line => {
        const fields = [];
        let field = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch === ',' && !inQuotes) {
                fields.push(field.trim());
                field = '';
            } else {
                field += ch;
            }
        }
        fields.push(field.trim());
        return fields;
    }).filter(f => f.length > 0);

    if (lines.length < 2) return [];

    const header = lines[0];
    let qCol = -1, aCol = -1;

    for (let i = 0; i < header.length; i++) {
        const h = header[i].toLowerCase();
        if (qCol === -1 && (h.includes('câu hỏi') || h.includes('question') || h.includes('cau hoi') || h === 'q')) {
            qCol = i;
        }
        if (aCol === -1 && (h.includes('đáp án') || h.includes('answer') || h.includes('dap an') || h === 'a' || h.includes('trả lời'))) {
            aCol = i;
        }
    }

    if (qCol === -1) qCol = 0;
    if (aCol === -1) aCol = Math.min(1, header.length - 1);

    const questions = [];
    for (let i = 1; i < lines.length; i++) {
        const row = lines[i];
        const question = (row[qCol] || '').trim();
        const answer = (row[aCol] || '').trim();
        if (question) {
            questions.push({ question, answer });
        }
    }

    return questions;
}

// ===== Import: Excel Upload =====
let selectedFile = null;

function handleFileSelect(event) {
    selectedFile = event.target.files[0];
    const label = document.getElementById('fileLabel');
    if (selectedFile) {
        label.classList.add('has-file');
        label.querySelector('span').textContent = '📄 ' + selectedFile.name;
    }
}

async function uploadExcel() {
    if (!selectedFile) {
        showImportStatus('Vui lòng chọn file trước', 'error');
        return;
    }

    showImportStatus('Đang tải lên...', '');

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
        const res = await fetch('/api/upload-excel', {
            method: 'POST',
            body: formData
        });

        const data = await res.json();
        if (data.success) {
            showImportStatus(`✅ Đã import ${data.count} câu hỏi`, 'success');
        } else {
            showImportStatus(data.error || 'Lỗi upload', 'error');
        }
    } catch (err) {
        showImportStatus('Lỗi: ' + err.message, 'error');
    }
}

// ===== Reset =====
function resetGame() {
    if (confirm('Reset điểm và bộ đếm câu hỏi về 0?')) {
        socket.emit('reset');
    }
}

// ===== Room PIN =====
function generatePin() {
    socket.emit('generate-pin');
}

socket.on('pin-created', ({ pin }) => {
    const pinDisplay = document.getElementById('pinDisplay');
    const pinCode = document.getElementById('pinCode');
    pinDisplay.classList.remove('hidden');
    pinCode.textContent = pin;
});

socket.on('room-status', ({ slots }) => {
    const slot0 = document.getElementById('slot0');
    const slot1 = document.getElementById('slot1');
    const nameA = localState ? localState.players[0].name : 'Player 1';
    const nameB = localState ? localState.players[1].name : 'Player 2';
    slot0.textContent = slots[0] ? `✅ ${nameA}: đã vào` : `⬜ ${nameA}: chưa vào`;
    slot0.className = 'slot' + (slots[0] ? ' slot-filled' : '');
    slot1.textContent = slots[1] ? `✅ ${nameB}: đã vào` : `⬜ ${nameB}: chưa vào`;
    slot1.className = 'slot' + (slots[1] ? ' slot-filled' : '');
});

// ===== Helpers =====
function showImportStatus(text, type) {
    importStatus.textContent = text;
    importStatus.className = 'import-status ' + (type || '');
}
