/**
 * Utility functions
 */

// Indonesian National Holidays 2025-2026
const HOLIDAYS = [
    // 2025
    '2025-01-01', // Tahun Baru
    '2025-01-29', // Isra Mi'raj
    '2025-01-30', // Tahun Baru Imlek
    '2025-03-29', // Hari Raya Nyepi
    '2025-03-30', // Hari Raya Idul Fitri
    '2025-03-31', // Hari Raya Idul Fitri
    '2025-04-01', // Cuti Bersama
    '2025-04-18', // Wafat Isa Almasih
    '2025-05-01', // Hari Buruh
    '2025-05-12', // Hari Raya Waisak
    '2025-05-29', // Kenaikan Isa Almasih
    '2025-06-01', // Hari Lahir Pancasila
    '2025-06-06', // Hari Raya Idul Adha
    '2025-06-27', // Tahun Baru Islam
    '2025-08-17', // Hari Kemerdekaan
    '2025-09-05', // Maulid Nabi Muhammad
    '2025-12-25', // Hari Natal
    // 2026
    '2026-01-01', // Tahun Baru
    '2026-01-18', // Isra Mi'raj
    '2026-02-17', // Tahun Baru Imlek
    '2026-03-20', // Idul Fitri
    '2026-03-21', // Idul Fitri
    '2026-04-03', // Wafat Isa Almasih
    '2026-05-01', // Hari Buruh
    '2026-05-14', // Kenaikan Isa Almasih
    '2026-05-27', // Idul Adha
    '2026-06-01', // Hari Lahir Pancasila
    '2026-06-17', // Tahun Baru Islam
    '2026-08-17', // Hari Kemerdekaan
    '2026-08-26', // Maulid Nabi
    '2026-12-25', // Hari Natal
];

const TIMEZONE = 'Asia/Makassar'; // WITA (UTC+8)

/**
 * Check if today is a holiday
 */
export function isHoliday() {
    const today = new Date().toLocaleDateString('en-CA', {
        timeZone: TIMEZONE
    }); // YYYY-MM-DD format

    return HOLIDAYS.includes(today);
}

/**
 * Check if today is weekend (Saturday/Sunday)
 */
export function isWeekend() {
    const now = new Date();
    const witaDate = new Date(now.toLocaleString('en-US', {
        timeZone: TIMEZONE
    }));

    const day = witaDate.getDay();
    return day === 0 || day === 6; // Sunday = 0, Saturday = 6
}

/**
 * Random delay between min and max milliseconds
 */
export function randomDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Simulate random mouse movements on page
 */
export async function randomMouseMove(page) {
    const viewport = page.viewport();

    for (let i = 0; i < 3; i++) {
        const x = Math.floor(Math.random() * viewport.width);
        const y = Math.floor(Math.random() * viewport.height);

        await page.mouse.move(x, y, { steps: 10 });
        await randomDelay(100, 300);
    }
}

/**
 * Get current WITA (Makassar) time as Date object
 */
export function getWitaTime() {
    const now = new Date();
    return new Date(now.toLocaleString('en-US', {
        timeZone: TIMEZONE
    }));
}

/**
 * Get current WITA time as formatted string
 */
export function getWitaTimeString() {
    return new Date().toLocaleString('id-ID', {
        timeZone: TIMEZONE,
        dateStyle: 'full',
        timeStyle: 'medium',
    });
}

