const socket = io();

let myPlayerIndex = -1;

// DOM
const pinScreen = document.getElementById('pinScreen');
const buzzerScreen = document.getElementById('buzzerScreen');
const pinInput = document.getElementById('pinInput');
const nameInput = document.getElementById('nameInput');
const pinError = document.getElementById('pinError');
const joinBtn = document.getElementById('joinBtn');
const roomInfo = document.getElementById('roomInfo');
const roomInfoText = document.getElementById('roomInfoText');
const buzzerStatus = document.getElementById('buzzerStatus');
const buzzerPlayerName = document.getElementById('buzzerPlayerName');
const buzzerBtn = document.getElementById('buzzerBtn');
const buzzerResult = document.getElementById('buzzerResult');
const resultText = document.getElementById('resultText');

// Join room with PIN + Name
function joinRoom() {
    const pin = pinInput.value.trim();
    const name = nameInput.value.trim();

    if (pin.length !== 4) {
        showPinError('Vui lòng nhập mã PIN 4 số');
        return;
    }
    if (!name) {
        showPinError('Vui lòng nhập tên của bạn');
        nameInput.focus();
        return;
    }

    joinBtn.disabled = true;
    joinBtn.textContent = '⏳ Đang vào...';
    socket.emit('register-buzzer', { pin, name });
}

// Registered confirmation
socket.on('buzzer-registered', ({ playerIndex, playerName }) => {
    pinScreen.classList.add('hidden');
    buzzerScreen.classList.remove('hidden');
    buzzerPlayerName.textContent = playerName;
    buzzerPlayerName.style.color = playerIndex === 0 ? '#4f8cff' : '#ff8c4f';
    myPlayerIndex = playerIndex;

    // Reset join button
    joinBtn.disabled = false;
    joinBtn.innerHTML = '<span>🚀</span> Vào phòng';
});

// Error from server
socket.on('buzzer-error', ({ message }) => {
    showPinError(message);
    myPlayerIndex = -1;
    // Reset join button
    joinBtn.disabled = false;
    joinBtn.innerHTML = '<span>🚀</span> Vào phòng';
});

// Kicked from room
socket.on('kicked', ({ reason }) => {
    myPlayerIndex = -1;
    pinScreen.classList.remove('hidden');
    buzzerScreen.classList.add('hidden');
    pinInput.value = '';
    nameInput.value = '';
    showPinError(reason);
});

// State update
socket.on('state-update', (state) => {
    // Update buzzer player name if registered
    if (myPlayerIndex >= 0) {
        buzzerPlayerName.textContent = state.players[myPlayerIndex].name;
    }

    // Buzzer state
    const buzzer = state.buzzer;

    if (buzzer.active && buzzer.winner === -1) {
        buzzerBtn.disabled = false;
        buzzerBtn.className = 'buzzer-btn ' + (myPlayerIndex === 0 ? 'active-a' : 'active-b');
        buzzerStatus.textContent = '⚡ BẤM NHANH!';
        buzzerResult.classList.add('hidden');
    } else if (buzzer.winner !== -1) {
        buzzerBtn.disabled = true;
        buzzerBtn.className = 'buzzer-btn disabled';

        if (buzzer.winner === myPlayerIndex) {
            buzzerStatus.textContent = '🎉 Bạn đã bấm chuông!';
            buzzerResult.className = 'buzzer-result win';
            resultText.textContent = '✅ BẠN NHANH HƠN!';
        } else {
            buzzerStatus.textContent = '😔 Đối thủ nhanh hơn';
            buzzerResult.className = 'buzzer-result lose';
            resultText.textContent = `❌ ${state.players[buzzer.winner].name} đã bấm trước`;
        }
        buzzerResult.classList.remove('hidden');
    } else {
        buzzerBtn.disabled = true;
        buzzerBtn.className = 'buzzer-btn disabled';
        buzzerStatus.textContent = 'Đang chờ câu hỏi...';
        buzzerResult.classList.add('hidden');
    }
});

// Press buzzer
function pressBuzzer() {
    if (myPlayerIndex < 0) return;
    socket.emit('buzzer-press', { playerIndex: myPlayerIndex });
}

// Helpers
function showPinError(msg) {
    pinError.textContent = msg;
    pinError.classList.remove('hidden');
    setTimeout(() => pinError.classList.add('hidden'), 3000);
}

// Auto-focus PIN input, only allow digits
pinInput.addEventListener('input', () => {
    pinInput.value = pinInput.value.replace(/\D/g, '');
});

// Enter key support
pinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && pinInput.value.length === 4) {
        nameInput.focus();
    }
});

nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        joinRoom();
    }
});

// Connection
socket.on('connect', () => {
    console.log('Buzzer connected');
    if (myPlayerIndex >= 0) {
        // Reconnect
        const pin = pinInput.value.trim();
        const name = nameInput.value.trim();
        socket.emit('register-buzzer', { pin, name });
    }
});
