/**
 * Puppeteer Check-in Module
 * 
 * Human-like browser automation dengan:
 * - Stealth plugin untuk anti-detection
 * - Random delays dan mouse movements
 * - Geolocation mocking
 * - Screenshot capture on error
 * - Fonnte WhatsApp notifications
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { logger } from './logger.js';
import { randomDelay, randomMouseMove } from './utils.js';
import fs from 'fs';
import path from 'path';

// Apply stealth plugin
puppeteer.use(StealthPlugin());

const SKEMARAJA_URL = 'https://skemaraja.kemenhub.go.id/';
const PEGAWAI_API_URL = 'https://skemaraja.kemenhub.go.id/api/pegawaiSelect';
const FONNTE_API = 'https://api.fonnte.com/send';

// Fetch pegawai from API
export async function fetchPegawaiFromAPI(kodeKantor) {
    try {
        const response = await fetch(PEGAWAI_API_URL + '?kode_kantor=' + kodeKantor);
        if (!response.ok) throw new Error('Failed to fetch: ' + response.status);
        const data = await response.json();
        return { success: true, pegawai: data.results || [], count: (data.results || []).length };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Send WhatsApp notification via Fonnte
export async function sendWhatsAppNotification({ user, schedule, success, message, fonnteToken, locationName }) {
    if (!user.phone || !fonnteToken) {
        return;
    }

    const phone = user.phone.replace(/\D/g, '');
    const statusEmoji = success ? '✅' : '❌';
    const statusText = success ? 'BERHASIL' : 'GAGAL';
    const timeStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Makassar' });

    const waMessage = `${statusEmoji} *Check-in SKEMARAJA ${statusText}*

👤 *Nama:* ${user.name}
📅 *Jadwal:* ${schedule.name}
🕐 *Waktu:* ${timeStr}
📍 *Lokasi:* ${locationName}
📱 *Status:* ${schedule.status_wfh === '1' ? 'WFH' : 'WFO'}

${success ? '🎉 Terima kasih sudah absen!' : '⚠️ ' + message}

_Auto Check-in by SKEMARAJA Puppeteer_`;

    try {
        const formData = new URLSearchParams();
        formData.append('target', phone);
        formData.append('message', waMessage);
        formData.append('countryCode', '62');

        const response = await fetch(FONNTE_API, {
            method: 'POST',
            headers: { 'Authorization': fonnteToken },
            body: formData
        });

        const result = await response.json();
        if (result.status) {
            logger.info(`📱 WhatsApp sent to ${user.name}`);
        } else {
            logger.warn(`📱 WhatsApp failed: ${result.reason || 'Unknown error'}`);
        }
    } catch (error) {
        logger.error(`📱 Fonnte error: ${error.message}`);
    }
}

export async function performCheckin(config) {
    const {
        nip,
        password,
        status,
        shift,
        latitude,
        longitude,
        headless,
        slowMo,
    } = config;

    let browser = null;
    let page = null;

    try {
        logger.info('🌐 Launching browser...');

        browser = await puppeteer.launch({
            headless: headless ? 'new' : false,
            slowMo,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920,1080',
            ],
        });

        page = await browser.newPage();

        // Set viewport
        await page.setViewport({ width: 1920, height: 1080 });

        // IMPORTANT: Grant geolocation permission FIRST (before setting geolocation)
        logger.info(`📍 Granting geolocation permission for ${SKEMARAJA_URL}`);
        const context = browser.defaultBrowserContext();
        await context.overridePermissions(SKEMARAJA_URL, ['geolocation']);

        // Now set the geolocation coordinates
        logger.info(`📍 Setting geolocation: ${latitude}, ${longitude}`);
        await page.setGeolocation({ latitude, longitude, accuracy: 100 });

        // Set realistic user agent
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );

        // Set extra headers
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        });

        // Navigate to login page with retry
        logger.info('🔗 Navigating to SKEMA RAJA...');
        let retries = 3;
        while (retries > 0) {
            try {
                await page.goto(SKEMARAJA_URL, {
                    waitUntil: 'networkidle2',
                    timeout: 60000,
                });
                break;
            } catch (navError) {
                retries--;
                if (retries === 0) throw navError;
                logger.warn(`⚠️ Navigation failed, retrying (${retries} left)...`);
                await new Promise(r => setTimeout(r, 5000));
            }
        }

        // Random delay to appear human
        await randomDelay(1000, 2000);

        // Take screenshot of initial page for debugging
        await saveScreenshot(page, 'page_loaded');
        logger.info('📸 Screenshot taken after page load');

        // Trigger browser geolocation to ensure website receives coordinates
        logger.info('📍 Triggering geolocation in browser...');
        await page.evaluate(() => {
            return new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(
                    (pos) => {
                        console.log('Geolocation success:', pos.coords.latitude, pos.coords.longitude);
                        resolve(pos);
                    },
                    (err) => {
                        console.log('Geolocation error:', err.message);
                        reject(err);
                    },
                    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
                );
            });
        }).catch(err => {
            logger.warn(`⚠️ Geolocation trigger warning: ${err.message}`);
        });

        // Wait a moment for page to update with location
        await randomDelay(2000, 3000);

        // Take screenshot after geolocation
        await saveScreenshot(page, 'after_geolocation');

        // Wait for form to be visible with increased timeout
        try {
            await page.waitForSelector('input[name="nip"]', { timeout: 60000 });
            logger.info('📝 Login form detected');
        } catch (formError) {
            // Take screenshot to see what's on the page
            await saveScreenshot(page, 'form_not_found');
            const currentUrl = page.url();
            const pageTitle = await page.title();
            logger.error(`❌ Form not found. URL: ${currentUrl}, Title: ${pageTitle}`);
            throw new Error(`Form login tidak ditemukan. URL: ${currentUrl}`);
        }

        // Random mouse movement
        await randomMouseMove(page);

        // Fill NIP with human-like typing
        logger.info('✏️ Filling NIP...');
        const nipInput = await page.$('input[name="nip"]');
        await nipInput.click();
        await randomDelay(200, 500);
        await page.type('input[name="nip"]', nip, { delay: getRandomTypingDelay() });

        await randomDelay(500, 1000);

        // Fill Password
        logger.info('🔑 Filling Password...');
        const passwordInput = await page.$('input[name="password"]');
        await passwordInput.click();
        await randomDelay(200, 500);
        await page.type('input[name="password"]', password, { delay: getRandomTypingDelay() });

        await randomDelay(500, 1000);

        // Select status WFH/WFO/DL
        logger.info(`📋 Selecting status: ${status === '1' ? 'WFH' : status === '2' ? 'WFO' : 'DL'}`);
        await page.select('select[name="status_wfh"]', status);

        await randomDelay(300, 700);

        // Select shift if WFO
        if (status === '2') {
            logger.info(`⏰ Selecting shift: ${shift}`);
            try {
                await page.click(`input[name="shift"][value="${shift}"]`);
            } catch {
                // Try alternative selector
                await page.evaluate((shiftVal) => {
                    const radio = document.querySelector(`input[name="shift"][value="${shiftVal}"]`);
                    if (radio) radio.checked = true;
                }, shift);
            }
        }

        await randomDelay(500, 1000);

        // Wait for geolocation to be captured
        logger.info('📍 Waiting for geolocation...');
        await page.waitForFunction(
            () => {
                const locationInput = document.querySelector('input[name="location_user"]');
                return locationInput && locationInput.value && locationInput.value.includes(',');
            },
            { timeout: 10000 }
        ).catch(() => {
            logger.warn('⚠️ Geolocation not captured automatically, setting manually...');
        });

        // Set location manually if not captured
        await page.evaluate((lat, lng) => {
            const locationInput = document.querySelector('input[name="location_user"]');
            if (locationInput && (!locationInput.value || !locationInput.value.includes(','))) {
                locationInput.value = `${lat}, ${lng}`;
            }
        }, latitude, longitude);

        await randomDelay(500, 1000);

        // Click submit button
        logger.info('🚀 Submitting form...');
        await page.click('#btnSubmit');

        // Wait for navigation or response
        await page.waitForNavigation({
            waitUntil: 'networkidle2',
            timeout: 30000
        }).catch(() => {
            // May not navigate, just wait for response
        });

        await randomDelay(2000, 3000);

        // Check result
        const pageContent = await page.content();
        const pageTitle = await page.title();
        const pageUrl = page.url();
        let result;
        let checkinTime = null;

        // Try to extract check-in time from Data Absensi table
        // Table structure: TANGGAL | PAGI | SIANG | SORE (columns 0,1,2,3)
        try {
            // Determine which column to check based on current WITA time
            const witaHour = new Date().toLocaleString('en-US', {
                timeZone: 'Asia/Makassar',
                hour: 'numeric',
                hour12: false
            });
            const hour = parseInt(witaHour);
            // Column index: 1=Pagi, 2=Siang, 3=Sore
            let sessionColumn = 1; // Default Pagi
            if (hour >= 12 && hour < 16) sessionColumn = 2; // Siang
            else if (hour >= 16) sessionColumn = 3; // Sore

            checkinTime = await page.evaluate((colIndex) => {
                // Find the absensi table
                const table = document.querySelector('#absensi table') ||
                    document.querySelector('table.table-bordered');
                if (!table) return null;

                // Get first data row (today's data)
                const rows = table.querySelectorAll('tbody tr');
                if (rows.length === 0) return null;

                const firstRow = rows[0];
                const cells = firstRow.querySelectorAll('td');
                if (cells.length <= colIndex) return null;

                // Get the cell for current session
                const cellText = cells[colIndex].textContent.trim();

                // Extract time from text like "07-Jan-2026 11:29:24"
                const timeMatch = cellText.match(/(\d{1,2}:\d{2}:\d{2})/);
                if (timeMatch) return timeMatch[1];

                return null;
            }, sessionColumn);
        } catch (e) {
            // Fallback: use current WITA time
            const witaTime = new Date().toLocaleString('id-ID', {
                timeZone: 'Asia/Makassar',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
            checkinTime = witaTime.replace(/\./g, ':');
        }

        // Success patterns - including dashboard page which means login/checkin succeeded
        if (pageContent.includes('Berhasil') || pageContent.includes('berhasil') ||
            pageContent.includes('Sukses') || pageContent.includes('sukses') ||
            pageContent.includes('Selamat') || pageContent.includes('tercatat') ||
            pageContent.includes('Data Absensi') || pageContent.includes('Check Out') ||
            pageContent.includes('MITRA') || pageUrl.includes('/home') ||
            pageUrl.includes('/dashboard')) {
            result = {
                success: true,
                message: checkinTime ? `Check-in berhasil! (${checkinTime})` : 'Check-in berhasil!',
                checkinTime
            };
        } else if (pageContent.includes('sudah absen') || pageContent.includes('Sudah Absen') ||
            pageContent.includes('sudah tercatat') || pageContent.includes('sudah melakukan')) {
            result = {
                success: true,
                message: checkinTime ? `Sudah check-in (${checkinTime})` : 'Sudah check-in sebelumnya',
                checkinTime
            };
        } else if (pageContent.includes('salah') || pageContent.includes('Salah') ||
            pageContent.includes('invalid') || pageContent.includes('Invalid')) {
            result = { success: false, message: 'NIP atau Password salah' };
        } else if (pageContent.includes('belum waktunya') || pageContent.includes('tidak dalam jam')) {
            result = { success: false, message: 'Belum waktunya check-in' };
        } else if (pageContent.includes('lokasi') && pageContent.includes('tidak')) {
            result = { success: false, message: 'Masalah lokasi/koordinat' };
        } else {
            // Take screenshot for debugging
            await saveScreenshot(page, 'unknown_result');
            result = { success: false, message: 'Response tidak dikenali: ' + pageTitle };
        }

        return result;

    } catch (error) {
        logger.error(`❌ Browser error: ${error.message}`);

        // Take screenshot on error
        if (page) {
            await saveScreenshot(page, 'error');
        }

        throw error;
    } finally {
        if (browser) {
            await browser.close();
            logger.info('🔒 Browser closed');
        }
    }
}

function getRandomTypingDelay() {
    // Random delay between 50-150ms per character
    return Math.floor(Math.random() * 100) + 50;
}

async function saveScreenshot(page, prefix) {
    try {
        const screenshotDir = process.env.SCREENSHOT_DIR || './screenshots';

        if (!fs.existsSync(screenshotDir)) {
            fs.mkdirSync(screenshotDir, { recursive: true });
        }

        const filename = `${prefix}_${Date.now()}.png`;
        const filepath = path.join(screenshotDir, filename);

        await page.screenshot({ path: filepath, fullPage: true });
        logger.info(`📸 Screenshot saved: ${filepath}`);
    } catch (error) {
        logger.error(`Failed to save screenshot: ${error.message}`);
    }
}
