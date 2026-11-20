// Vercel serverless funkcija: čitanje i spremanje podataka voćnjaka u Postgres (Neon).
//
// Tablice:
//   datasets      - meta podaci originalnih fajlova (stabla, loza)
//   base_items    - točna kopija data/stabla.json i data/loza.json (ne mijenja se)
//   user_items    - stabla dodana kroz aplikaciju
//   overrides     - izmjene postojećih biljaka (napomene, status, pozicije)
//   change_log    - povijest svih spremanja (za svaki slučaj)

import { neon } from '@neondatabase/serverless';
import { isAdmin } from '../lib/auth.js';

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = DATABASE_URL ? neon(DATABASE_URL) : null;

// deleted = stablo izbrisano s karte (original ostaje u base_items, može se vratiti)
const OVERRIDE_KINDS = { note: true, details: true, position: true, deleted: true };
const DATASET_NAMES = ['stabla', 'loza'];
const MAX_CHANGES_PER_REQUEST = 5000;

let schemaReady = null;

function ensureSchema() {
    if (!schemaReady) {
        schemaReady = sql.transaction([
            sql`CREATE TABLE IF NOT EXISTS datasets (
                name text PRIMARY KEY,
                meta jsonb,
                seeded_at timestamptz NOT NULL DEFAULT now()
            )`,
            sql`CREATE TABLE IF NOT EXISTS base_items (
                dataset text NOT NULL,
                position integer NOT NULL,
                data jsonb NOT NULL,
                PRIMARY KEY (dataset, position)
            )`,
            sql`CREATE TABLE IF NOT EXISTS user_items (
                id text PRIMARY KEY,
                seq bigint GENERATED ALWAYS AS IDENTITY,
                data jsonb NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            )`,
            sql`CREATE TABLE IF NOT EXISTS overrides (
                kind text NOT NULL,
                plant_id text NOT NULL,
                value jsonb NOT NULL,
                updated_at timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (kind, plant_id)
            )`,
            sql`CREATE TABLE IF NOT EXISTS change_log (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                kind text NOT NULL,
                plant_id text NOT NULL,
                value jsonb,
                changed_at timestamptz NOT NULL DEFAULT now()
            )`
        ]).catch((error) => {
            schemaReady = null;
            throw error;
        });
    }
    return schemaReady;
}

async function readState() {
    const [datasets, baseRows, userRows, overrideRows] = await sql.transaction([
        sql`SELECT name, meta FROM datasets`,
        sql`SELECT dataset, data FROM base_items ORDER BY dataset, position`,
        sql`SELECT data FROM user_items ORDER BY seq`,
        sql`SELECT kind, plant_id, value FROM overrides`
    ], { readOnly: true });

    const state = {
        seeded: datasets.length > 0,
        stabla: { meta: null, items: [] },
        loza: { meta: null, items: [] },
        userItems: userRows.map((row) => row.data),
        noteOverrides: {},
        plantDetails: {},
        positionOverrides: {},
        deletedIds: {}
    };

    datasets.forEach((row) => {
        if (state[row.name]) state[row.name].meta = row.meta;
    });
    baseRows.forEach((row) => {
        if (state[row.dataset]) state[row.dataset].items.push(row.data);
    });
    overrideRows.forEach((row) => {
        if (row.kind === 'note') state.noteOverrides[row.plant_id] = row.value;
        else if (row.kind === 'details') state.plantDetails[row.plant_id] = row.value;
        else if (row.kind === 'position') state.positionOverrides[row.plant_id] = row.value;
        else if (row.kind === 'deleted') state.deletedIds[row.plant_id] = row.value;
    });

    return state;
}

async function seed(body) {
    const existing = await sql`SELECT count(*)::int AS n FROM datasets`;
    if (existing[0].n > 0) return { seeded: true, skipped: true };

    const stabla = body.stabla;
    if (!stabla || !Array.isArray(stabla.items) || stabla.items.length === 0) {
        throw httpError(400, 'Seed: nedostaju podaci iz stabla.json');
    }

    const queries = [];
    DATASET_NAMES.forEach((name) => {
        const data = body[name] && Array.isArray(body[name].items) ? body[name] : { meta: null, items: [] };
        queries.push(sql`INSERT INTO datasets (name, meta)
            VALUES (${name}, ${JSON.stringify(data.meta || null)}::jsonb)
            ON CONFLICT (name) DO NOTHING`);
        queries.push(sql`INSERT INTO base_items (dataset, position, data)
            SELECT ${name}, (t.ord - 1)::int, t.elem
            FROM jsonb_array_elements(${JSON.stringify(data.items)}::jsonb) WITH ORDINALITY AS t(elem, ord)
            ON CONFLICT (dataset, position) DO NOTHING`);
    });

    await sql.transaction(queries);
    return { seeded: true, skipped: false };
}

async function applyChanges(body) {
    const changes = body.changes;
    if (!Array.isArray(changes)) throw httpError(400, 'Nedostaje lista izmjena');
    if (changes.length === 0) return { saved: 0 };
    if (changes.length > MAX_CHANGES_PER_REQUEST) throw httpError(413, 'Previše izmjena odjednom');

    const queries = [];
    changes.forEach((change) => {
        if (!change || typeof change.id !== 'string' || change.id === '') {
            throw httpError(400, 'Izmjena bez ID-a');
        }
        const kind = change.kind;
        const id = change.id;
        const hasValue = change.value !== null && change.value !== undefined;
        const json = hasValue ? JSON.stringify(change.value) : null;

        if (kind === 'user') {
            if (hasValue) {
                queries.push(sql`INSERT INTO user_items (id, data) VALUES (${id}, ${json}::jsonb)
                    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`);
            } else {
                queries.push(sql`DELETE FROM user_items WHERE id = ${id}`);
            }
        } else if (OVERRIDE_KINDS[kind]) {
            if (hasValue) {
                queries.push(sql`INSERT INTO overrides (kind, plant_id, value) VALUES (${kind}, ${id}, ${json}::jsonb)
                    ON CONFLICT (kind, plant_id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
            } else {
                queries.push(sql`DELETE FROM overrides WHERE kind = ${kind} AND plant_id = ${id}`);
            }
        } else {
            throw httpError(400, 'Nepoznata vrsta izmjene: ' + kind);
        }

        queries.push(sql`INSERT INTO change_log (kind, plant_id, value) VALUES (${kind}, ${id}, ${json}::jsonb)`);
    });

    await sql.transaction(queries);
    return { saved: changes.length };
}

function httpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    if (!sql) {
        res.status(500).json({ error: 'Baza nije spojena (nedostaje DATABASE_URL).' });
        return;
    }

    try {
        await ensureSchema();

        if (req.method === 'GET') {
            res.status(200).json(await readState());
            return;
        }

        if (req.method === 'POST') {
            if (!isAdmin(req)) {
                res.status(403).json({ error: 'Samo admin može spremati izmjene.' });
                return;
            }
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
            if (body.action === 'seed') {
                res.status(200).json(await seed(body));
                return;
            }
            if (body.action === 'sync') {
                res.status(200).json(await applyChanges(body));
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
