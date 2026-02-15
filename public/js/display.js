const socket = io();

// DOM elements
const playerAName = document.getElementById('playerAName');
const playerBName = document.getElementById('playerBName');
const playerAScore = document.getElementById('playerAScore');
const playerBScore = document.getElementById('playerBScore');
const playerACard = document.querySelector('.player-a');
const playerBCard = document.querySelector('.player-b');
const questionBadge = document.getElementById('questionBadge');
const questionText = document.getElementById('questionText');
const answerArea = document.getElementById('answerArea');
const answerText = document.getElementById('answerText');
const scorePopupA = document.getElementById('scorePopupA');
const scorePopupB = document.getElementById('scorePopupB');
const roomPinValue = document.getElementById('roomPinValue');

// Room PIN update
socket.on('room-pin', ({ pin }) => {
    roomPinValue.textContent = pin;
});

// State update handler
socket.on('state-update', (state) => {
    // Update player names
    playerAName.textContent = state.players[0].name;
    playerBName.textContent = state.players[1].name;

    // Update scores
    playerAScore.textContent = state.players[0].score;
    playerBScore.textContent = state.players[1].score;

    // Update question counter (X/15)
    questionBadge.textContent = `${state.questionCount}/15`;

    // Update question
    if (state.questions.length > 0 && state.currentQuestionIndex >= 0) {
        const q = state.questions[state.currentQuestionIndex];
        questionText.textContent = q.question;

        // Answer
        if (state.showAnswer && q.answer) {
            answerArea.classList.remove('hidden');
            answerText.textContent = q.answer;
        } else {
            answerArea.classList.add('hidden');
        }
    } else if (state.questions.length > 0) {
        questionText.textContent = 'Sẵn sàng chưa!';
        answerArea.classList.add('hidden');
    } else {
        questionText.textContent = 'Hãy nhập kho đề từ Controller';
        answerArea.classList.add('hidden');
    }

    // Buzzer state on display
    const buzzer = state.buzzer;
    if (buzzer.winner === 0) {
        playerACard.classList.add('buzzer-winner');
        playerBCard.classList.remove('buzzer-winner');
    } else if (buzzer.winner === 1) {
        playerBCard.classList.add('buzzer-winner');
        playerACard.classList.remove('buzzer-winner');
    } else {
        playerACard.classList.remove('buzzer-winner');
        playerBCard.classList.remove('buzzer-winner');
    }
});

// Score animation
socket.on('score-animation', ({ index, delta }) => {
    const popup = index === 0 ? scorePopupA : scorePopupB;
    const scoreEl = index === 0 ? playerAScore : playerBScore;

    // Position popup near the score
    const rect = scoreEl.getBoundingClientRect();
    popup.style.left = rect.left + rect.width / 2 - 30 + 'px';
    popup.style.top = rect.top + 'px';

    // Show animation
    popup.textContent = delta > 0 ? `+${delta}` : `${delta}`;
    popup.className = 'score-popup ' + (delta > 0 ? 'show-plus' : 'show-minus');

    // Bump effect on score
    scoreEl.classList.add('bump');
    setTimeout(() => scoreEl.classList.remove('bump'), 300);

    // Reset popup
    setTimeout(() => {
        popup.className = 'score-popup';
    }, 1000);
});

// Connection status
socket.on('connect', () => {
    console.log('Connected to server');
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
});
