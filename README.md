# 🖥️ SKEMA RAJA Auto Check-in - Puppeteer Version

Aplikasi auto check-in SKEMA RAJA menggunakan Puppeteer (Node.js) dengan web dashboard.

## ✨ Fitur

- ✅ Auto check-in Pagi, Siang, Sore (WITA timezone)
- ✅ Web dashboard untuk konfigurasi
- ✅ Notifikasi WhatsApp via Fonnte
- ✅ Manajemen pegawai (tambah manual, edit, hapus)
- ✅ Skip weekend & hari libur nasional
- ✅ Random delay untuk menghindari deteksi

## 📋 Persyaratan

- Node.js 18+ 
- NPM atau Yarn
- Ubuntu 22.04/24.04 LTS (untuk VPS)
- RAM minimal 2GB

## 🚀 Quick Start (Lokal)

```bash
# Clone/download project
cd B-puppeteer

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit konfigurasi
nano .env

# Jalankan dashboard
npm run server
```

Akses dashboard: http://localhost:3000

## 📁 Struktur Project

```
B-puppeteer/
├── src/
│   ├── server.js     # Express dashboard server
│   ├── index.js      # Cron scheduler
│   ├── checkin.js    # Puppeteer logic
│   ├── utils.js      # Helper functions
│   └── logger.js     # Winston logger
├── config.json       # Konfigurasi (auto-generated)
├── users.json        # Daftar pegawai
├── logs.json         # Log check-in
├── .env              # Environment variables
└── package.json
```

## ⚙️ Konfigurasi (.env)

```env
# Kantor
KODE_KANTOR=004036057000000
STATUS=2
SHIFT=1

# Lokasi GPS
LATITUDE=0.537831
LONGITUDE=123.058388

# Fonnte WhatsApp (optional)
FONNTE_TOKEN=your_device_token

# Server
PORT=3000
```

## 🖥️ NPM Scripts

| Command | Deskripsi |
|---------|-----------|
| `npm run server` | Jalankan dashboard (localhost:3000) |
| `npm run checkin` | Manual check-in semua user |
| `npm start` | Auto check-in dengan cron scheduler |
| `npm run sync` | Sync pegawai dari API |

---

## 🌐 Deploy ke VPS Ubuntu

### Persyaratan VPS
- **OS:** Ubuntu 22.04/24.04 LTS
- **RAM:** Minimal 2GB
- **CPU:** 1-2 vCPU
- **Storage:** 20GB SSD

### Step 1: Setup Server

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node -v  # v20.x
npm -v   # 10.x
```

### Step 2: Install Chromium Dependencies

```bash
# Install Puppeteer dependencies
sudo apt install -y \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    wget \
    libxss1 \
    libxtst6
```

### Step 3: Upload & Setup Project

```bash
# Buat direktori
sudo mkdir -p /var/www/skemaraja
cd /var/www/skemaraja

# Upload files (via SCP/SFTP)
# Atau clone dari git

# Install dependencies
npm install

# Copy dan edit .env
cp .env.example .env
nano .env

# Test jalankan
npm run server
```

### Step 4: Setup PM2 (Process Manager)

```bash
# Install PM2
sudo npm install -g pm2

# Jalankan aplikasi
pm2 start src/index.js --name "skemaraja-cron"
pm2 start src/server.js --name "skemaraja-dashboard"

# Auto-start saat reboot
pm2 startup
pm2 save

# Monitor
pm2 status
pm2 logs
```

### Step 5: Setup Nginx (Reverse Proxy)

```bash
# Install Nginx
sudo apt install -y nginx

# Buat config
sudo nano /etc/nginx/sites-available/skemaraja
```

Isi config:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/skemaraja /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Step 6: Setup SSL (HTTPS)

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Generate SSL
sudo certbot --nginx -d your-domain.com

# Auto-renew
sudo certbot renew --dry-run
```

---

## 🔧 Troubleshooting

### Error: "No usable sandbox"
```bash
# Jalankan dengan --no-sandbox
# Edit src/checkin.js, tambahkan args:
args: ['--no-sandbox', '--disable-setuid-sandbox']
```

### Error: "Running as root without --no-sandbox"
```bash
# Buat user non-root
sudo adduser skemaraja
sudo chown -R skemaraja:skemaraja /var/www/skemaraja
su - skemaraja
```

### PM2 Commands
```bash
pm2 status          # Lihat status
pm2 logs            # Lihat log
pm2 restart all     # Restart semua
pm2 stop all        # Stop semua
```

---

## 📱 Fonnte WhatsApp Setup

1. Daftar di [fonnte.com](https://fonnte.com)
2. Dapatkan **Account Token** dari dashboard
3. Masukkan di dashboard SKEMARAJA
4. Klik "Load Devices" → Pilih device
5. Scan QR code jika belum terkoneksi

---

## 📄 License

MIT License - Free to use and modify.

## 👨‍💻 Author

Developed for KSOP Gorontalo
