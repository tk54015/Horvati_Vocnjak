// Admin prijava: jedan admin račun (ADMIN_USERNAME + ADMIN_PASSWORD u Vercel env).
// Svi ostali mogu samo gledati.

import crypto from 'node:crypto';

export const ADMIN_COOKIE = 'horvati_admin';
export const ADMIN_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function adminConfigured() {
    return !!(process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD);
}

// Token ovisi o korisničkom imenu i lozinki, pa promjena lozinke odjavljuje sve uređaje.
export function adminToken() {
    return crypto
        .createHmac('sha256', process.env.ADMIN_PASSWORD)
        .update('horvati-admin:' + process.env.ADMIN_USERNAME)
        .digest('hex');
}

export function safeEqual(a, b) {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
}

function readCookie(req, name) {
    const header = req.headers.cookie || '';
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
    }
    return null;
}

export function isAdmin(req) {
    if (!adminConfigured()) return false;
    const value = readCookie(req, ADMIN_COOKIE);
    return !!value && safeEqual(value, adminToken());
}
