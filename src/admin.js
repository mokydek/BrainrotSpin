import express from 'express';
import crypto from 'node:crypto';
import { GameError } from './game.js';
import { RARITIES, rarityOf } from './rarity.js';
import { wrap } from './api.js';
import { meView } from './api.js';

function int(v, min, max, field) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new GameError('bad_field', 400, { field });
  return n;
}
function num(v, min, max, field) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw new GameError('bad_field', 400, { field });
  return n;
}
function str(v, min, max, field) {
  if (typeof v !== 'string') throw new GameError('bad_field', 400, { field });
  const s = v.trim();
  if (s.length < min || s.length > max) throw new GameError('bad_field', 400, { field });
  return s;
}
function optStr(v, max, field) {
  if (v === undefined || v === null || v === '') return null;
  return str(v, 0, max, field);
}
function bool(v, field) {
  if (typeof v !== 'boolean') throw new GameError('bad_field', 400, { field });
  return v;
}
function color(v) {
  const s = str(v, 4, 9, 'color');
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) throw new GameError('bad_field', 400, { field: 'color' });
  return s.toLowerCase();
}
function imageUrl(v) {
  const s = optStr(v, 500, 'image_url');
  if (s && !/^https:\/\/\S+$/i.test(s)) throw new GameError('bad_field', 400, { field: 'image_url' });
  return s;
}

export function createAdmin({ db, settings, game, live, tg, broadcaster }) {
  const r = express.Router();
  r.use((req, res, next) => (req.user && req.user.is_admin ? next() : res.status(403).json({ error: 'forbidden' })));

  // ------------------------------------------------------------ overview
  r.get(
    '/overview',
    wrap(async () => {
      const s = await db.one(`
        SELECT (SELECT count(*)::int FROM bs_users) AS users,
               (SELECT count(*)::int FROM bs_users WHERE created_at > now() - interval '24 hours') AS new24,
               (SELECT count(*)::int FROM bs_drops WHERE kind IN ('case','free') AND created_at > now() - interval '24 hours') AS opened24,
               (SELECT count(*)::int FROM bs_upgrades WHERE created_at > now() - interval '24 hours') AS upgrades24,
               (SELECT coalesce(sum(balance), 0)::bigint FROM bs_users) AS coins,
               (SELECT coalesce(sum(i.value), 0)::bigint FROM bs_inventory v JOIN bs_items i ON i.id = v.item_id) AS items_value`);
      return { ...s, online: live.online() };
    }),
  );

  // ------------------------------------------------------------ cases
  function adminCase(c) {
    const sum = c.items.reduce((a, e) => a + e.chance, 0);
    const ev = sum ? c.items.reduce((a, e) => a + (e.chance / sum) * (game.catalog.items.get(e.item_id)?.value || 0), 0) : 0;
    return {
      id: c.id,
      slug: c.slug,
      name_ru: c.name_ru,
      name_uk: c.name_uk,
      name_en: c.name_en,
      price: c.price,
      is_free: c.is_free,
      emoji: c.emoji,
      color: c.color,
      sort: c.sort,
      enabled: c.enabled,
      items: c.items
        .map((e) => ({ itemId: e.item_id, chance: e.chance }))
        .sort((a, b) => (game.catalog.items.get(b.itemId)?.value || 0) - (game.catalog.items.get(a.itemId)?.value || 0)),
      chanceSum: Math.round(sum * 10000) / 10000,
      ev: Math.round(ev * 100) / 100,
      rtp: c.price > 0 ? Math.round((ev / c.price) * 10000) / 100 : null,
    };
  }

  r.get('/cases', wrap(async () => ({ cases: game.catalog.order.map((id) => adminCase(game.catalog.cases.get(id))) })));

  function parseCaseBody(b, existing) {
    const out = {
      name_ru: str(b.name_ru, 1, 60, 'name_ru'),
      name_uk: str(b.name_uk, 1, 60, 'name_uk'),
      name_en: str(b.name_en, 1, 60, 'name_en'),
      emoji: str(b.emoji, 1, 16, 'emoji'),
      color: color(b.color),
      sort: int(b.sort ?? 0, -1000, 1000, 'sort'),
      enabled: bool(b.enabled, 'enabled'),
    };
    const isFree = existing ? existing.is_free : false;
    out.price = isFree ? 0 : int(b.price, 1, 10_000_000, 'price');
    if (!Array.isArray(b.items) || b.items.length > 200) throw new GameError('bad_field', 400, { field: 'items' });
    const seen = new Set();
    out.items = b.items.map((e) => {
      const itemId = int(e.itemId, 1, 2_147_483_647, 'items');
      if (!game.catalog.items.has(itemId) || seen.has(itemId)) throw new GameError('bad_field', 400, { field: 'items' });
      seen.add(itemId);
      return { itemId, chance: Math.round(num(e.chance, 0.0001, 100, 'chance') * 10000) / 10000 };
    });
    if (out.enabled && out.items.length === 0) throw new GameError('bad_field', 400, { field: 'items' });
    return out;
  }

  async function saveItems(cl, caseId, items) {
    await cl.query('DELETE FROM bs_case_items WHERE case_id = $1', [caseId]);
    for (const e of items) {
      await cl.query('INSERT INTO bs_case_items (case_id, item_id, chance) VALUES ($1, $2, $3)', [caseId, e.itemId, e.chance]);
    }
  }

  r.put(
    '/cases/:id',
    wrap(async (req) => {
      const id = int(Number(req.params.id), 1, 2_147_483_647, 'id');
      const existing = game.catalog.cases.get(id);
      if (!existing) throw new GameError('not_found', 404);
      const c = parseCaseBody(req.body || {}, existing);
      await db.tx(async (cl) => {
        await cl.query(
          `UPDATE bs_cases SET name_ru=$2, name_uk=$3, name_en=$4, emoji=$5, color=$6, sort=$7, enabled=$8, price=$9 WHERE id=$1`,
          [id, c.name_ru, c.name_uk, c.name_en, c.emoji, c.color, c.sort, c.enabled, c.price],
        );
        await saveItems(cl, id, c.items);
      });
      await game.reloadCatalog();
      return { case: adminCase(game.catalog.cases.get(id)) };
    }),
  );

  r.post(
    '/cases',
    wrap(async (req) => {
      const c = parseCaseBody(req.body || {}, null);
      const base = c.name_en.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'case';
      const slug = `${base}-${crypto.randomBytes(3).toString('hex')}`;
      const row = await db.tx(async (cl) => {
        const ins = await cl.query(
          `INSERT INTO bs_cases (slug, name_ru, name_uk, name_en, price, is_free, emoji, color, sort, enabled)
           VALUES ($1,$2,$3,$4,$5,FALSE,$6,$7,$8,$9) RETURNING id`,
          [slug, c.name_ru, c.name_uk, c.name_en, c.price, c.emoji, c.color, c.sort, c.enabled],
        );
        await saveItems(cl, ins.rows[0].id, c.items);
        return ins.rows[0];
      });
      await game.reloadCatalog();
      return { case: adminCase(game.catalog.cases.get(row.id)) };
    }),
  );

  r.delete(
    '/cases/:id',
    wrap(async (req) => {
      const id = int(Number(req.params.id), 1, 2_147_483_647, 'id');
      const c = game.catalog.cases.get(id);
      if (!c) throw new GameError('not_found', 404);
      if (c.is_free) throw new GameError('cannot_delete_free');
      await db.query('DELETE FROM bs_cases WHERE id = $1', [id]);
      await game.reloadCatalog();
      return { ok: true };
    }),
  );

  // ------------------------------------------------------------ items
  r.get(
    '/items',
    wrap(async () => {
      const usage = await db.many('SELECT item_id, count(*)::int AS n FROM bs_case_items GROUP BY item_id');
      const used = new Map(usage.map((u) => [u.item_id, u.n]));
      const items = [...game.catalog.items.values()].map((i) => ({
        ...game.publicItem(i),
        rarityOverride: i.rarity || null,
        image_url: i.image_url || null,
        hasUpload: i.has_image,
        enabled: i.enabled,
        inCases: used.get(i.id) || 0,
      }));
      return { items, rarities: RARITIES };
    }),
  );

  function parseItemBody(b) {
    const rarity = b.rarity ? str(b.rarity, 1, 20, 'rarity') : null;
    if (rarity && !RARITIES.includes(rarity)) throw new GameError('bad_field', 400, { field: 'rarity' });
    return {
      name: str(b.name, 1, 60, 'name'),
      value: int(b.value, 0, 100_000_000, 'value'),
      emoji: str(b.emoji || '🎁', 1, 16, 'emoji'),
      rarity,
      image_url: imageUrl(b.image_url),
      enabled: b.enabled === undefined ? true : bool(b.enabled, 'enabled'),
    };
  }

  r.post(
    '/items',
    wrap(async (req) => {
      const it = parseItemBody(req.body || {});
      const row = await db.one(
        'INSERT INTO bs_items (name, value, emoji, rarity, image_url, enabled) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [it.name, it.value, it.emoji, it.rarity, it.image_url, it.enabled],
      );
      await game.reloadCatalog();
      return { item: game.publicItem(game.catalog.items.get(row.id)) };
    }),
  );

  r.put(
    '/items/:id',
    wrap(async (req) => {
      const id = int(Number(req.params.id), 1, 2_147_483_647, 'id');
      if (!game.catalog.items.has(id)) throw new GameError('not_found', 404);
      const it = parseItemBody(req.body || {});
      await db.query('UPDATE bs_items SET name=$2, value=$3, emoji=$4, rarity=$5, image_url=$6, enabled=$7 WHERE id=$1', [
        id,
        it.name,
        it.value,
        it.emoji,
        it.rarity,
        it.image_url,
        it.enabled,
      ]);
      await game.reloadCatalog();
      return { item: game.publicItem(game.catalog.items.get(id)) };
    }),
  );

  r.post(
    '/items/:id/image',
    wrap(async (req) => {
      const id = int(Number(req.params.id), 1, 2_147_483_647, 'id');
      if (!game.catalog.items.has(id)) throw new GameError('not_found', 404);
      const data = (req.body || {}).dataUrl;
      if (typeof data !== 'string' || data.length > 700_000 || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(data)) {
        throw new GameError('bad_field', 400, { field: 'image' });
      }
      await db.query('UPDATE bs_items SET image_data = $2 WHERE id = $1', [id, data]);
      await game.reloadCatalog();
      return { item: game.publicItem(game.catalog.items.get(id)) };
    }),
  );

  r.delete(
    '/items/:id/image',
    wrap(async (req) => {
      const id = int(Number(req.params.id), 1, 2_147_483_647, 'id');
      await db.query('UPDATE bs_items SET image_data = NULL WHERE id = $1', [id]);
      await game.reloadCatalog();
      return { item: game.publicItem(game.catalog.items.get(id)) };
    }),
  );

  // ------------------------------------------------------------ users
  function userRow(u) {
    return {
      ...meView(u),
      firstName: u.first_name,
      lastName: u.last_name,
      isBanned: u.is_banned,
      lastSeen: u.last_seen_at,
      blockedBot: u.blocked_bot,
      startedBot: u.started_bot,
    };
  }

  r.get(
    '/users',
    wrap(async (req) => {
      const q = String(req.query.q || '').trim().replace(/^@/, '');
      let rows;
      if (!q) {
        rows = await db.many('SELECT * FROM bs_users ORDER BY last_seen_at DESC LIMIT 30');
      } else if (/^\d{3,15}$/.test(q)) {
        rows = await db.many('SELECT * FROM bs_users WHERE id = $1 OR username ILIKE $2 LIMIT 30', [Number(q), `%${q}%`]);
      } else {
        const like = `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
        rows = await db.many(
          `SELECT * FROM bs_users WHERE username ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1
            ORDER BY last_seen_at DESC LIMIT 30`,
          [like],
        );
      }
      return { users: rows.map(userRow) };
    }),
  );

  async function loadUser(id) {
    const u = await db.one('SELECT * FROM bs_users WHERE id = $1', [id]);
    if (!u) throw new GameError('not_found', 404);
    return u;
  }

  r.get(
    '/users/:id',
    wrap(async (req) => {
      const id = int(Number(req.params.id), 1, Number.MAX_SAFE_INTEGER, 'id');
      const u = await loadUser(id);
      const log = await db.many('SELECT delta, reason, admin_id, created_at FROM bs_balance_log WHERE user_id = $1 ORDER BY id DESC LIMIT 20', [id]);
      return { user: userRow(u), stats: await game.stats(id), inventory: await game.inventory(id), log };
    }),
  );

  r.post(
    '/users/:id/balance',
    wrap(async (req) => {
      const id = int(Number(req.params.id), 1, Number.MAX_SAFE_INTEGER, 'id');
      const { mode, amount } = req.body || {};
      if (mode !== 'add' && mode !== 'set') throw new GameError('bad_field', 400, { field: 'mode' });
      const n = int(Number(amount), mode === 'add' ? -1_000_000_000 : 0, 1_000_000_000, 'amount');
      const res = await db.tx(async (cl) => {
        const u = (await cl.query('SELECT balance FROM bs_users WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!u) throw new GameError('not_found', 404);
        const next = mode === 'set' ? n : u.balance + n;
        if (next < 0) throw new GameError('negative_balance');
        await cl.query('UPDATE bs_users SET balance = $2 WHERE id = $1', [id, next]);
        await cl.query('INSERT INTO bs_balance_log (user_id, delta, reason, admin_id) VALUES ($1, $2, $3, $4)', [
          id,
          next - u.balance,
          mode === 'set' ? 'admin:set' : 'admin:add',
          req.user.id,
        ]);
        return next;
      });
      return { balance: res };
    }),
  );

  r.post(
    '/users/:id/flags',
    wrap(async (req) => {
      const id = int(Number(req.params.id), 1, Number.MAX_SAFE_INTEGER, 'id');
      const b = req.body || {};
      await loadUser(id);
      if (b.is_admin !== undefined) {
        const v = bool(b.is_admin, 'is_admin');
        if (!v && id === req.user.id) throw new GameError('cannot_demote_self');
        await db.query('UPDATE bs_users SET is_admin = $2 WHERE id = $1', [id, v]);
      }
      if (b.is_banned !== undefined) {
        const v = bool(b.is_banned, 'is_banned');
        if (v && id === req.user.id) throw new GameError('cannot_ban_self');
        await db.query('UPDATE bs_users SET is_banned = $2 WHERE id = $1', [id, v]);
      }
      if (b.revoke_web) await db.query('UPDATE bs_users SET web_ver = web_ver + 1 WHERE id = $1', [id]);
      return { user: userRow(await loadUser(id)) };
    }),
  );

  r.post(
    '/users/:id/give',
    wrap(async (req) => {
      const id = int(Number(req.params.id), 1, Number.MAX_SAFE_INTEGER, 'id');
      const itemId = int(Number((req.body || {}).itemId), 1, 2_147_483_647, 'itemId');
      const item = game.catalog.items.get(itemId);
      if (!item) throw new GameError('not_found', 404);
      await loadUser(id);
      const invId = await db.tx((cl) => game.giveItem(cl, id, item, 'admin'));
      return { invId, item: game.publicItem(item) };
    }),
  );

  r.delete(
    '/users/:id/inventory/:invId',
    wrap(async (req) => {
      const id = int(Number(req.params.id), 1, Number.MAX_SAFE_INTEGER, 'id');
      const invId = int(Number(req.params.invId), 1, Number.MAX_SAFE_INTEGER, 'invId');
      const del = await db.query('DELETE FROM bs_inventory WHERE id = $1 AND user_id = $2', [invId, id]);
      if (!del.rowCount) throw new GameError('not_found', 404);
      return { ok: true };
    }),
  );

  // ------------------------------------------------------------ promo codes
  r.get(
    '/promos',
    wrap(async () => ({
      promos: await db.many('SELECT code, amount, max_uses, uses, expires_at, active, created_at FROM bs_promo_codes ORDER BY created_at DESC LIMIT 200'),
    })),
  );

  r.post(
    '/promos',
    wrap(async (req) => {
      const b = req.body || {};
      let code = game.normalizeCode(b.code || '');
      if (!code) code = crypto.randomBytes(4).toString('hex').toUpperCase();
      if (!/^[A-Z0-9_-]{3,40}$/.test(code)) throw new GameError('bad_field', 400, { field: 'code' });
      const amount = int(Number(b.amount), 1, 100_000_000, 'amount');
      const maxUses = int(Number(b.maxUses ?? 1), 1, 10_000_000, 'maxUses');
      const hours = b.expiresHours === undefined || b.expiresHours === null || b.expiresHours === '' ? null : num(Number(b.expiresHours), 0.1, 24 * 3650, 'expiresHours');
      const row = await db.one(
        `INSERT INTO bs_promo_codes (code, amount, max_uses, expires_at, created_by)
         VALUES ($1, $2, $3, CASE WHEN $4::float8 IS NULL THEN NULL ELSE now() + ($4::float8 * interval '1 hour') END, $5)
         ON CONFLICT (code) DO NOTHING
         RETURNING code, amount, max_uses, uses, expires_at, active, created_at`,
        [code, amount, maxUses, hours, req.user.id],
      );
      if (!row) throw new GameError('promo_exists');
      return { promo: row };
    }),
  );

  r.patch(
    '/promos/:code',
    wrap(async (req) => {
      const active = bool((req.body || {}).active, 'active');
      const row = await db.one('UPDATE bs_promo_codes SET active = $2 WHERE code = $1 RETURNING code, active', [
        game.normalizeCode(req.params.code),
        active,
      ]);
      if (!row) throw new GameError('not_found', 404);
      return { promo: row };
    }),
  );

  r.delete(
    '/promos/:code',
    wrap(async (req) => {
      const del = await db.query('DELETE FROM bs_promo_codes WHERE code = $1', [game.normalizeCode(req.params.code)]);
      if (!del.rowCount) throw new GameError('not_found', 404);
      return { ok: true };
    }),
  );

  // ------------------------------------------------------------ settings
  r.get('/settings', wrap(async () => ({ settings: settings.all() })));
  r.put('/settings', wrap(async (req) => ({ settings: await settings.update(req.body || {}) })));

  r.post(
    '/check-channel',
    wrap(async () => {
      const channel = settings.get('channel');
      if (!channel) throw new GameError('no_channel');
      try {
        return await tg.checkChannel(channel);
      } catch (e) {
        throw new GameError('channel_error', 400, { message: e.description || e.message });
      }
    }),
  );

  // ------------------------------------------------------------ broadcast
  r.get('/broadcast', wrap(async () => ({ status: broadcaster.status() })));
  r.post(
    '/broadcast',
    wrap(async (req) => {
      const text = str((req.body || {}).text, 1, 4000, 'text');
      const withButton = (req.body || {}).button !== false;
      const status = await broadcaster.start(text, { withButton, adminId: req.user.id });
      return { status };
    }),
  );

  return r;
}

export { rarityOf };
