const socket = io();

let myPlayerIndex = -1;

// DOM
const pinScreen = document.getElementById('pinScreen');
const buzzerScreen = document.getElementById('buzzerScreen');
const pinInput = document.getElementById('pinInput');
const pinError = document.getElementById('pinError');
const selectNameA = document.getElementById('selectNameA');
const selectNameB = document.getElementById('selectNameB');
const buzzerStatus = document.getElementById('buzzerStatus');
const buzzerPlayerName = document.getElementById('buzzerPlayerName');
const buzzerBtn = document.getElementById('buzzerBtn');
const buzzerResult = document.getElementById('buzzerResult');
const resultText = document.getElementById('resultText');

// Join as player with PIN
function joinAsPlayer(index) {
    const pin = pinInput.value.trim();
    if (pin.length !== 4) {
        showPinError('Vui lòng nhập mã PIN 4 số');
        return;
    }
    myPlayerIndex = index;
    socket.emit('register-buzzer', { playerIndex: index, pin: pin });
}

// Registered confirmation
socket.on('buzzer-registered', ({ playerIndex, playerName }) => {
    pinScreen.classList.add('hidden');
    buzzerScreen.classList.remove('hidden');
    buzzerPlayerName.textContent = playerName;
    buzzerPlayerName.style.color = playerIndex === 0 ? '#4f8cff' : '#ff8c4f';
    myPlayerIndex = playerIndex;
});

// Error from server
socket.on('buzzer-error', ({ message }) => {
    showPinError(message);
    myPlayerIndex = -1;
});

// Kicked from room
socket.on('kicked', ({ reason }) => {
    myPlayerIndex = -1;
    pinScreen.classList.remove('hidden');
    buzzerScreen.classList.add('hidden');
    pinInput.value = '';
    showPinError(reason);
});

// State update
socket.on('state-update', (state) => {
    // Update player names on select screen
    selectNameA.textContent = state.players[0].name;
    selectNameB.textContent = state.players[1].name;

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

// Auto-focus PIN input
pinInput.addEventListener('input', () => {
    pinInput.value = pinInput.value.replace(/\D/g, '');
});

// Connection
socket.on('connect', () => {
    console.log('Buzzer connected');
    if (myPlayerIndex >= 0) {
        // Reconnect
        const pin = pinInput.value.trim();
        socket.emit('register-buzzer', { playerIndex: myPlayerIndex, pin: pin });
    }
});
