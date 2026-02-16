const express = require("express");
const http = require("http");
const Server = require("socket.io").Server;
const multer = require("multer");
const XLSX = require("xlsx");
const path = require("path");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

// ===== SECURITY CONFIG =====
const SESSION_SECRET = crypto.randomBytes(32).toString("hex"); // Random per server start
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
// ===== DATA PATH CONFIGURATION =====
// On Render.com, use Persistent Disk path if RENDER env is set
// Otherwise, use local data directory
const RENDER_DISK_PATH = process.env.RENDER ? "/opt/render/project/data" : null;
const LOCAL_DATA_PATH = path.join(__dirname, "data");

const DATA_DIR = RENDER_DISK_PATH || LOCAL_DATA_PATH;
const DATA_FILE = path.join(DATA_DIR, "users.json");
const ROOM_FILE = path.join(DATA_DIR, "room.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");

// Log data directory for debugging
console.log(`Data directory: ${DATA_DIR}`);
console.log(`Running on Render: ${process.env.RENDER ? "Yes" : "No"}`);
const MAX_BACKUPS = 10; // Keep last 10 backups

// Active sessions: token -> { createdAt, ip, username }
const activeSessions = new Map();

// Rate limiting: ip -> { attempts, lastAttempt, lockedUntil }
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 5 * 60 * 1000; // 5 minutes
const ATTEMPT_WINDOW = 15 * 60 * 1000; // 15 minutes

// ===== MIDDLEWARE =====
app.use(cookieParser(SESSION_SECRET));
app.use(express.json());

// Block access to display if roomPin is not created
app.get(["/display", "/display.html"], (req, res, next) => {
  if (!roomPin) {
    return res.send(`
            <!DOCTYPE html>
            <html lang="vi">
            <head>
                <meta charset="UTF-8">
                <title>Chưa có phòng</title>
                <style>
                    body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #0f0f1a; color: #fff; text-align: center; }
                    h1 { color: #ef4444; }
                </style>
            </head>
            <body>
                <div>
                    <h1>⛔ Chưa có phòng chơi</h1>
                    <p>Vui lòng truy cập <b>Controller</b> và tạo mã PIN trước.</p>
                    <p>Tự động tải lại sau 5 giây...</p>
                    <script>setTimeout(() => location.reload(), 5000);</script>
                </div>
            </body>
            </html>
        `);
  }
  if (req.path === "/display") {
    return res.sendFile(path.join(__dirname, "public", "display.html"));
  }
  next();
});

app.get("/buzzer", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "buzzer.html"));
});

app.use(express.static(path.join(__dirname, "public")));

// ===== DATA HELPERS =====
function loadUsers() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, "{}");
      return {};
    }
    const data = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Error loading users:", err);
    return {};
  }
}

// ===== BACKUP HELPERS =====
function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function createBackup(filename) {
  try {
    ensureBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupName = `${path.basename(filename)}.${timestamp}.bak`;
    const backupPath = path.join(BACKUP_DIR, backupName);

    if (fs.existsSync(filename)) {
      fs.copyFileSync(filename, backupPath);
      console.log(`Backup created: ${backupName}`);
    }

    // Clean old backups
    cleanOldBackups(path.basename(filename));
  } catch (err) {
    console.error("Error creating backup:", err);
  }
}

function cleanOldBackups(filePrefix) {
  try {
    ensureBackupDir();
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith(filePrefix))
      .map((f) => ({
        name: f,
        time: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time);

    // Remove old backups beyond MAX_BACKUPS
    files.slice(MAX_BACKUPS).forEach((f) => {
      fs.unlinkSync(path.join(BACKUP_DIR, f.name));
      console.log(`Removed old backup: ${f.name}`);
    });
  } catch (err) {
    console.error("Error cleaning backups:", err);
  }
}

function atomicWriteFile(filepath, data) {
  const tempPath = filepath + ".tmp";
  try {
    // Write to temp file first
    fs.writeFileSync(tempPath, data);
    // Rename atomically (atomic on most systems)
    fs.renameSync(tempPath, filepath);
  } catch (err) {
    // Clean up temp file if exists
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    throw err;
  }
}

function saveUsers(users) {
  try {
    createBackup(DATA_FILE);
    atomicWriteFile(DATA_FILE, JSON.stringify(users, null, 2));
  } catch (err) {
    console.error("Error saving users:", err);
  }
}

// ===== ROOM DATA HELPERS (persistent storage) =====
// Only save roomPin - buzzerSlots are socket-specific and invalid after restart
function loadRoomPin() {
  try {
    if (!fs.existsSync(ROOM_FILE)) {
      fs.writeFileSync(ROOM_FILE, JSON.stringify({ roomPin: null }, null, 2));
      return null;
    }
    const data = fs.readFileSync(ROOM_FILE, "utf8");
    const parsed = JSON.parse(data);
    return parsed.roomPin || null;
  } catch (err) {
    console.error("Error loading room data:", err);
    return null;
  }
}

function saveRoomPin(pin) {
  try {
    createBackup(ROOM_FILE);
    atomicWriteFile(ROOM_FILE, JSON.stringify({ roomPin: pin }, null, 2));
  } catch (err) {
    console.error("Error saving room data:", err);
  }
}

// function getUserKey(username) { return crypto.createHash('sha256').update(username).digest('hex'); }
// But I need to add it to the file.

function getUserKey(username) {
  return crypto.createHash("sha256").update(username).digest("hex");
}

function generateSessionToken() {
  return crypto.randomBytes(48).toString("hex");
}

function createSession(ip, username) {
  const token = generateSessionToken();
  activeSessions.set(token, {
    createdAt: Date.now(),
    ip,
    username,
  });
  return token;
}

function isValidSession(token) {
  if (!token) return false;
  const session = activeSessions.get(token);
  if (!session) return false;
  // Check expiration
  if (Date.now() - session.createdAt > SESSION_MAX_AGE) {
    activeSessions.delete(token);
    return false;
  }
  return true;
}

function cleanExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of activeSessions) {
    if (now - session.createdAt > SESSION_MAX_AGE) {
      activeSessions.delete(token);
    }
  }
}

// Clean expired sessions every hour
setInterval(cleanExpiredSessions, 60 * 60 * 1000);

function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.ip ||
    req.connection.remoteAddress
  );
}

function checkRateLimit(ip) {
  const record = loginAttempts.get(ip);
  if (!record) return { allowed: true };

  const now = Date.now();

  // If locked out, check if lockout has expired
  if (record.lockedUntil && now < record.lockedUntil) {
    const remainingSec = Math.ceil((record.lockedUntil - now) / 1000);
    return {
      allowed: false,
      message: `Quá nhiều lần thử. Vui lòng đợi ${remainingSec} giây.`,
      retryAfter: remainingSec,
    };
  }

  // Reset if window has passed
  if (now - record.lastAttempt > ATTEMPT_WINDOW) {
    loginAttempts.delete(ip);
    return { allowed: true };
  }

  return { allowed: true };
}

function recordFailedAttempt(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip) || { attempts: 0, lastAttempt: now };

  // Reset count if window expired
  if (now - record.lastAttempt > ATTEMPT_WINDOW) {
    record.attempts = 0;
  }

  record.attempts += 1;
  record.lastAttempt = now;

  if (record.attempts >= MAX_LOGIN_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_DURATION;
    console.log(
      `[SECURITY] IP ${ip} locked out for ${LOCKOUT_DURATION / 1000}s after ${record.attempts} failed attempts`,
    );
  }

  loginAttempts.set(ip, record);
}

function clearAttempts(ip) {
  loginAttempts.delete(ip);
}

// ===== AUTH MIDDLEWARE =====
function requireAuth(req, res, next) {
  const token = req.signedCookies?.controller_session;
  if (isValidSession(token)) {
    return next();
  }
  // Redirect to login page
  return res.redirect("/login");
}

// ===== AUTH ROUTES =====

// Login page (public)
app.get("/login", (req, res) => {
  // If already authenticated, redirect to controller
  const token = req.signedCookies?.controller_session;
  if (isValidSession(token)) {
    return res.redirect("/controller");
  }
  res.sendFile(path.join(__dirname, "protected", "login.html"));
});

// Register API
app.post("/api/register", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({
      success: false,
      error: "Vui lòng nhập tên đăng nhập và mật khẩu",
    });
  }

  const users = loadUsers();
  if (users[getUserKey(username)]) {
    return res
      .status(400)
      .json({ success: false, error: "Tên đăng nhập đã tồn tại" });
  }

  // Hash password (simple sha256 for demo, use bcrypt in production)
  const hashedPassword = crypto
    .createHash("sha256")
    .update(password)
    .digest("hex");

  users[getUserKey(username)] = {
    password: hashedPassword,
    questionSets: [],
  };
  saveUsers(users);

  return res.json({ success: true, message: "Đăng ký thành công" });
});

// Forgot Password API
app.post("/api/forgot-password", (req, res) => {
  const { username, newPassword } = req.body;
  if (!username || !newPassword) {
    return res.status(400).json({
      success: false,
      error: "Vui lòng nhập tên đăng nhập và mật khẩu mới",
    });
  }

  const users = loadUsers();
  if (!users[getUserKey(username)]) {
    return res
      .status(400)
      .json({ success: false, error: "Tên đăng nhập không tồn tại" });
  }

  // Update password
  const hashedPassword = crypto
    .createHash("sha256")
    .update(newPassword)
    .digest("hex");
  users[getUserKey(username)].password = hashedPassword;
  saveUsers(users);

  return res.json({ success: true, message: "Đổi mật khẩu thành công" });
});

// Login API
app.post("/api/login", (req, res) => {
  const ip = getClientIp(req);

  // Check rate limit
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      success: false,
      error: rateCheck.message,
      retryAfter: rateCheck.retryAfter,
    });
  }

  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({
      success: false,
      error: "Vui lòng nhập tên đăng nhập và mật khẩu",
    });
  }

  const users = loadUsers();
  const user = users[getUserKey(username)];

  if (!user) {
    recordFailedAttempt(ip);
    return res.status(401).json({
      success: false,
      error: "Tên đăng nhập hoặc mật khẩu không đúng",
    });
  }

  const hashedPassword = crypto
    .createHash("sha256")
    .update(password)
    .digest("hex");

  // Constant-time comparison
  const passwordBuffer = Buffer.from(hashedPassword);
  const correctBuffer = Buffer.from(user.password);

  let isCorrect = false;
  if (passwordBuffer.length === correctBuffer.length) {
    isCorrect = crypto.timingSafeEqual(passwordBuffer, correctBuffer);
  }

  if (isCorrect) {
    clearAttempts(ip);
    const token = createSession(ip, username);

    // Load user's question sets into game state
    // Note: In a real app with multiple concurrent games, we'd need separate game states per room/user.
    // For this single-instance demo, we'll overwrite the global game state with the user's data.
    gameState.hostName = username;
    gameState.questionSets = user.questionSets || [];
    rebuildQuestions();
    io.emit("state-update", gameState);

    // Set secure HTTP-only signed cookie
    res.cookie("controller_session", token, {
      signed: true,
      httpOnly: true,
      maxAge: SESSION_MAX_AGE,
      sameSite: "strict",
      // secure: true // Enable when using HTTPS
    });

    console.log(`[AUTH] Login successful for ${username} from IP: ${ip}`);
    return res.json({ success: true });
  }

  // Failed login
  recordFailedAttempt(ip);
  const record = loginAttempts.get(ip);
  const remaining = MAX_LOGIN_ATTEMPTS - record.attempts;

  console.log(
    `[AUTH] Failed login from IP: ${ip} (${record.attempts}/${MAX_LOGIN_ATTEMPTS})`,
  );

  return res.status(401).json({
    success: false,
    error:
      remaining > 0
        ? `Mật khẩu không đúng. Còn ${remaining} lần thử.`
        : `Quá nhiều lần thử. Bị khóa ${LOCKOUT_DURATION / 1000 / 60} phút.`,
  });
});

// Logout API
app.post("/api/logout", (req, res) => {
  const token = req.signedCookies?.controller_session;
  if (token) {
    activeSessions.delete(token);
  }
  res.clearCookie("controller_session");
  return res.json({ success: true });
});

// Check auth status API
app.get("/api/auth-status", (req, res) => {
  const token = req.signedCookies?.controller_session;
  return res.json({ authenticated: isValidSession(token) });
});

// ===== PROTECTED CONTROLLER ROUTES =====
app.get("/controller", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "protected", "controller.html"));
});

// Serve protected static files with auth
app.get("/protected/js/controller.js", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "protected", "js", "controller.js"));
});

app.get("/protected/css/controller.css", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "protected", "css", "controller.css"));
});

// ===== PROTECTED API ROUTES =====
// Middleware to protect controller API routes
function requireApiAuth(req, res, next) {
  const token = req.signedCookies?.controller_session;
  if (isValidSession(token)) {
    return next();
  }
  return res.status(401).json({ error: "Unauthorized. Please login first." });
}

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
  hostName: "", // Current host
  players: [
    { name: "A", score: 0 },
    { name: "B", score: 0 },
  ],
  questionSets: [], // Array of { id, source, type, questions[], count }
  questions: [], // Flattened + shuffled from all sets
  usedQuestions: [],
  currentQuestionIndex: -1,
  questionCount: 0,
  showAnswer: false,
  buzzer: {
    active: false,
    winner: -1,
  },
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

// Room PIN & buzzer player tracking - load from persistent storage
let roomPin = loadRoomPin(); // Restore roomPin from file
const buzzerPlayers = {}; // socketId -> playerIndex (0 or 1) - not persisted (socket-specific)
let buzzerSlots = { 0: null, 1: null }; // Always reset on server start (socket IDs are stale)

// Log restored room PIN if exists
if (roomPin) {
  console.log(`Restored room PIN: ${roomPin}`);
}

// Helper to save current user's question sets
function saveCurrentUserSets(req) {
  const token = req.signedCookies?.controller_session;
  const session = activeSessions.get(token);
  if (session && session.username) {
    const users = loadUsers();
    if (users[getUserKey(session.username)]) {
      users[getUserKey(session.username)].questionSets = gameState.questionSets;
      saveUsers(users);
    }
  }
}

// API: Upload Excel file(s) — PROTECTED
app.post(
  "/api/upload-excel",
  requireApiAuth,
  upload.array("files", 20),
  (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      let totalNewQuestions = 0;
      const fileResults = [];

      for (const file of req.files) {
        const workbook = XLSX.read(file.buffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        const questions = parseQuestions(data);

        if (questions.length > 0) {
          const setId = nextSetId++;
          gameState.questionSets.push({
            id: setId,
            source: file.originalname,
            type: "excel",
            questions,
            count: questions.length,
          });
          totalNewQuestions += questions.length;
          fileResults.push({
            id: setId,
            name: file.originalname,
            count: questions.length,
          });
        }
      }

      if (totalNewQuestions === 0) {
        return res
          .status(400)
          .json({ error: "Không tìm thấy câu hỏi trong các file" });
      }

      rebuildQuestions();
      saveCurrentUserSets(req); // Save to user profile
      io.emit("state-update", gameState);
      res.json({ success: true, count: totalNewQuestions, files: fileResults });
    } catch (err) {
      console.error("Excel parse error:", err);
      res.status(500).json({ error: "Lỗi đọc file Excel" });
    }
  },
);

// API: Parse Google Sheets CSV — PROTECTED
app.post("/api/import-sheet", requireApiAuth, express.json(), (req, res) => {
  const { questions, sourceName } = req.body;
  if (!questions || questions.length === 0) {
    return res.status(400).json({ error: "Không có câu hỏi" });
  }

  const setId = nextSetId++;
  gameState.questionSets.push({
    id: setId,
    source: sourceName || "Google Sheets",
    type: "sheet",
    questions,
    count: questions.length,
  });

  rebuildQuestions();
  saveCurrentUserSets(req); // Save to user profile
  io.emit("state-update", gameState);
  res.json({ success: true, count: questions.length, setId });
});

// Parse questions from 2D array data
function parseQuestions(data) {
  if (!data || data.length === 0) return [];

  const questions = [];
  const headerRow = data[0];

  // Try to find question and answer columns
  let qCol = -1,
    aCol = -1;

  if (headerRow) {
    for (let i = 0; i < headerRow.length; i++) {
      const h = String(headerRow[i] || "")
        .toLowerCase()
        .trim();
      if (
        qCol === -1 &&
        (h.includes("câu hỏi") ||
          h.includes("question") ||
          h.includes("cau hoi") ||
          h === "q")
      ) {
        qCol = i;
      }
      if (
        aCol === -1 &&
        (h.includes("đáp án") ||
          h.includes("answer") ||
          h.includes("dap an") ||
          h === "a" ||
          h.includes("trả lời"))
      ) {
        aCol = i;
      }
    }
  }

  // Fallback: first column = question, second column = answer
  if (qCol === -1) qCol = 0;
  if (aCol === -1) aCol = 1;

  const startRow =
    qCol === 0 && aCol === 1 && headerRow && isNaN(Number(headerRow[0]))
      ? 1
      : 0;

  for (let i = startRow; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[qCol]) continue;

    const question = String(row[qCol]).trim();
    const answer = row[aCol] !== undefined ? String(row[aCol]).trim() : "";

    if (question) {
      questions.push({ question, answer });
    }
  }

  return questions;
}

// Socket.io
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Send current state to newly connected client
  socket.emit("state-update", gameState);

  // Send current room PIN if exists
  if (roomPin) {
    socket.emit("pin-created", { pin: roomPin });
    socket.emit("room-status", {
      slots: { 0: !!buzzerSlots[0], 1: !!buzzerSlots[1] },
    });
  }

  // Update player name
  socket.on("update-player-name", ({ index, name }) => {
    if (index >= 0 && index < gameState.players.length) {
      gameState.players[index].name = name;
      io.emit("state-update", gameState);
    }
  });

  // Update score
  socket.on("update-score", ({ index, delta }) => {
    if (index >= 0 && index < gameState.players.length) {
      gameState.players[index].score += delta;
      io.emit("state-update", gameState);
      io.emit("score-animation", { index, delta });
    }
  });

  // Random question (no repeats) + activate buzzer
  socket.on("random-question", () => {
    if (gameState.questions.length === 0) return;

    // Find available (unused) question indices
    const available = gameState.questions
      .map((_, i) => i)
      .filter((i) => !gameState.usedQuestions.includes(i));

    if (available.length === 0) return; // All questions used

    const pick = available[Math.floor(Math.random() * available.length)];
    gameState.currentQuestionIndex = pick;
    gameState.usedQuestions.push(pick);
    gameState.questionCount += 1;
    gameState.showAnswer = false;
    // Activate buzzer
    gameState.buzzer = { active: true, winner: -1 };
    io.emit("state-update", gameState);
  });

  // Buzzer press
  socket.on("buzzer-press", ({ playerIndex }) => {
    if (!gameState.buzzer.active) return;
    if (gameState.buzzer.winner !== -1) return; // Already buzzed
    if (playerIndex !== 0 && playerIndex !== 1) return;

    gameState.buzzer.winner = playerIndex;
    gameState.buzzer.active = false;
    io.emit("state-update", gameState);
    io.emit("buzzer-winner", {
      playerIndex,
      playerName: gameState.players[playerIndex].name,
    });
  });

  // Clear buzzer winner display (from controller)
  socket.on("clear-buzzer-winner", () => {
    io.emit("clear-buzzer-winner");
  });

  // Generate room PIN (from controller) — also resets scores/counter
  socket.on("generate-pin", () => {
    roomPin = String(Math.floor(1000 + Math.random() * 9000)); // 4-digit
    // Kick existing buzzer players
    Object.keys(buzzerPlayers).forEach((sid) => {
      const s = io.sockets.sockets.get(sid);
      if (s) s.emit("kicked", { reason: "Phòng mới đã được tạo" });
    });
    // Clear slots
    Object.keys(buzzerPlayers).forEach((k) => delete buzzerPlayers[k]);
    buzzerSlots[0] = null;
    buzzerSlots[1] = null;

    // Save room PIN to file (persistent storage)
    saveRoomPin(roomPin);

    // Reset scores, counter, and player names
    gameState.players[0].name = "A";
    gameState.players[0].score = 0;
    gameState.players[1].name = "B";
    gameState.players[1].score = 0;
    gameState.questionCount = 0;
    gameState.currentQuestionIndex = -1;
    gameState.showAnswer = false;
    gameState.buzzer = { active: false, winner: -1 };

    socket.emit("pin-created", { pin: roomPin });
    io.emit("room-pin", { pin: roomPin });
    io.emit("room-status", {
      slots: { 0: !!buzzerSlots[0], 1: !!buzzerSlots[1] },
    });
    io.emit("state-update", gameState);
    // Reset input fields on controller
    socket.emit("reset-inputs", {
      playerA: "A",
      playerB: "B",
    });
  });

  // Register buzzer player (with PIN + name, auto-assign slot)
  socket.on("register-buzzer", ({ pin, name }) => {
    // Validate PIN
    if (!roomPin || pin !== roomPin) {
      socket.emit("buzzer-error", { message: "Mã PIN không đúng" });
      return;
    }
    if (!name || !name.trim()) {
      socket.emit("buzzer-error", { message: "Vui lòng nhập tên" });
      return;
    }

    // Check if this socket is already registered
    if (buzzerPlayers[socket.id] !== undefined) {
      const existingIndex = buzzerPlayers[socket.id];
      // Update name
      gameState.players[existingIndex].name = name.trim();
      io.emit("state-update", gameState);
      socket.emit("buzzer-registered", {
        playerIndex: existingIndex,
        playerName: name.trim(),
      });
      return;
    }

    // Auto-assign to next available slot
    let assignedIndex = -1;
    if (buzzerSlots[0] === null) {
      assignedIndex = 0;
    } else if (buzzerSlots[1] === null) {
      assignedIndex = 1;
    } else {
      socket.emit("buzzer-error", { message: "Phòng đã đầy (2/2 người chơi)" });
      return;
    }

    // Register
    buzzerPlayers[socket.id] = assignedIndex;
    buzzerSlots[assignedIndex] = socket.id;

    // Update player name
    gameState.players[assignedIndex].name = name.trim();
    io.emit("state-update", gameState);

    socket.emit("buzzer-registered", {
      playerIndex: assignedIndex,
      playerName: name.trim(),
    });
    io.emit("room-status", {
      slots: { 0: !!buzzerSlots[0], 1: !!buzzerSlots[1] },
    });
  });

  // Toggle answer visibility
  socket.on("toggle-answer", () => {
    gameState.showAnswer = !gameState.showAnswer;
    io.emit("state-update", gameState);
  });

  // Start countdown
  socket.on("start-countdown", ({ seconds }) => {
    io.emit("display-countdown", { seconds });
  });

  // Reset (scores + counter only, keep used questions)
  socket.on("reset", () => {
    gameState.players.forEach((p) => (p.score = 0));
    gameState.questionCount = 0;
    gameState.currentQuestionIndex = -1;
    gameState.showAnswer = false;
    gameState.buzzer = { active: false, winner: -1 };
    io.emit("state-update", gameState);
  });

  // Delete a specific question set
  socket.on("delete-question-set", ({ setId }) => {
    const idx = gameState.questionSets.findIndex((s) => s.id === setId);
    if (idx === -1) return;
    gameState.questionSets.splice(idx, 1);
    rebuildQuestions();

    // We need to save this change to the user's profile, but we don't have the request object here.
    // In a real app, we'd map socket.id to user session.
    // For this simple version, we'll just update the file if we know the host.
    if (gameState.hostName) {
      const users = loadUsers();
      if (users[getUserKey(gameState.hostName)]) {
        users[getUserKey(gameState.hostName)].questionSets =
          gameState.questionSets;
        saveUsers(users);
      }
    }

    io.emit("state-update", gameState);
  });

  // Full reset — everything back to initial state
  socket.on("full-reset", () => {
    // Reset game state
    gameState.players = [
      { name: "A", score: 0 },
      { name: "B", score: 0 },
    ];
    gameState.questionSets = [];
    gameState.questions = [];
    gameState.usedQuestions = [];
    gameState.currentQuestionIndex = -1;
    gameState.questionCount = 0;
    gameState.showAnswer = false;
    gameState.buzzer = { active: false, winner: -1 };
    // Keep hostName

    // Update user storage
    if (gameState.hostName) {
      const users = loadUsers();
      if (users[getUserKey(gameState.hostName)]) {
        users[getUserKey(gameState.hostName)].questionSets = [];
        saveUsers(users);
      }
    }

    // Clear room
    roomPin = null;
    buzzerSlots = { 0: null, 1: null };

    // Save room PIN to file (persistent storage)
    saveRoomPin(roomPin);

    // Kick buzzer players
    Object.keys(buzzerPlayers).forEach((sid) => {
      const s = io.sockets.sockets.get(sid);
      if (s) s.emit("kicked", { reason: "Trò chơi đã được reset toàn bộ" });
    });
    Object.keys(buzzerPlayers).forEach((k) => delete buzzerPlayers[k]);
    buzzerSlots[0] = null;
    buzzerSlots[1] = null;

    io.emit("state-update", gameState);
    io.emit("room-pin", { pin: "----" });
    io.emit("room-status", { slots: { 0: false, 1: false } });
  });

  socket.on("disconnect", () => {
    // Free buzzer slot
    const playerIndex = buzzerPlayers[socket.id];
    if (playerIndex !== undefined) {
      buzzerSlots[playerIndex] = null;
      delete buzzerPlayers[socket.id];
      io.emit("room-status", {
        slots: { 0: !!buzzerSlots[0], 1: !!buzzerSlots[1] },
      });
    }
    console.log("Client disconnected:", socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`
╔══════════════════════════════════════════════╗
║         🎮 Quiz Game Server Started          ║
╠══════════════════════════════════════════════╣
║                                              ║
║  Display:    http://localhost:${PORT}/display         ║
║  Controller: http://localhost:${PORT}/controller     ║
║  Buzzer:     http://localhost:${PORT}/buzzer          ║
║                                              ║
╚══════════════════════════════════════════════╝
  `);
});
