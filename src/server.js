/**
 * SKEMA RAJA Auto Check-in - Web Dashboard Server
 * 
 * Express server providing:
 * - Dashboard UI for configuration
 * - API endpoints for users, config, check-in
 * - Fonnte WhatsApp integration (Account Token, Device list, QR scan)
 * - Real-time logs
 */

import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { performCheckin, fetchPegawaiFromAPI, sendWhatsAppNotification } from './checkin.js';
import { logger } from './logger.js';
import { isHoliday, isWeekend, getWitaTime } from './utils.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Config file paths
const CONFIG_FILE = process.env.CONFIG_FILE || './config.json';
const USERS_FILE = process.env.USERS_FILE || './users.json';
const LOGS_FILE = process.env.LOGS_FILE || './logs.json';

// Default config
const DEFAULT_CONFIG = {
    kodeKantor: '004036057000000',
    status: '2',
    shift: '1',
    latitude: 0.537831,
    longitude: 123.058388,
    locationName: 'KSOP Gorontalo',
    timezone: 'Asia/Makassar',
    fonnteAccountToken: '',
    fonnteToken: '',
    fonnteDeviceNumber: '',
    fonnteDeviceName: '',
    schedules: [
        { name: 'Pagi', startHour: 7, startMinute: 0, endHour: 8, endMinute: 0, enabled: true },
        { name: 'Siang', startHour: 12, startMinute: 5, endHour: 13, endMinute: 0, enabled: true },
        { name: 'Sore', startHour: 17, startMinute: 0, endHour: 18, endMinute: 0, enabled: true }
    ]
};

// Helper functions
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) };
        }
    } catch (e) { console.error('Error loading config:', e); }
    return DEFAULT_CONFIG;
}

function saveConfigFile(config) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
        }
    } catch (e) { console.error('Error loading users:', e); }
    return [];
}

function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function loadLogs() {
    try {
        if (fs.existsSync(LOGS_FILE)) {
            const logs = JSON.parse(fs.readFileSync(LOGS_FILE, 'utf-8'));
            return logs.slice(-100);
        }
    } catch (e) { console.error('Error loading logs:', e); }
    return [];
}

function addLog(log) {
    const logs = loadLogs();
    logs.push({ ...log, timestamp: new Date().toISOString() });
    fs.writeFileSync(LOGS_FILE, JSON.stringify(logs.slice(-100), null, 2));
}

// Get current schedule name based on WITA time
function getScheduleName() {
    const now = getWitaTime();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const totalMinutes = hour * 60 + minute;

    // Pagi: 07:00 - 08:00 (420 - 480)
    if (totalMinutes >= 420 && totalMinutes < 480) return 'Pagi';
    // Siang: 12:00 - 13:00 (720 - 780)
    if (totalMinutes >= 720 && totalMinutes < 780) return 'Siang';
    // Sore: 17:00 - 18:00 (1020 - 1080)
    if (totalMinutes >= 1020 && totalMinutes < 1080) return 'Sore';

    // Manual check (outside schedule)
    if (hour < 12) return 'Pagi';
    if (hour < 16) return 'Siang';
    return 'Sore';
}

// ============== API Routes ==============

// Get config
app.get('/api/config', (req, res) => {
    res.json({ success: true, config: loadConfig() });
});

// Save config
app.post('/api/config', (req, res) => {
    const config = { ...loadConfig(), ...req.body };
    saveConfigFile(config);
    res.json({ success: true, message: 'Config saved' });
});

// Get users
app.get('/api/users', (req, res) => {
    res.json({ success: true, users: loadUsers() });
});

// Save user
app.post('/api/users', (req, res) => {
    const users = loadUsers();
    const index = users.findIndex(u => u.nip === req.body.nip);
    if (index >= 0) {
        users[index] = { ...users[index], ...req.body };
    } else {
        users.push({ ...req.body, enabled: true, createdAt: new Date().toISOString() });
    }
    saveUsers(users);
    res.json({ success: true, message: 'User saved' });
});

// Delete user
app.delete('/api/users', (req, res) => {
    const users = loadUsers().filter(u => u.nip !== req.body.nip);
    saveUsers(users);
    res.json({ success: true, message: 'User deleted' });
});

// Toggle user
app.post('/api/users/toggle', (req, res) => {
    const users = loadUsers();
    const user = users.find(u => u.nip === req.body.nip);
    if (user) {
        user.enabled = !user.enabled;
        saveUsers(users);
    }
    res.json({ success: true, message: 'User toggled' });
});

// Delete all users
app.delete('/api/users/all', (req, res) => {
    saveUsers([]);
    res.json({ success: true, message: 'All users deleted' });
});

// Get logs
app.get('/api/logs', (req, res) => {
    res.json({ success: true, logs: loadLogs() });
});

// Clear logs
app.delete('/api/logs', (req, res) => {
    fs.writeFileSync(LOGS_FILE, '[]');
    res.json({ success: true, message: 'Logs cleared' });
});

// Fetch pegawai from API
app.get('/api/pegawai', async (req, res) => {
    const kodeKantor = req.query.kode_kantor || loadConfig().kodeKantor;
    const result = await fetchPegawaiFromAPI(kodeKantor);
    res.json(result);
});

// Trigger check-in
app.post('/api/trigger', async (req, res) => {
    const config = loadConfig();
    const users = loadUsers().filter(u => u.enabled && u.nip && u.password);

    if (users.length === 0) {
        return res.json({ success: false, message: 'No enabled users found' });
    }

    // Run in background
    runCheckin(users, config, 'manual').catch(console.error);

    res.json({
        success: true,
        message: `Check-in started for ${users.length} users`,
        timestamp: new Date().toISOString()
    });
});

// Check-in single user
app.post('/api/checkin', async (req, res) => {
    const config = loadConfig();
    const { nip, password, scheduleName } = req.body;
    const schedule = scheduleName || getScheduleName();

    try {
        addLog({ type: 'info', user: nip, message: `Memulai check-in ${schedule}...` });

        const result = await performCheckin({
            nip,
            password,
            status: config.status,
            shift: config.shift,
            latitude: config.latitude,
            longitude: config.longitude,
            headless: true,
            slowMo: 50
        });

        // Format message with schedule name
        let logMessage;
        if (result.success) {
            if (result.checkinTime) {
                logMessage = `Telah melakukan check-in ${schedule} pukul ${result.checkinTime}`;
            } else {
                logMessage = `Check-in ${schedule} berhasil!`;
            }
        } else {
            logMessage = `Gagal check-in ${schedule}: ${result.message}`;
        }

        addLog({
            type: result.success ? 'success' : 'error',
            user: nip,
            message: logMessage,
            checkinTime: result.checkinTime,
            schedule
        });

        res.json({ ...result, schedule, formattedMessage: logMessage });
    } catch (error) {
        addLog({ type: 'error', user: nip, message: `Gagal check-in ${schedule}: ${error.message}` });
        res.json({ success: false, message: error.message, schedule });
    }
});

// Save location
app.post('/api/location', (req, res) => {
    const config = loadConfig();
    config.latitude = req.body.latitude;
    config.longitude = req.body.longitude;
    config.locationName = req.body.name;
    saveConfigFile(config);
    res.json({ success: true, message: 'Location saved' });
});

// ============== Fonnte API Routes ==============

// Fonnte status
app.get('/api/fonnte/status', async (req, res) => {
    const config = loadConfig();
    const accountToken = config.fonnteAccountToken;

    if (!accountToken) {
        return res.json({
            success: true,
            status: 'unknown',
            hasToken: !!config.fonnteToken,
            message: 'Account Token belum diset'
        });
    }

    try {
        const response = await fetch('https://api.fonnte.com/get-devices', {
            method: 'POST',
            headers: { 'Authorization': accountToken }
        });
        const data = await response.json();

        if (data.status === true && data.data && data.data.length > 0) {
            const device = data.data[0];
            const isConnected = device.status === 'connect';

            return res.json({
                success: true,
                status: isConnected ? 'connected' : 'disconnected',
                hasToken: !!config.fonnteToken,
                device: {
                    name: device.name,
                    number: device.device,
                    quota: device.quota,
                    expired: device.expired
                }
            });
        } else {
            return res.json({
                success: true,
                status: 'disconnected',
                hasToken: !!config.fonnteToken,
                message: 'Tidak ada device yang terhubung'
            });
        }
    } catch (error) {
        return res.json({ success: false, status: 'error', message: error.message });
    }
});

// Get Fonnte devices
app.get('/api/fonnte/devices', async (req, res) => {
    const config = loadConfig();
    const accountToken = config.fonnteAccountToken;

    if (!accountToken) {
        return res.json({ success: false, message: 'Account Token belum diset' });
    }

    try {
        const response = await fetch('https://api.fonnte.com/get-devices', {
            method: 'POST',
            headers: { 'Authorization': accountToken }
        });
        const data = await response.json();

        if (data.status === true && data.data) {
            return res.json({ success: true, devices: data.data });
        } else {
            return res.json({ success: false, message: data.reason || 'Gagal mengambil daftar device' });
        }
    } catch (error) {
        return res.json({ success: false, message: error.message });
    }
});

// Get Fonnte QR
app.post('/api/fonnte/qr', async (req, res) => {
    const config = loadConfig();
    const { deviceToken } = req.body;
    const token = deviceToken || config.fonnteToken;

    if (!token) {
        return res.json({ success: false, message: 'Device Token tidak ditemukan' });
    }

    try {
        const response = await fetch('https://api.fonnte.com/qr', {
            method: 'POST',
            headers: { 'Authorization': token },
            body: new URLSearchParams({ type: 'qr' })
        });
        const data = await response.json();

        if (data.status === true && data.url) {
            return res.json({ success: true, qr: data.url });
        } else {
            return res.json({ success: false, message: data.reason || data.detail || 'Gagal mendapatkan QR code' });
        }
    } catch (error) {
        return res.json({ success: false, message: error.message });
    }
});

// Save Fonnte config
app.post('/api/fonnte/save', (req, res) => {
    const config = loadConfig();
    const { accountToken, deviceToken, deviceNumber, deviceName } = req.body;

    if (accountToken !== undefined) config.fonnteAccountToken = accountToken;
    if (deviceToken !== undefined) config.fonnteToken = deviceToken;
    if (deviceNumber !== undefined) config.fonnteDeviceNumber = deviceNumber;
    if (deviceName !== undefined) config.fonnteDeviceName = deviceName;

    saveConfigFile(config);
    res.json({ success: true, message: 'Fonnte config saved' });
});

// Disconnect Fonnte
app.post('/api/fonnte/disconnect', async (req, res) => {
    const config = loadConfig();
    const deviceToken = config.fonnteToken;

    if (!deviceToken) {
        return res.json({ success: false, message: 'Device Token tidak ditemukan' });
    }

    try {
        const response = await fetch('https://api.fonnte.com/disconnect', {
            method: 'POST',
            headers: { 'Authorization': deviceToken }
        });
        const data = await response.json();

        if (data.status === true) {
            return res.json({ success: true, message: 'Device berhasil di-disconnect' });
        } else {
            return res.json({ success: false, message: data.reason || 'Gagal disconnect device' });
        }
    } catch (error) {
        return res.json({ success: false, message: error.message });
    }
});

// ============== Dashboard HTML ==============

app.get('/', (req, res) => {
    const config = loadConfig();
    const users = loadUsers();
    const logs = loadLogs().slice(-20).reverse();

    res.send(getDashboardHTML(config, users, logs));
});

function getDashboardHTML(config, users, logs) {
    return `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SKEMA RAJA Auto Check-in - Puppeteer</title>
    <style>
        :root { --primary: #6366f1; --success: #10b981; --danger: #ef4444; --warning: #f59e0b; --bg: #0f172a; --card: #1e293b; --text: #f8fafc; --text-muted: #94a3b8; --border: #334155; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        header { text-align: center; padding: 30px 0; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 16px; margin-bottom: 30px; }
        header h1 { font-size: 2rem; font-weight: 700; margin-bottom: 8px; }
        header p { color: rgba(255,255,255,0.8); }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .card { background: var(--card); border-radius: 12px; padding: 24px; border: 1px solid var(--border); }
        .card h2 { font-size: 1.1rem; margin-bottom: 16px; color: var(--text-muted); }
        .form-group { margin-bottom: 16px; }
        label { display: block; margin-bottom: 6px; color: var(--text-muted); font-size: 0.9rem; }
        input, select { width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); font-size: 1rem; }
        button { padding: 12px 24px; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: all 0.2s; }
        .btn-primary { background: var(--primary); color: white; }
        .btn-success { background: var(--success); color: white; }
        .btn-warning { background: var(--warning); color: white; }
        .btn-danger { background: var(--danger); color: white; }
        .btn-sm { padding: 6px 12px; font-size: 0.8rem; }
        .btn-block { width: 100%; }
        .user-list { list-style: none; max-height: 400px; overflow-y: auto; }
        .user-item { display: flex; justify-content: space-between; align-items: center; padding: 12px; background: var(--bg); border-radius: 8px; margin-bottom: 8px; }
        .user-info strong { color: var(--text); }
        .user-info small { color: var(--text-muted); display: block; }
        .log-list { max-height: 400px; overflow-y: auto; }
        .log-item { padding: 12px; background: var(--bg); border-radius: 8px; margin-bottom: 8px; font-family: monospace; font-size: 0.85rem; }
        .log-item.success { border-left: 3px solid var(--success); }
        .log-item.error { border-left: 3px solid var(--danger); }
        .status-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 600; cursor: pointer; }
        .status-badge.enabled { background: var(--success); }
        .status-badge.disabled { background: var(--danger); }
        .actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .flex-row { display: flex; gap: 8px; }
        @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🖥️ SKEMA RAJA Auto Check-in</h1>
            <p>Puppeteer Version - Local Dashboard</p>
        </header>
        
        <div class="grid">
            <div class="card">
                <h2>➕ Tambah Pegawai</h2>
                <p style="color: var(--text-muted); margin-bottom: 16px; font-size: 0.9rem;">Pilih pegawai dari daftar. Password = NIP otomatis.</p>
                <div class="form-group">
                    <label>Kode Kantor</label>
                    <input type="text" id="kodeKantor" value="${config.kodeKantor}">
                </div>
                <button onclick="loadPegawaiList()" class="btn-primary btn-block" style="margin-bottom: 16px;">📋 Load Daftar Pegawai</button>
                <div class="form-group" id="pegawaiSelectGroup" style="display: none;">
                    <label>Pilih Pegawai</label>
                    <select id="pegawaiSelect" style="margin-bottom: 12px;"></select>
                    <button onclick="addSelectedPegawai()" class="btn-success btn-block">➕ Tambah Pegawai Terpilih</button>
                </div>
                <div id="addResult"></div>
            </div>
            
            <div class="card">
                <h2>⚡ Manual Check-in</h2>
                <p style="color: var(--text-muted); margin-bottom: 16px;">Trigger check-in untuk semua user aktif</p>
                <button onclick="triggerCheckin()" class="btn-success btn-block">⚡ Trigger Check-in Sekarang</button>
                <div id="checkinResult" style="margin-top: 16px;"></div>
            </div>
        </div>
        
        <div class="grid">
            <div class="card">
                <h2>📍 Lokasi Kantor</h2>
                <div class="form-group">
                    <label>Nama Lokasi</label>
                    <input type="text" id="locName" value="${config.locationName}">
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div class="form-group">
                        <label>Latitude</label>
                        <input type="text" id="locLat" value="${config.latitude}">
                    </div>
                    <div class="form-group">
                        <label>Longitude</label>
                        <input type="text" id="locLng" value="${config.longitude}">
                    </div>
                </div>
                <button onclick="saveLocation()" class="btn-primary btn-block">💾 Simpan Lokasi</button>
            </div>
            
            <div class="card">
                <h2>📱 Fonnte WhatsApp</h2>
                <div id="waStatus" style="margin-bottom: 16px; padding: 12px; background: var(--bg); border-radius: 8px;">
                    <span id="waStatusIcon">⏳</span> <span id="waStatusText">Mengecek status...</span>
                </div>
                
                <div class="form-group">
                    <label>Account Token (dari fonnte.com)</label>
                    <div class="flex-row">
                        <input type="password" id="fonnteAccountToken" placeholder="Masukkan Account Token" style="flex: 1;">
                        <button onclick="loadFonnteDevices()" class="btn-primary btn-sm">🔄 Load</button>
                    </div>
                </div>
                
                <div id="fonnteDeviceList" style="margin-bottom: 16px; display: none;">
                    <div class="form-group">
                        <label>Pilih Device</label>
                        <select id="fonnteDeviceSelect" onchange="onDeviceSelected()"></select>
                    </div>
                    <div id="deviceInfo" style="padding: 12px; background: var(--bg); border-radius: 8px; display: none; margin-bottom: 12px; font-size: 0.85rem;">
                        <div><strong>Nama:</strong> <span id="deviceInfoName">-</span></div>
                        <div><strong>Nomor:</strong> <span id="deviceInfoNumber">-</span></div>
                        <div><strong>Status:</strong> <span id="deviceInfoStatus">-</span></div>
                        <div><strong>Quota:</strong> <span id="deviceInfoQuota">-</span></div>
                    </div>
                </div>
                
                <div class="flex-row" style="flex-wrap: wrap;">
                    <button onclick="saveFonnteConfig()" class="btn-success btn-sm">💾 Simpan</button>
                    <button id="btnConnectDevice" onclick="toggleFonnteDevice()" class="btn-primary btn-sm">📲 Connect</button>
                    <button onclick="checkFonnteStatus()" class="btn-warning btn-sm">🔍 Cek Status</button>
                </div>
            </div>
        </div>
        
        <!-- Schedule Info Card -->
        <div class="card" style="margin-bottom: 30px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);">
            <h2 style="color: white; margin-bottom: 16px;">🔔 Jadwal Auto Check-in (WITA)</h2>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
                ${config.schedules.map(s => {
        const icons = { 'Pagi': '🌅', 'Siang': '☀️', 'Sore': '🌆' };
        const times = { 'Pagi': '07:00', 'Siang': '12:05', 'Sore': '17:00' };
        return '<div style="background: rgba(255,255,255,0.15); border-radius: 12px; padding: 16px; backdrop-filter: blur(10px);">' +
            '<div style="font-size: 18px; font-weight: 700; color: white; margin-bottom: 8px;">' + (icons[s.name] || '⏰') + ' ' + s.name + '</div>' +
            '<div style="color: rgba(255,255,255,0.9); font-size: 24px; font-weight: 600;">' + (times[s.name] || '00:00') + '</div>' +
            '<div style="color: rgba(255,255,255,0.7); font-size: 12px; margin-top: 4px;">Rentang: ' +
            String(s.startHour).padStart(2, '0') + ':' + String(s.startMinute).padStart(2, '0') + ' - ' +
            String(s.endHour).padStart(2, '0') + ':' + String(s.endMinute).padStart(2, '0') + '</div>' +
            '<div style="margin-top: 8px;"><span style="background: ' + (s.enabled ? 'rgba(16,185,129,0.8)' : 'rgba(239,68,68,0.8)') + '; padding: 4px 12px; border-radius: 20px; font-size: 11px; color: white;">' + (s.enabled ? '✅ Aktif' : '❌ Nonaktif') + '</span></div></div>';
    }).join('')}
            </div>
            <div style="margin-top: 16px; padding: 12px; background: rgba(255,255,255,0.1); border-radius: 8px; color: rgba(255,255,255,0.9); font-size: 13px;">
                <strong>ℹ️ Info:</strong> Auto check-in via cron (npm start). Senin-Jumat. Random delay 0-30 detik. Skip jika sudah check-in.
            </div>
        </div>
        
        <div class="card" style="margin-bottom: 30px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <h2 style="margin: 0;">👥 Daftar User (<span id="userCount">${users.length}</span>)</h2>
                <button onclick="deleteAllUsers()" class="btn-danger btn-sm">🗑️ Hapus Semua</button>
            </div>
            <ul class="user-list" id="userList">
                ${users.length === 0 ? '<li class="user-item" style="color: var(--text-muted);">Belum ada user</li>' : users.map(u => `
                    <li class="user-item">
                        <div class="user-info">
                            <strong>${u.name || u.nip}</strong>
                            <small>NIP: ${u.nip} | 📱 ${u.phone || '<span style="color:#ef4444">Belum diisi</span>'}</small>
                        </div>
                        <div class="actions">
                            <button onclick="editUser('${u.nip}', '${(u.name || '').replace(/'/g, "\\'")}', '${u.phone || ''}')" class="btn-primary btn-sm" title="Edit">✏️</button>
                            <button onclick="checkinUser('${u.nip}', '${u.password}')" class="btn-success btn-sm" title="Check-in">🚀</button>
                            <button onclick="deleteUser('${u.nip}')" class="btn-danger btn-sm" title="Hapus">🗑️</button>
                            <span class="status-badge ${u.enabled ? 'enabled' : 'disabled'}" onclick="toggleUser('${u.nip}')">${u.enabled ? 'ON' : 'OFF'}</span>
                        </div>
                    </li>
                `).join('')}
            </ul>
        </div>
        
        <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <h2 style="margin: 0;">📜 Log Terbaru</h2>
                <button onclick="clearLogs()" class="btn-danger btn-sm">🗑️ Clear</button>
            </div>
            <div class="log-list" id="logList">
                ${logs.length === 0 ? '<p style="color: var(--text-muted);">Belum ada log</p>' : logs.map(log => `
                    <div class="log-item ${log.type || 'info'}">
                        <strong>${new Date(log.timestamp).toLocaleString('id-ID')}</strong>
                        ${log.user ? ` [${log.user}]` : ''}: ${log.message}
                        ${log.checkinTime ? ` ⏰ ${log.checkinTime}` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    </div>
    
    <!-- Edit User Modal -->
    <div id="editUserModal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 9999; align-items: center; justify-content: center;">
        <div style="background: var(--card); padding: 24px; border-radius: 16px; width: 90%; max-width: 400px; border: 1px solid var(--border);">
            <h3 style="margin-bottom: 20px; color: var(--text);">✏️ Edit User</h3>
            <input type="hidden" id="editUserNip">
            <div class="form-group">
                <label>Nama</label>
                <input type="text" id="editUserName" placeholder="Nama pegawai">
            </div>
            <div class="form-group">
                <label>Nomor HP (untuk notifikasi WA)</label>
                <input type="text" id="editUserPhone" placeholder="contoh: 081234567890">
                <small style="color: var(--text-muted);">Format: 08xxx atau 62xxx. Notifikasi dikirim setelah check-in.</small>
            </div>
            <div style="display: flex; gap: 12px; margin-top: 20px;">
                <button onclick="saveUserEdit()" class="btn-success btn-block">💾 Simpan</button>
                <button onclick="closeEditModal()" class="btn-danger btn-block">❌ Batal</button>
            </div>
        </div>
    </div>
    
    <script>
        const API_BASE = '';
        let fonnteDevices = [];
        let isDeviceConnected = false;
        
        // ===== Pegawai Functions =====
        async function loadPegawaiList() {
            const kodeKantor = document.getElementById('kodeKantor').value;
            document.getElementById('addResult').innerHTML = '<div class="log-item">⏳ Loading...</div>';
            
            try {
                // Fetch directly from SKEMARAJA (not blocked from browser)
                const res = await fetch('https://skemaraja.kemenhub.go.id/api/pegawaiSelect?kode_kantor=' + kodeKantor);
                const data = await res.json();
                
                if (!data.results || data.results.length === 0) {
                    document.getElementById('addResult').innerHTML = '<div class="log-item error">Tidak ada pegawai ditemukan</div>';
                    return;
                }
                
                const select = document.getElementById('pegawaiSelect');
                select.innerHTML = '<option value="">-- Pilih Pegawai (' + data.results.length + ') --</option>' +
                    data.results.map(p => '<option value="' + p.id + '" data-name="' + p.text + '">' + p.text + ' (' + p.id + ')</option>').join('');
                
                document.getElementById('pegawaiSelectGroup').style.display = 'block';
                document.getElementById('addResult').innerHTML = '<div class="log-item success">✅ Loaded ' + data.results.length + ' pegawai</div>';
            } catch (err) {
                document.getElementById('addResult').innerHTML = '<div class="log-item error">❌ Error: ' + err.message + '</div>';
            }
        }
        
        async function addSelectedPegawai() {
            const select = document.getElementById('pegawaiSelect');
            const nip = select.value;
            const name = select.options[select.selectedIndex].getAttribute('data-name');
            if (!nip) return alert('Pilih pegawai terlebih dahulu');
            
            const res = await fetch('/api/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nip, password: nip, name, enabled: true })
            });
            if (res.ok) {
                document.getElementById('addResult').innerHTML = '<div class="log-item success">✅ ' + name + ' berhasil ditambahkan!</div>';
                setTimeout(() => location.reload(), 1000);
            }
        }
        
        // ===== Check-in Functions =====
        async function triggerCheckin() {
            document.getElementById('checkinResult').innerHTML = '<div class="log-item">⏳ Starting check-in...</div>';
            const res = await fetch('/api/trigger', { method: 'POST' });
            const data = await res.json();
            document.getElementById('checkinResult').innerHTML = '<div class="log-item ' + (data.success ? 'success' : 'error') + '">' + (data.success ? '✅ ' : '❌ ') + data.message + '</div>';
        }
        
        async function checkinUser(nip, password) {
            if (!confirm('Check-in untuk NIP: ' + nip + '?')) return;
            
            document.getElementById('checkinResult').innerHTML = '<div class="log-item">⏳ Processing...</div>';
            const res = await fetch('/api/checkin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nip, password })
            });
            const data = await res.json();
            alert(data.success ? '✅ ' + data.message : '❌ ' + data.message);
            location.reload();
        }
        
        async function deleteUser(nip) {
            if (!confirm('Hapus user ' + nip + '?')) return;
            await fetch('/api/users', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nip })
            });
            location.reload();
        }
        
        async function toggleUser(nip) {
            await fetch('/api/users/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nip })
            });
            location.reload();
        }
        
        // ===== Edit User Functions =====
        function editUser(nip, name, phone) {
            document.getElementById('editUserNip').value = nip;
            document.getElementById('editUserName').value = name || '';
            document.getElementById('editUserPhone').value = phone || '';
            document.getElementById('editUserModal').style.display = 'flex';
        }
        
        function closeEditModal() {
            document.getElementById('editUserModal').style.display = 'none';
        }
        
        async function saveUserEdit() {
            const nip = document.getElementById('editUserNip').value;
            const name = document.getElementById('editUserName').value.trim();
            const phone = document.getElementById('editUserPhone').value.trim().replace(/\D/g, '');
            
            const res = await fetch('/api/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nip, name, phone })
            });
            
            if (res.ok) {
                alert('✅ User berhasil diupdate!');
                location.reload();
            } else {
                alert('❌ Gagal menyimpan');
            }
        }
        
        async function deleteAllUsers() {
            if (!confirm('⚠️ HAPUS SEMUA USER?\\n\\nIni akan menghapus semua ' + document.getElementById('userCount').textContent + ' user!')) return;
            if (!confirm('Yakin? Tindakan ini tidak bisa dibatalkan!')) return;
            
            await fetch('/api/users/all', { method: 'DELETE' });
            location.reload();
        }
        
        // ===== Location Functions =====
        async function saveLocation() {
            const res = await fetch('/api/location', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: document.getElementById('locName').value,
                    latitude: parseFloat(document.getElementById('locLat').value),
                    longitude: parseFloat(document.getElementById('locLng').value)
                })
            });
            if (res.ok) alert('✅ Lokasi tersimpan!');
        }
        
        // ===== Fonnte Functions =====
        async function checkFonnteStatus() {
            const statusEl = document.getElementById('waStatus');
            const iconEl = document.getElementById('waStatusIcon');
            const textEl = document.getElementById('waStatusText');
            
            statusEl.style.background = 'var(--bg)';
            iconEl.textContent = '⏳';
            textEl.textContent = 'Mengecek status...';
            
            try {
                const res = await fetch('/api/fonnte/status');
                const data = await res.json();
                
                if (data.success) {
                    if (data.status === 'connected') {
                        statusEl.style.background = 'rgba(16,185,129,0.2)';
                        iconEl.textContent = '🟢';
                        textEl.innerHTML = '<strong>Connected</strong> - ' + (data.device?.name || '') + ' (' + (data.device?.number || '') + ')';
                        updateConnectButton(true);
                    } else if (data.status === 'disconnected') {
                        statusEl.style.background = 'rgba(239,68,68,0.2)';
                        iconEl.textContent = '🔴';
                        textEl.textContent = 'Disconnected';
                        updateConnectButton(false);
                    } else {
                        statusEl.style.background = 'rgba(245,158,11,0.2)';
                        iconEl.textContent = '⚠️';
                        textEl.textContent = data.message || 'Status tidak diketahui';
                        updateConnectButton(false);
                    }
                }
            } catch (err) {
                statusEl.style.background = 'rgba(239,68,68,0.2)';
                iconEl.textContent = '❌';
                textEl.textContent = 'Error: ' + err.message;
            }
        }
        
        function updateConnectButton(connected) {
            isDeviceConnected = connected;
            const btn = document.getElementById('btnConnectDevice');
            btn.innerHTML = connected ? '🔌 Disconnect' : '📲 Connect';
            btn.className = connected ? 'btn-danger btn-sm' : 'btn-primary btn-sm';
        }
        
        async function loadFonnteDevices() {
            const accountToken = document.getElementById('fonnteAccountToken').value.trim();
            
            if (accountToken) {
                await fetch('/api/fonnte/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ accountToken })
                });
            }
            
            try {
                const res = await fetch('/api/fonnte/devices');
                const data = await res.json();
                
                if (data.success) {
                    fonnteDevices = data.devices;
                    const select = document.getElementById('fonnteDeviceSelect');
                    select.innerHTML = '<option value="">-- Pilih Device (' + data.devices.length + ') --</option>' +
                        data.devices.map((d, i) => '<option value="' + i + '">' + (d.status === 'connect' ? '🟢' : '🔴') + ' ' + d.name + ' (' + d.device + ')</option>').join('');
                    
                    document.getElementById('fonnteDeviceList').style.display = 'block';
                    alert('✅ Ditemukan ' + data.devices.length + ' device');
                } else {
                    alert('❌ ' + data.message);
                }
            } catch (err) {
                alert('❌ Error: ' + err.message);
            }
        }
        
        function onDeviceSelected() {
            const index = document.getElementById('fonnteDeviceSelect').value;
            if (index === '' || !fonnteDevices[index]) {
                document.getElementById('deviceInfo').style.display = 'none';
                return;
            }
            
            const device = fonnteDevices[index];
            document.getElementById('deviceInfoName').textContent = device.name;
            document.getElementById('deviceInfoNumber').textContent = device.device;
            document.getElementById('deviceInfoStatus').textContent = device.status === 'connect' ? '🟢 Connected' : '🔴 Disconnected';
            document.getElementById('deviceInfoQuota').textContent = device.quota || 'N/A';
            document.getElementById('deviceInfo').style.display = 'block';
        }
        
        async function saveFonnteConfig() {
            const index = document.getElementById('fonnteDeviceSelect').value;
            const accountToken = document.getElementById('fonnteAccountToken').value.trim();
            
            let deviceToken = '', deviceNumber = '', deviceName = '';
            if (index !== '' && fonnteDevices[index]) {
                const device = fonnteDevices[index];
                deviceToken = device.token;
                deviceNumber = device.device;
                deviceName = device.name;
            }
            
            const res = await fetch('/api/fonnte/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountToken, deviceToken, deviceNumber, deviceName })
            });
            const data = await res.json();
            alert(data.success ? '✅ ' + data.message : '❌ ' + data.message);
            checkFonnteStatus();
        }
        
        async function toggleFonnteDevice() {
            if (isDeviceConnected) {
                // Disconnect
                const res = await fetch('/api/fonnte/disconnect', { method: 'POST' });
                const data = await res.json();
                alert(data.success ? '✅ ' + data.message : '❌ ' + data.message);
                checkFonnteStatus();
            } else {
                // Connect - Get QR
                const index = document.getElementById('fonnteDeviceSelect').value;
                let deviceToken = '';
                if (index !== '' && fonnteDevices[index]) {
                    deviceToken = fonnteDevices[index].token;
                }
                
                const res = await fetch('/api/fonnte/qr', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ deviceToken })
                });
                const data = await res.json();
                
                if (data.success && data.qr) {
                    const qrSrc = data.qr.startsWith('data:') ? data.qr : 'data:image/png;base64,' + data.qr;
                    const modal = document.createElement('div');
                    modal.id = 'qrModal';
                    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:9999;';
                    modal.innerHTML = '<div style="background:white;padding:24px;border-radius:16px;text-align:center;max-width:400px;" onclick="event.stopPropagation()"><h3 style="margin-bottom:16px;color:#333;">📱 Scan QR Code</h3><img src="' + qrSrc + '" style="max-width:300px;border-radius:8px;"><p style="margin-top:16px;color:#666;">Buka WhatsApp > Linked Devices > Scan QR</p><button onclick="document.getElementById(\\'qrModal\\').remove();checkFonnteStatus();" style="margin-top:16px;padding:12px 24px;background:#6366f1;color:white;border:none;border-radius:8px;cursor:pointer;">✅ Selesai</button></div>';
                    modal.onclick = () => { modal.remove(); checkFonnteStatus(); };
                    document.body.appendChild(modal);
                } else {
                    alert('❌ ' + (data.message || 'Gagal mendapatkan QR'));
                }
            }
        }
        
        async function clearLogs() {
            if (!confirm('Hapus semua log?')) return;
            await fetch('/api/logs', { method: 'DELETE' });
            location.reload();
        }
        
        // Init
        checkFonnteStatus();
        
        // Auto-refresh logs
        setInterval(() => {
            fetch('/api/logs').then(r => r.json()).then(data => {
                const list = document.getElementById('logList');
                if (data.logs && data.logs.length > 0) {
                    list.innerHTML = data.logs.slice(-20).reverse().map(log => 
                        '<div class="log-item ' + (log.type || 'info') + '"><strong>' + 
                        new Date(log.timestamp).toLocaleString('id-ID') + '</strong>' +
                        (log.user ? ' [' + log.user + ']' : '') + ': ' + log.message +
                        (log.checkinTime ? ' ⏰ ' + log.checkinTime : '') + '</div>'
                    ).join('');
                }
            }).catch(() => {});
        }, 5000);
    </script>
</body>
</html>`;
}

// ============== Check-in Runner ==============

async function runCheckin(users, config, scheduleName = 'manual') {
    // Get schedule name if auto
    const schedule = scheduleName === 'manual' ? getScheduleName() : scheduleName;

    addLog({ type: 'info', message: `Memulai check-in ${schedule} untuk ${users.length} user` });

    for (let i = 0; i < users.length; i++) {
        const user = users[i];

        try {
            // Random delay
            const delay = Math.random() * 30000;
            if (delay > 1000) {
                await new Promise(r => setTimeout(r, delay));
            }

            addLog({ type: 'info', user: user.name || user.nip, message: `Memulai check-in ${schedule}...` });

            const result = await performCheckin({
                nip: user.nip,
                password: user.password,
                status: config.status,
                shift: config.shift,
                latitude: config.latitude,
                longitude: config.longitude,
                headless: true,
                slowMo: 50
            });

            // Format message with schedule name
            let logMessage;
            if (result.success) {
                if (result.checkinTime) {
                    logMessage = `Telah melakukan check-in ${schedule} pukul ${result.checkinTime}`;
                } else {
                    logMessage = `Check-in ${schedule} berhasil!`;
                }
            } else {
                logMessage = `Gagal check-in ${schedule}: ${result.message}`;
            }

            addLog({
                type: result.success ? 'success' : 'error',
                user: user.name || user.nip,
                message: logMessage,
                checkinTime: result.checkinTime,
                schedule
            });

            // Send WhatsApp notification to user's phone
            if (config.fonnteToken && user.phone) {
                const waMessage = result.success
                    ? `✅ *SKEMA RAJA*\n\nHalo ${user.name || 'Bapak/Ibu'},\n\n${logMessage}\n\n📍 Lokasi: ${config.locationName}`
                    : `❌ *SKEMA RAJA*\n\nHalo ${user.name || 'Bapak/Ibu'},\n\n${logMessage}\n\nSilakan cek manual di skemaraja.kemenhub.go.id`;

                await sendWhatsAppNotification({
                    user,
                    schedule: { name: schedule, status_wfh: config.status },
                    success: result.success,
                    message: waMessage,
                    fonnteToken: config.fonnteToken,
                    locationName: config.locationName
                });
            }

            // Inter-user delay
            if (i < users.length - 1) {
                await new Promise(r => setTimeout(r, 3000 + Math.random() * 5000));
            }

        } catch (error) {
            addLog({ type: 'error', user: user.name || user.nip, message: `Gagal check-in ${schedule}: ${error.message}` });
        }
    }

    addLog({ type: 'info', message: `Check-in ${schedule} selesai untuk ${users.length} user` });
}

// Start server
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════╗
║  🖥️  SKEMA RAJA Auto Check-in - Puppeteer Version   ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  Dashboard: http://localhost:${PORT}                    ║
║                                                      ║
║  Commands:                                           ║
║  - npm run server   : Start dashboard                ║
║  - npm run checkin  : Manual check-in                ║
║  - npm run sync     : Sync users from API            ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
`);
});

export { runCheckin };
