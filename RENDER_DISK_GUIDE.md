# 📚 Hướng dẫn sử dụng Render Disk (Persistent Storage)

## 🎯 Mục đích

Render Disk (Persistent Disk) giúp lưu trữ dữ liệu bền vững, không bị mất khi app restart hoặc redeploy.

### ⚠️ Vấn đề không dùng Render Disk

- File system trên Render là **ephemeral** (tạm thời)
- Các file được tạo trong runtime sẽ **BỊ MẤT** khi:
  - App restart
  - Redeploy
  - Scale up/down

### ✅ Lợi ích khi dùng Render Disk

- Dữ liệu được **giữ vĩnh viễn**
- Tự động backup bởi Render
- Tương thích với nhiều loại ứng dụng
- Free tier: **1GB** storage

---

## 📋 Yêu cầu

| Yêu cầu | Chi tiết |
|---------|----------|
| Render Account | Đăng ký tại [render.com](https://render.com) |
| Web Service | Đã deploy một Web Service |
| Plan | Free tier hỗ trợ 1GB disk |

---

## 🚀 Bước 1: Tạo Render Disk

### 1.1. Truy cập Dashboard

1. Đăng nhập vào [dashboard.render.com](https://dashboard.render.com)
2. Chọn **Web Service** của bạn (ví dụ: `quiz-game`)

### 1.2. Thêm Disk

1. Vào tab **Disks** 
2. Click **"Add Disk"** button

### 1.3. Cấu hình Disk

| Cài đặt | Giá trị | Ghi chú |
|---------|---------|---------|
| **Name** | `data-disk` | Tên disk (tùy ý) |
| **Mount Path** | `/opt/render/project/data` | ⚠️ Quan trọng - phải đúng đường dẫn này |
| **Size** | `1 GB` | Free tier tối đa 1GB |

### 1.4. Lưu và Redeploy

1. Click **"Save"**
2. Render sẽ tự động **redeploy** app
3. Đợi khoảng 2-3 phút để hoàn tất

---

## 🔧 Bước 2: Cấu hình Code

### 2.1. Code đã được cập nhật sẵn

Server.js đã được cấu hình để tự động sử dụng Render Disk:

```javascript
// ===== DATA PATH CONFIGURATION =====
// On Render.com, use Persistent Disk path if RENDER env is set
// Otherwise, use local data directory
const RENDER_DISK_PATH = process.env.RENDER ? "/opt/render/project/data" : null;
const LOCAL_DATA_PATH = path.join(__dirname, "data");

const DATA_DIR = RENDER_DISK_PATH || LOCAL_DATA_PATH;
const DATA_FILE = path.join(DATA_DIR, "users.json");
const ROOM_FILE = path.join(DATA_DIR, "room.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
```

### 2.2. Cách hoạt động

| Môi trường | Đường dẫn dữ liệu |
|------------|-------------------|
| **Render (có Disk)** | `/opt/render/project/data/` |
| **Local Development** | `./data/` |

---

## 📁 Bước 3: Cấu trúc thư mục trên Render Disk

Sau khi mount, cấu trúc sẽ như sau:

```
/opt/render/project/data/
├── users.json           # Dữ liệu users (tự động tạo)
├── room.json            # Mã PIN phòng (tự động tạo)
└── backups/             # Backup files (tự động tạo)
    ├── users.json.xxx.bak
    └── room.json.xxx.bak
```

---

## ✅ Bước 4: Kiểm tra Disk hoạt động

### 4.1. Kiểm tra qua Logs

1. Vào **Logs** tab của Web Service
2. Tìm dòng sau khi app start:

```
Data directory: /opt/render/project/data
Running on Render: Yes
```

### 4.2. Kiểm tra qua Shell (Optional)

Nếu cần kiểm tra trực tiếp:

1. Vào **Shell** tab
2. Chạy lệnh:

```bash
ls -la /opt/render/project/data/
```

---

## 🔄 Bước 5: Di chuyển dữ liệu hiện có (nếu có)

Nếu bạn đã có dữ liệu trên local và muốn di chuyển lên Render Disk:

### 5.1. Download dữ liệu từ local

```bash
# Các file cần backup
data/users.json
data/room.json
```

### 5.2. Upload lên Render

**Cách 1: Sử dụng Render Shell**

1. Vào **Shell** tab
2. Tạo thư mục nếu chưa có:

```bash
mkdir -p /opt/render/project/data/backups
```

3. Tạo file `users.json`:

```bash
cat > /opt/render/project/data/users.json << 'EOF'
{
  "admin": {
    "passwordHash": "...",
    "questionSets": []
  }
}
EOF
```

**Cách 2: Redeploy với file trong repo**

1. Đặt file `users.json` và `room.json` trong thư mục `data/` của repo
2. Push lên GitHub
3. Render sẽ tự động copy vào Disk khi deploy lần đầu

---

## ⚙️ Bước 6: Cấu hình Environment Variables (Optional)

### Tùy chỉnh đường dẫn Disk

Nếu bạn muốn sử dụng đường dẫn khác, thêm Environment Variable:

| Variable | Value |
|----------|-------|
| `DATA_DIR` | `/opt/render/project/data` |

Sau đó cập nhật code:

```javascript
const DATA_DIR = process.env.DATA_DIR || 
                 (process.env.RENDER ? "/opt/render/project/data" : path.join(__dirname, "data"));
```

---

## 📊 Quản lý Disk

### Xem thông tin Disk

1. Vào **Disks** tab
2. Xem:
   - Size đã sử dụng
   - Size còn lại
   - Mount path

### Resize Disk

1. Vào **Disks** tab
2. Click **"Resize"**
3. Chọn size mới
4. **Lưu ý**: Chỉ có thể **tăng** size, không thể giảm

### Detach Disk (Không khuyến nghị)

1. Vào **Disks** tab
2. Click **"Detach"**
3. **Cảnh báo**: Dữ liệu sẽ không còn accessible

---

## 💾 Backup & Restore

### Render tự động backup

- Render tự động backup Disk định kỳ
- Giữ lại 7 ngày gần nhất

### Manual Backup

```bash
# Trong Render Shell
cp /opt/render/project/data/users.json /opt/render/project/data/users.json.backup
```

### Download Backup

1. Vào **Disks** tab
2. Click **"Create Snapshot"** (nếu có tính năng này)
3. Hoặc sử dụng Shell để export:

```bash
cat /opt/render/project/data/users.json
```

---

## 🐛 Xử lý sự cố

### 1. Dữ liệu bị mất sau redeploy

**Nguyên nhân**: Chưa mount Disk

**Giải pháp**: 
- Kiểm tra lại Mount Path có đúng `/opt/render/project/data`
- Kiểm tra Disk đã được attach chưa

### 2. App không start được

**Nguyên nhân**: Disk chưa sẵn sàng

**Giải pháp**:
- Đợi vài phút sau khi tạo Disk
- Check logs để xem lỗi cụ thể

### 3. Không ghi được file

**Nguyên nhân**: Permission denied

**Giải pháp**:
```bash
# Trong Shell
chmod 755 /opt/render/project/data
```

### 4. Disk full

**Kiểm tra**:
```bash
df -h /opt/render/project/data
```

**Giải pháp**:
- Xóa backup cũ
- Resize Disk
- Dọn dẹp dữ liệu không cần thiết

---

## 📈 Best Practices

### 1. Luôn kiểm tra Logs

Sau mỗi lần deploy, kiểm tra logs để đảm bảo:
- Data directory đúng
- File được tạo thành công

### 2. Backup thường xuyên

```bash
# Script backup đơn giản (có thể chạy trong app)
cp /opt/render/project/data/users.json /opt/render/project/data/backups/users-$(date +%Y%m%d).json
```

### 3. Giám sát Disk usage

- Set up alerts khi Disk gần đầy
- Vào **Settings** → **Notifications**

### 4. Test trước khi production

1. Tạo test data
2. Restart app
3. Verify data vẫn còn

---

## 💰 Chi phí

| Plan | Disk Size | Giá |
|------|-----------|-----|
| Free | 1 GB | $0/tháng |
| Starter | 10 GB | $7/tháng |
| Standard | 50 GB | $25/tháng |
| Pro | 100 GB+ | Custom |

---

## 🔗 Links hữu ích

- [Render Disks Documentation](https://render.com/docs/disks)
- [Render File System](https://render.com/docs/file-systems)
- [Render Environment Variables](https://render.com/docs/environment-variables)

---

## 📝 Tóm tắt

| Bước | Hành động |
|------|-----------|
| 1 | Tạo Disk với Mount Path `/opt/render/project/data` |
| 2 | Code tự động sử dụng Render Disk (đã config sẵn) |
| 3 | Redeploy app |
| 4 | Kiểm tra logs để verify |
| 5 | Test tạo/đọc dữ liệu |

---

*Lưu ý: Sau khi mount Disk, tất cả dữ liệu trong thư mục `/opt/render/project/data` sẽ được giữ vĩnh viễn, ngay cả khi app restart hoặc redeploy.*