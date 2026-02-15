const socket = io();

// ===== State =====
let localState = null;

// ===== LocalStorage Keys =====
const LS_KEYS = {
    SHEET_URL: 'quiz_sheetUrl',
    ACTIVE_TAB: 'quiz_activeTab',
    IMPORT_STATUS: 'quiz_importStatus',
    IMPORT_STATUS_TYPE: 'quiz_importStatusType'
};

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

    // Render question sets from server state
    renderQuestionSets(state);
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
    // Save active tab
    localStorage.setItem(LS_KEYS.ACTIVE_TAB, tab);
}

// ===== Import: Google Sheets =====
const sheetUrlInput = document.getElementById('sheetUrl');
// Save sheet URL on change
sheetUrlInput.addEventListener('input', () => {
    localStorage.setItem(LS_KEYS.SHEET_URL, sheetUrlInput.value);
});

async function importSheet() {
    const url = sheetUrlInput.value.trim();
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
            body: JSON.stringify({ questions, sourceName: url })
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

// ===== Import: Excel Upload (Multiple Files) =====
let selectedFiles = [];

function handleFileSelect(event) {
    selectedFiles = Array.from(event.target.files);
    const label = document.getElementById('fileLabel');
    const filesDiv = document.getElementById('selectedFiles');

    if (selectedFiles.length > 0) {
        label.classList.add('has-file');
        label.querySelector('span').textContent = `📄 Đã chọn ${selectedFiles.length} file`;
        filesDiv.innerHTML = selectedFiles.map((f, i) =>
            `<div class="file-item">📄 ${f.name} <span class="file-size">(${(f.size / 1024).toFixed(1)} KB)</span></div>`
        ).join('');
    } else {
        label.classList.remove('has-file');
        label.querySelector('span').textContent = '📁 Chọn file Excel / CSV (nhiều file)';
        filesDiv.innerHTML = '';
    }
}

async function uploadExcel() {
    if (selectedFiles.length === 0) {
        showImportStatus('Vui lòng chọn file trước', 'error');
        return;
    }

    showImportStatus(`Đang tải lên ${selectedFiles.length} file...`, '');

    const formData = new FormData();
    selectedFiles.forEach(file => {
        formData.append('files', file);
    });

    try {
        const res = await fetch('/api/upload-excel', {
            method: 'POST',
            body: formData
        });

        const data = await res.json();
        if (data.success) {
            let msg = `✅ Đã import ${data.count} câu hỏi`;
            if (data.files && data.files.length > 1) {
                msg += ' từ ' + data.files.length + ' file:\n';
                msg += data.files.map(f => `  • ${f.name}: ${f.count} câu`).join('\n');
            }
            showImportStatus(msg, 'success');
            // Reset file input
            selectedFiles = [];
            document.getElementById('excelFile').value = '';
            document.getElementById('fileLabel').classList.remove('has-file');
            document.getElementById('fileLabel').querySelector('span').textContent = '📁 Chọn file Excel / CSV (nhiều file)';
            document.getElementById('selectedFiles').innerHTML = '';
        } else {
            showImportStatus(data.error || 'Lỗi upload', 'error');
        }
    } catch (err) {
        showImportStatus('Lỗi: ' + err.message, 'error');
    }
}

// ===== Full Reset =====
function fullResetGame() {
    if (!confirm('⚠️ Reset toàn bộ?\nĐiểm số, câu hỏi, mã phòng, tên người chơi — tất cả sẽ bị xóa sạch.')) return;
    if (!confirm('🔴 XÁC NHẬN LẦN 2: Bạn thực sự muốn XÓA SẠCH tất cả dữ liệu? Không thể hoàn tác!')) return;

    socket.emit('full-reset');
    currentPin = null;
    document.getElementById('pinDisplay').classList.add('hidden');
    showImportStatus('', '');
}

let currentPin = null;

function generatePin() {
    if (currentPin) {
        if (!confirm('Tạo trận mới sẽ reset điểm số và bộ đếm. Tiếp tục?')) return;
    }
    socket.emit('generate-pin');
}

socket.on('pin-created', ({ pin }) => {
    currentPin = pin;
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
    // Save import status to localStorage
    localStorage.setItem(LS_KEYS.IMPORT_STATUS, text);
    localStorage.setItem(LS_KEYS.IMPORT_STATUS_TYPE, type || '');
}



// ===== Question Sets (from server state) =====
function renderQuestionSets(state) {
    const container = document.getElementById('questionSetsContainer');
    if (!container) return;

    const sets = state.questionSets || [];
    if (sets.length === 0) {
        container.innerHTML = '';
        return;
    }

    const totalQuestions = sets.reduce((sum, s) => sum + s.count, 0);
    let html = `<div class="qsets-header">
        <span class="qsets-title">📚 Bộ câu hỏi đang dùng</span>
        <span class="qsets-total">${totalQuestions} câu từ ${sets.length} bộ</span>
    </div>`;
    html += '<div class="qsets-list">';

    sets.forEach(set => {
        const icon = set.type === 'sheet' ? '🌐' : '📄';
        const sourceName = set.source.length > 40
            ? set.source.substring(0, 40) + '...'
            : set.source;
        html += `<div class="qset-item qset-${set.type}">
            <div class="qset-left">
                <span class="qset-icon">${icon}</span>
                <div class="qset-info">
                    <div class="qset-name">${sourceName}</div>
                    <div class="qset-count">${set.count} câu hỏi</div>
                </div>
            </div>
            <button class="qset-delete" onclick="deleteQuestionSet(${set.id})" title="Xóa bộ này">✕</button>
        </div>`;
    });

    html += '</div>';
    container.innerHTML = html;
}

function deleteQuestionSet(setId) {
    if (confirm('Xóa bộ câu hỏi này? Câu hỏi sẽ bị reset lại.')) {
        socket.emit('delete-question-set', { setId });
    }
}

// ===== Restore Client State from localStorage =====
function restoreClientState() {
    // Restore Google Sheet URL
    const savedUrl = localStorage.getItem(LS_KEYS.SHEET_URL);
    if (savedUrl) {
        document.getElementById('sheetUrl').value = savedUrl;
    }

    // Restore active tab
    const savedTab = localStorage.getItem(LS_KEYS.ACTIVE_TAB);
    if (savedTab) {
        switchTab(savedTab);
    }

    // Restore import status
    const savedStatus = localStorage.getItem(LS_KEYS.IMPORT_STATUS);
    const savedStatusType = localStorage.getItem(LS_KEYS.IMPORT_STATUS_TYPE);
    if (savedStatus) {
        importStatus.textContent = savedStatus;
        importStatus.className = 'import-status ' + (savedStatusType || '');
    }
}

// Run on page load
restoreClientState();
