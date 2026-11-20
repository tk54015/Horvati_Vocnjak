// GET    -> { admin: true/false }
// POST   -> prijava { username, password }
// DELETE -> odjava

import { ADMIN_COOKIE, ADMIN_COOKIE_MAX_AGE, adminConfigured, adminToken, isAdmin, safeEqual } from '../lib/auth.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'GET') {
        res.status(200).json({ admin: isAdmin(req), configured: adminConfigured() });
        return;
    }

    if (req.method === 'POST') {
        if (!adminConfigured()) {
            res.status(500).json({ error: 'Admin račun nije postavljen (ADMIN_USERNAME / ADMIN_PASSWORD).' });
            return;
        }

        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const userOk = safeEqual(String(body.username || '').trim(), process.env.ADMIN_USERNAME);
        const passOk = safeEqual(String(body.password || ''), process.env.ADMIN_PASSWORD);

        if (!userOk || !passOk) {
            await sleep(800); // usporava pogađanje lozinke
            res.status(401).json({ error: 'Pogrešno korisničko ime ili lozinka.' });
            return;
        }

        res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=${adminToken()}; Path=/; Max-Age=${ADMIN_COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`);
        res.status(200).json({ admin: true });
        return;
    }

    if (req.method === 'DELETE') {
        res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
        res.status(200).json({ admin: false });
        return;
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    res.status(405).json({ error: 'Metoda nije podržana' });
}
