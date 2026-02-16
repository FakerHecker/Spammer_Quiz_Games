# 🚀 Hướng dẫn Deploy Quiz Game lên Render.com

## 📋 Mục lục

1. [Yêu cầu](#yêu-cầu)
2. [Chuẩn bị](#chuẩn-bị)
3. [Deploy lên Render](#deploy-lên-render)
4. [Cấu hình môi trường](#cấu-hình-môi-trường)
5. [Persistent Storage](#persistent-storage)
6. [Domain & SSL](#domain--ssl)
7. [Theo dõi & Logs](#theo-dõi--logs)
8. [Xử lý sự cố](#xử-lý-sự-cố)

---

## 📦 Yêu cầu

| Yêu cầu | Mô tả |
|---------|-------|
| GitHub Account | Để lưu source code |
| Render Account | Đăng ký tại [render.com](https://render.com) |
| Node.js | >= 18.0.0 |

---

## 🔧 Chuẩn bị

### 1. Push code lên GitHub

```bash
# Khởi tạo git (nếu chưa)
git init

# Thêm remote repository
git remote add origin https://github.com/username/quiz-game.git

# Add và commit
git add .
git commit -m "Initial commit"

# Push lên GitHub
git push -u origin main
```

### 2. Kiểm tra package.json

Đảm bảo file `package.json` có script `start`:

```json
{
  "scripts": {
    "start": "node server.js"
  }
}
```

---

## 🚀 Deploy lên Render

### Bước 1: Đăng nhập Render

1. Truy cập [dashboard.render.com](https://dashboard.render.com)
2. Đăng nhập hoặc tạo tài khoản mới

### Bước 2: Tạo Web Service mới

1. Click **"New +"** → **"Web Service"**
2. Chọn **"Connect a repository"**
3. Chọn repository từ GitHub
4. Click **"Connect"**

### Bước 3: Cấu hình Web Service

| Cài đặt | Giá trị |
|---------|---------|
| **Name** | `quiz-game` (hoặc tên bạn muốn) |
| **Region** | Singapore (gần Việt Nam nhất) |
| **Branch** | `main` |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | `Free` (hoặc paid plan) |

### Bước 4: Deploy

1. Click **"Create Web Service"**
2. Đợi build và deploy hoàn tất (~2-5 phút)
3. Khi thấy status **"Live"**, app đã sẵn sàng!

---

## ⚙️ Cấu hình môi trường

### Environment Variables

Vào **Environment** tab và thêm các biến:

| Variable | Value | Mô tả |
|----------|-------|-------|
| `NODE_ENV` | `production` | Chế độ production |
| `PORT` | (để trống) | Render tự động set |

Click **"Save Changes"** → Render sẽ tự động redeploy.

---

## 💾 Persistent Storage

### ⚠️ Vấn đề quan trọng

**File system trên Render là ephemeral** - các file được tạo trong runtime sẽ bị mất khi restart/redeploy.

### Giải pháp 1: Sử dụng Render Disk (Free tier có 1GB)

1. Vào **Web Service** → **Disks** tab
2. Click **"Add Disk"**
3. Cấu hình:
   - **Name**: `data-disk`
   - **Mount Path**: `/opt/render/project/data`
   - **Size**: `1 GB`

4. Cập nhật code để sử dụng đường dẫn này:

```javascript
// Trong server.js, thay đổi đường dẫn data file
const DATA_FILE = process.env.RENDER 
  ? '/opt/render/project/data/users.json'
  : path.join(__dirname, 'data', 'users.json');

const ROOM_FILE = process.env.RENDER 
  ? '/opt/render/project/data/room-pin.json'
  : path.join(__dirname, 'data', 'room-pin.json');
```

### Giải pháp 2: Sử dụng Database (Khuyên dùng)

Sử dụng database để lưu dữ liệu quan trọng:
- **MongoDB Atlas** (Free tier)
- **PostgreSQL** (Render cung cấp free PostgreSQL)
- **Redis** (cho cache)

---

## 🌐 Domain & SSL

### Domain mặc định

Render cung cấp domain miễn phí:
```
https://quiz-game-xxxx.onrender.com
```

### Custom Domain

1. Vào **Settings** → **Custom Domains**
2. Click **"Add Custom Domain"**
3. Nhập domain của bạn
4. Cấu hình DNS theo hướng dẫn của Render

### SSL

Render tự động cung cấp SSL miễn phí (Let's Encrypt) cho cả domain mặc định và custom domain.

---

## 📊 Theo dõi & Logs

### Xem Logs

1. Vào Web Service
2. Click **"Logs"** tab
3. Xem real-time logs

### Metrics

1. Vào **"Metrics"** tab
2. Xem CPU, Memory, Response time

### Alerts

1. Vào **"Settings"** → **"Notifications"**
2. Cấu hình email/Slack alerts

---

## 🔥 Xử lý sự cố

### Build failed

```bash
# Kiểm tra logs trong build process
# Nguyên nhân thường gặp:
# - Dependencies không tương thích
# - Node version không đúng
```

Thêm vào `package.json`:
```json
{
  "engines": {
    "node": ">=18.0.0"
  }
}
```

### App crashes

1. Kiểm tra logs: **Logs** tab
2. Nguyên nhân thường gặp:
   - Port không đúng (Render tự động set PORT)
   - Memory overflow
   - Unhandled errors

### Dữ liệu bị mất

- **Nguyên nhân**: Ephemeral file system
- **Giải pháp**: Sử dụng Persistent Disk hoặc Database

### App sleep (Free tier)

- Free tier app sẽ sleep sau 15 phút không hoạt động
- Request đầu tiên sẽ mất ~30s để wake up
- **Giải pháp**: Upgrade to paid plan hoặc sử dụng cron job để keep alive

---

## 📝 Quick Commands

| Action | Cách thực hiện |
|--------|---------------|
| Redeploy | **Manual Deploy** → **Deploy latest commit** |
| Restart | **Settings** → **Suspend** → **Resume** |
| View logs | **Logs** tab |
| Scale | **Settings** → **Instance Type** |

---

## 🔗 Useful Links

- [Render Documentation](https://render.com/docs)
- [Render Node.js Guide](https://render.com/docs/deploy-node-express-app)
- [Render Disks](https://render.com/docs/disks)
- [Render Environment Variables](https://render.com/docs/environment-variables)

---

*Hướng dẫn này dành cho Render.com. Cập nhật: 2024*