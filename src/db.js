import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Brainrots that can be withdrawn by default (admins change it per item). */
export const WITHDRAWABLE = ['garama and madundung', 'cerberus', 'capitano moby', 'burguro and fryuro', 'dragon cannelloni'];

// BIGINT and NUMERIC come back as strings by default; our values fit in JS numbers.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

/** Works out TLS settings from DATABASE_SSL or the sslmode query parameter. */
export function resolveSsl(url, mode) {
  let connectionString = url;
  let sslmode = (mode || '').toLowerCase();
  try {
    const u = new URL(url);
    const fromUrl = u.searchParams.get('sslmode');
    if (fromUrl) {
      if (!sslmode) sslmode = fromUrl.toLowerCase();
      u.searchParams.delete('sslmode');
      connectionString = u.toString();
    }
    if (!sslmode) {
      // Hosts without a dot are private network names (e.g. Render internal URLs).
      const host = u.hostname;
      const local = host === 'localhost' || host === '127.0.0.1' || !host.includes('.');
      sslmode = local ? 'disable' : 'no-verify';
    }
  } catch {
    sslmode = sslmode || 'disable';
  }
  let ssl = false;
  if (sslmode === 'verify-full' || sslmode === 'verify-ca' || sslmode === 'verify') ssl = true;
  else if (sslmode !== 'disable' && sslmode !== 'off' && sslmode !== 'false') ssl = { rejectUnauthorized: false };
  return { connectionString, ssl };
}

export function createDb(url, sslMode) {
  if (!url) throw new Error('DATABASE_URL is not set');
  const { connectionString, ssl } = resolveSsl(url, sslMode);
  const pool = new pg.Pool({ connectionString, ssl, max: 10, idleTimeoutMillis: 30_000 });
  pool.on('error', (e) => console.error('[db] idle client error:', e.message));

  const db = {
    pool,
    query: (text, params) => pool.query(text, params),
    one: async (text, params) => (await pool.query(text, params)).rows[0] ?? null,
    many: async (text, params) => (await pool.query(text, params)).rows,
    /** Runs fn(client) inside a transaction. */
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (e) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* connection already broken */
        }
        throw e;
      } finally {
        client.release();
      }
    },
    end: () => pool.end(),
  };
  return db;
}

export async function migrate(db) {
  const sql = readFileSync(path.join(here, 'schema.sql'), 'utf8');
  const client = await db.pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(424242)');
    await client.query(sql);
    await seed(client);
    // first run with the withdrawable flag: these brainrots can be withdrawn, the rest can't
    await client.query('UPDATE bs_items SET withdrawable = (lower(name) = ANY($1::text[])) WHERE withdrawable IS NULL', [WITHDRAWABLE]);
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(424242)');
    } finally {
      client.release();
    }
  }
}

async function seed(client) {
  const { rows } = await client.query('SELECT count(*)::int AS n FROM bs_cases');
  if (rows[0].n > 0) return;
  const data = JSON.parse(readFileSync(path.join(here, 'seed-data.json'), 'utf8'));
  await client.query('BEGIN');
  try {
    const ids = new Map();
    for (const it of data.items) {
      const r = await client.query(
        'INSERT INTO bs_items (name, value, emoji) VALUES ($1, $2, $3) RETURNING id',
        [it.name, it.value, it.emoji],
      );
      ids.set(it.name, r.rows[0].id);
    }
    for (const c of data.cases) {
      const r = await client.query(
        `INSERT INTO bs_cases (slug, name_ru, name_uk, name_en, price, is_free, emoji, color, sort)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [c.slug, c.name_ru, c.name_uk, c.name_en, c.price, c.is_free, c.emoji, c.color, c.sort],
      );
      for (const ci of c.items) {
        await client.query('INSERT INTO bs_case_items (case_id, item_id, chance) VALUES ($1, $2, $3)', [
          r.rows[0].id,
          ids.get(ci.item),
          ci.chance,
        ]);
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}
