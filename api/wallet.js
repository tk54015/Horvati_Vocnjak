// Novčanik: troškovi i prihodi voćnjaka. Samo za admina (čitanje i pisanje).
// Namjerno odvojeno od /api/state, koji je javan.
//
// GET  -> { entries: [...] }
// POST -> { action: 'add', entry } | { action: 'update', entry } | { action: 'delete', id }

import { neon } from '@neondatabase/serverless';
import { isAdmin } from '../lib/auth.js';

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = DATABASE_URL ? neon(DATABASE_URL) : null;
const KINDS = { trosak: true, prihod: true };

let schemaReady = null;
function ensureSchema() {
    if (!schemaReady) {
        schemaReady = Promise.resolve().then(() => sql`CREATE TABLE IF NOT EXISTS wallet_entries (
            id text PRIMARY KEY,
            date date NOT NULL,
            kind text NOT NULL,
            amount numeric(12, 2) NOT NULL,
            category text,
            note text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )`)
            // planirani zapis (još nije plaćeno / primljeno)
            .then(() => sql`ALTER TABLE wallet_entries ADD COLUMN IF NOT EXISTS planned boolean NOT NULL DEFAULT false`)
            .catch((error) => {
            schemaReady = null;
            throw error;
        });
    }
    return schemaReady;
}

function httpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function cleanEntry(e) {
    if (!e || typeof e !== 'object') throw httpError(400, 'Nedostaje zapis');
    const id = String(e.id || '').trim();
    const date = String(e.date || '').trim();
    const kind = String(e.kind || '');
    const amount = Number(e.amount);
    if (!id || id.length > 64) throw httpError(400, 'Neispravan ID');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, 'Neispravan datum');
    if (!KINDS[kind]) throw httpError(400, 'Vrsta mora biti trošak ili prihod');
    if (!isFinite(amount) || amount < 0 || amount > 1e9) throw httpError(400, 'Neispravan iznos');
    return {
        id,
        date,
        kind,
        amount: Math.round(amount * 100) / 100,
        category: String(e.category || 'ostalo').slice(0, 40),
        note: String(e.note || '').slice(0, 300),
        planned: e.planned === true
    };
}

function rowToEntry(r) {
    const d = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10);
    return { id: r.id, date: d, kind: r.kind, amount: Number(r.amount), category: r.category, note: r.note || '', planned: r.planned === true };
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!sql) {
        res.status(500).json({ error: 'Baza nije spojena.' });
        return;
    }
    if (!isAdmin(req)) {
        res.status(403).json({ error: 'Novčanik je dostupan samo adminu.' });
        return;
    }

    try {
        await ensureSchema();

        if (req.method === 'GET') {
            const rows = await sql`SELECT id, to_char(date, 'YYYY-MM-DD') AS date, kind, amount, category, note, planned
                FROM wallet_entries ORDER BY date DESC, created_at DESC`;
            res.status(200).json({ entries: rows.map(rowToEntry) });
            return;
        }

        if (req.method === 'POST') {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
            if (body.action === 'add' || body.action === 'update') {
                const e = cleanEntry(body.entry);
                await sql`INSERT INTO wallet_entries (id, date, kind, amount, category, note, planned)
                    VALUES (${e.id}, ${e.date}, ${e.kind}, ${e.amount}, ${e.category}, ${e.note}, ${e.planned})
                    ON CONFLICT (id) DO UPDATE SET date = EXCLUDED.date, kind = EXCLUDED.kind, amount = EXCLUDED.amount,
                        category = EXCLUDED.category, note = EXCLUDED.note, planned = EXCLUDED.planned, updated_at = now()`;
                res.status(200).json({ entry: e });
                return;
            }
            if (body.action === 'delete') {
                const id = String(body.id || '');
                if (!id) throw httpError(400, 'Nedostaje ID');
                await sql`DELETE FROM wallet_entries WHERE id = ${id}`;
                res.status(200).json({ deleted: id });
                return;
            }
            res.status(400).json({ error: 'Nepoznata akcija' });
            return;
        }

        res.setHeader('Allow', 'GET, POST');
        res.status(405).json({ error: 'Metoda nije podržana' });
    } catch (error) {
        console.error(error);
        res.status(error.status || 500).json({ error: error.message || 'Greška na serveru' });
    }
}
