const socket = io();

// DOM elements
const playerAName = document.getElementById("playerAName");
const playerBName = document.getElementById("playerBName");
const playerAScore = document.getElementById("playerAScore");
const playerBScore = document.getElementById("playerBScore");
const playerACard = document.querySelector(".player-a");
const playerBCard = document.querySelector(".player-b");
const questionBadge = document.getElementById("questionBadge");
const questionText = document.getElementById("questionText");
const answerArea = document.getElementById("answerArea");
const answerText = document.getElementById("answerText");
const scorePopupA = document.getElementById("scorePopupA");
const scorePopupB = document.getElementById("scorePopupB");
const roomPinValue = document.getElementById("roomPinValue");
const hostNameValue = document.getElementById("hostNameValue");

// New elements for buzzer winner display (không dùng overlay toàn màn hình)
const buzzerWinnerDisplay = document.getElementById("buzzerWinnerDisplay");
const buzzerWinnerName = document.getElementById("buzzerWinnerName");

// New elements for countdown badge (hiển thị kế bên câu hỏi)
const countdownBadge = document.getElementById("countdownBadge");
const countdownValue = document.getElementById("countdownValue");

// Room PIN update
socket.on("room-pin", ({ pin }) => {
  roomPinValue.textContent = pin;
});

// State update handler
socket.on("state-update", (state) => {
  // Update host name
  if (state.hostName) {
    hostNameValue.textContent = state.hostName;
  } else {
    hostNameValue.textContent = "---";
  }

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
      answerArea.classList.remove("hidden");
      answerText.textContent = q.answer;
    } else {
      answerArea.classList.add("hidden");
    }
  } else if (state.questions.length > 0) {
    questionText.textContent = "Sẵn sàng chưa!";
    answerArea.classList.add("hidden");
  } else {
    questionText.textContent = "Hãy nhập kho đề từ Controller";
    answerArea.classList.add("hidden");
  }

  // Buzzer state on display
  const buzzer = state.buzzer;
  if (buzzer.winner === 0) {
    playerACard.classList.add("buzzer-winner");
    playerBCard.classList.remove("buzzer-winner");
  } else if (buzzer.winner === 1) {
    playerBCard.classList.add("buzzer-winner");
    playerACard.classList.remove("buzzer-winner");
  } else {
    playerACard.classList.remove("buzzer-winner");
    playerBCard.classList.remove("buzzer-winner");
  }

  // Hide buzzer winner display when buzzer is reset (new question or reset)
  if (buzzer.active || buzzer.winner === -1) {
    hideBuzzerWinnerDisplay();
  }
});

// Score animation
socket.on("score-animation", ({ index, delta }) => {
  const popup = index === 0 ? scorePopupA : scorePopupB;
  const scoreEl = index === 0 ? playerAScore : playerBScore;

  // Position popup near the score
  const rect = scoreEl.getBoundingClientRect();
  popup.style.left = rect.left + rect.width / 2 - 30 + "px";
  popup.style.top = rect.top + "px";

  // Show animation
  popup.textContent = delta > 0 ? `+${delta}` : `${delta}`;
  popup.className = "score-popup " + (delta > 0 ? "show-plus" : "show-minus");

  // Bump effect on score
  scoreEl.classList.add("bump");
  setTimeout(() => scoreEl.classList.remove("bump"), 300);

  // Reset popup
  setTimeout(() => {
    popup.className = "score-popup";
  }, 1000);
});

// Connection status
socket.on("connect", () => {
  console.log("Connected to server");
});

socket.on("disconnect", () => {
  console.log("Disconnected from server");
});

// ===== BUZZER WINNER DISPLAY (không dùng overlay toàn màn hình) =====

/**
 * Hiển thị tên người chơi đã bấm chuông (đè lên màn hình câu hỏi, không che toàn bộ)
 * KHÔNG còn đếm ngược 10s nữa
 */
socket.on("buzzer-winner", ({ playerIndex, playerName }) => {
  showBuzzerWinnerDisplay(playerIndex, playerName);
});

function showBuzzerWinnerDisplay(playerIndex, playerName) {
  buzzerWinnerName.textContent = playerName;
  buzzerWinnerDisplay.classList.remove("hidden", "type-b");

  if (playerIndex === 1) {
    buzzerWinnerDisplay.classList.add("type-b");
  }
}

function hideBuzzerWinnerDisplay() {
  buzzerWinnerDisplay.classList.add("hidden");
  buzzerWinnerDisplay.classList.remove("type-b");
}

// Event để controller có thể tắt hiển thị tên người chơi
socket.on("clear-buzzer-winner", () => {
  hideBuzzerWinnerDisplay();
});

// ===== COUNTDOWN DISPLAY (hiển thị kế bên câu hỏi, KHÔNG che màn hình) =====

let countdownInterval = null;

/**
 * Hiển thị countdown kế bên câu hỏi (không dùng overlay che màn hình)
 */
socket.on("display-countdown", ({ seconds }) => {
  startCountdownBadge(seconds);
});

function startCountdownBadge(initialSeconds) {
  // Clear existing countdown
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  let seconds = initialSeconds;
  countdownValue.textContent = seconds;
  countdownBadge.classList.remove("hidden");
  countdownBadge.classList.add("active");

  countdownInterval = setInterval(() => {
    seconds--;
    countdownValue.textContent = seconds;

    if (seconds <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;

      // Small delay before hiding
      setTimeout(() => {
        countdownBadge.classList.add("hidden");
        countdownBadge.classList.remove("active");
      }, 300);
    }
  }, 1000);
}

function hideCountdownBadge() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  countdownBadge.classList.add("hidden");
  countdownBadge.classList.remove("active");
}

// ===== AUTO RESIZE QUESTION TEXT =====

/**
 * Tự động điều chỉnh kích thước text câu hỏi dựa trên độ dài
 * để đảm bảo hiển thị tốt trên mọi màn hình
 */
function autoResizeQuestionText() {
  const text = questionText.textContent;
  const length = text.length;

  // Reset về font-size mặc định (sử dụng CSS clamp)
  questionText.style.fontSize = "";

  // Nếu text quá dài, giảm kích thước
  if (length > 200) {
    questionText.style.fontSize = "clamp(0.9rem, 2.5vw, 1.4rem)";
  } else if (length > 150) {
    questionText.style.fontSize = "clamp(1rem, 3vw, 1.6rem)";
  } else if (length > 100) {
    questionText.style.fontSize = "clamp(1.1rem, 3.5vw, 1.8rem)";
  }
}

// Observer để theo dõi thay đổi nội dung câu hỏi
const questionObserver = new MutationObserver(() => {
  autoResizeQuestionText();
});

questionObserver.observe(questionText, {
  childList: true,
  characterData: true,
  subtree: true,
});

// Initial resize
autoResizeQuestionText();
