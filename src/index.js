/**
 * SKEMA RAJA Auto Check-in - Puppeteer Version
 * 
 * Features:
 * - Human-like browser automation with stealth plugin
 * - WITA timezone schedules (Pagi, Siang, Sore)
 * - Fonnte WhatsApp notifications
 * - Skip weekends and holidays
 * - Random delays between users
 */

import 'dotenv/config';
import cron from 'node-cron';
import { performCheckin, fetchPegawaiFromAPI, sendWhatsAppNotification } from './checkin.js';
import { logger } from './logger.js';
import { isHoliday, isWeekend, getWitaTime } from './utils.js';
import fs from 'fs';

const config = {
    kodeKantor: process.env.KODE_KANTOR || '004036057000000',
    status: process.env.STATUS || '2',
    shift: process.env.SHIFT || '1',
    latitude: parseFloat(process.env.LATITUDE) || 0.537831,
    longitude: parseFloat(process.env.LONGITUDE) || 123.058388,
    locationName: process.env.LOCATION_NAME || 'KSOP Gorontalo',
    timezone: process.env.TIMEZONE || 'Asia/Makassar',

    // Schedules
    cronPagi: process.env.CRON_PAGI || '0 7 * * 1-5',
    cronSiang: process.env.CRON_SIANG || '5 12 * * 1-5',
    cronSore: process.env.CRON_SORE || '0 17 * * 1-5',

    // Fonnte
    fonnteToken: process.env.FONNTE_TOKEN || '',

    // Browser
    headless: process.env.HEADLESS !== 'false',
    slowMo: parseInt(process.env.SLOW_MO) || 50,
    usersFile: process.env.USERS_FILE || './users.json',
};

// Schedule definitions with time ranges for random delays
// Cron triggers at start time, then random delay within the range
const SCHEDULES = [
    {
        name: 'Pagi', cron: config.cronPagi, status_wfh: '2', shift: '1',
        startMinute: 0, endMinute: 60
    },  // Random 0-60 menit dari jam 07:00
    {
        name: 'Siang', cron: config.cronSiang, status_wfh: '2', shift: '1',
        startMinute: 0, endMinute: 55
    },  // Random 0-55 menit dari jam 12:05
    {
        name: 'Sore', cron: config.cronSore, status_wfh: '2', shift: '1',
        startMinute: 0, endMinute: 60
    },  // Random 0-60 menit dari jam 17:00
];

// Helper: Get random delay within schedule range
function getRandomDelayInRange(schedule) {
    const minMs = (schedule.startMinute || 0) * 60 * 1000;
    const maxMs = (schedule.endMinute || 30) * 60 * 1000;
    return minMs + Math.random() * (maxMs - minMs);
}

// Load or fetch users
async function getUsers() {
    // Try to load from file first
    if (fs.existsSync(config.usersFile)) {
        const data = fs.readFileSync(config.usersFile, 'utf-8');
        return JSON.parse(data);
    }

    // Fetch from API
    logger.info('Fetching users from API...');
    const result = await fetchPegawaiFromAPI(config.kodeKantor);

    if (!result.success) {
        logger.error('Failed to fetch users: ' + result.error);
        return [];
    }

    // Transform and save
    const users = result.pegawai.map(p => ({
        nip: p.id,
        password: p.id, // Password = NIP
        name: p.text,
        phone: '', // Can be added manually
        enabled: true,
    }));

    fs.writeFileSync(config.usersFile, JSON.stringify(users, null, 2));
    logger.info(`Saved ${users.length} users to ${config.usersFile}`);

    return users;
}

async function runCheckin(scheduleName = 'manual') {
    const witaTime = getWitaTime();
    logger.info(`=== Starting ${scheduleName} check-in at ${witaTime.toLocaleString('id-ID')} WITA ===`);

    if (isWeekend()) {
        logger.info('⏭️ Skipping: Weekend');
        return;
    }

    if (await isHoliday()) {
        logger.info('⏭️ Skipping: Holiday');
        return;
    }

    const users = await getUsers();

    if (users.length === 0) {
        logger.error('❌ No users found');
        return;
    }

    const enabledUsers = users.filter(u => u.enabled && u.nip && u.password);
    logger.info(`👥 Processing ${enabledUsers.length} enabled users...`);

    const results = [];
    const schedule = SCHEDULES.find(s => s.name === scheduleName) || { name: scheduleName, status_wfh: config.status, shift: config.shift };

    for (let i = 0; i < enabledUsers.length; i++) {
        const user = enabledUsers[i];

        try {
            // Random delay before each user (0-30 seconds)
            const preDelay = Math.random() * 30000;
            if (preDelay > 1000) {
                logger.info(`⏳ Waiting ${Math.round(preDelay / 1000)}s before ${user.name}...`);
                await new Promise(r => setTimeout(r, preDelay));
            }

            logger.info(`🚀 [${i + 1}/${enabledUsers.length}] Processing: ${user.name}`);

            const result = await performCheckin({
                nip: user.nip,
                password: user.password,
                status: schedule.status_wfh || config.status,
                shift: schedule.shift || config.shift,
                latitude: config.latitude,
                longitude: config.longitude,
                headless: config.headless,
                slowMo: config.slowMo,
            });

            results.push({ nip: user.nip, name: user.name, ...result });

            if (result.success) {
                logger.info(`✅ ${user.name}: ${result.message}`);
            } else {
                logger.error(`❌ ${user.name}: ${result.message}`);
            }

            // Send WhatsApp notification
            if (config.fonnteToken && user.phone) {
                await sendWhatsAppNotification({
                    user,
                    schedule,
                    success: result.success,
                    message: result.message,
                    fonnteToken: config.fonnteToken,
                    locationName: config.locationName,
                });
            }

            // Inter-user delay (3-8 seconds)
            if (i < enabledUsers.length - 1) {
                const interDelay = 3000 + Math.random() * 5000;
                await new Promise(r => setTimeout(r, interDelay));
            }

        } catch (error) {
            logger.error(`❌ Error for ${user.nip}: ${error.message}`);
            results.push({ nip: user.nip, name: user.name, success: false, message: error.message });
        }
    }

    // Summary
    const success = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    logger.info(`=== Check-in complete: ${success} success, ${failed} failed ===`);

    return results;
}

// Check if manual run or specific command
const args = process.argv.slice(2);

if (args.includes('--sync')) {
    // Just sync users from API
    logger.info('📥 Syncing users from API...');
    getUsers().then(users => {
        logger.info(`✅ Synced ${users.length} users`);
        process.exit(0);
    }).catch(err => {
        logger.error('❌ Sync failed: ' + err.message);
        process.exit(1);
    });
} else if (args.includes('--manual') || args.includes('--checkin')) {
    // Run immediately
    logger.info('⚡ Manual check-in triggered');
    runCheckin('Manual')
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
} else if (args.includes('--pagi')) {
    runCheckin('Pagi').then(() => process.exit(0)).catch(() => process.exit(1));
} else if (args.includes('--siang')) {
    runCheckin('Siang').then(() => process.exit(0)).catch(() => process.exit(1));
} else if (args.includes('--sore')) {
    runCheckin('Sore').then(() => process.exit(0)).catch(() => process.exit(1));
} else {
    // Schedule cron jobs
    logger.info('🚀 Starting SKEMA RAJA Auto Check-in Service');
    logger.info(`📍 Location: ${config.locationName} (${config.latitude}, ${config.longitude})`);
    logger.info(`🕐 Timezone: ${config.timezone} (WITA)`);
    logger.info('');

    SCHEDULES.forEach(schedule => {
        const rangeMinutes = schedule.endMinute - schedule.startMinute;
        logger.info(`📅 ${schedule.name}: ${schedule.cron} (random +${schedule.startMinute}-${schedule.endMinute} menit)`);

        cron.schedule(schedule.cron, async () => {
            // Calculate random delay within schedule range
            const randomDelayMs = getRandomDelayInRange(schedule);
            const delayMinutes = Math.round(randomDelayMs / 60000);

            const witaTime = getWitaTime();
            const scheduledTime = new Date(witaTime.getTime() + randomDelayMs);
            const scheduledTimeStr = scheduledTime.toLocaleTimeString('id-ID', {
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });

            logger.info(`⏰ Cron triggered: ${schedule.name}`);
            logger.info(`🎲 Random delay: ${delayMinutes} menit`);
            logger.info(`📌 Scheduled check-in at: ${scheduledTimeStr} WITA`);

            // Wait for random delay
            if (randomDelayMs > 0) {
                await new Promise(r => setTimeout(r, randomDelayMs));
            }

            // Now run the actual check-in
            logger.info(`🚀 Starting ${schedule.name} check-in (after ${delayMinutes}m delay)`);
            runCheckin(schedule.name);
        }, { timezone: config.timezone });
    });

    logger.info('');
    logger.info('✅ Service started. Waiting for scheduled times...');
    logger.info('');
    logger.info('Commands:');
    logger.info('  npm run sync    - Sync users from API');
    logger.info('  npm run checkin - Manual check-in');
    logger.info('  npm run pagi    - Run Pagi check-in');
    logger.info('  npm run siang   - Run Siang check-in');
    logger.info('  npm run sore    - Run Sore check-in');
}
