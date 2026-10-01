import crypto from 'node:crypto';
import { rarityOf } from './rarity.js';

export class GameError extends Error {
  constructor(code, status = 400, extra = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

export const cryptoRng = { int: (max) => crypto.randomInt(0, max) };

export function displayName(u) {
  const name = (u.first_name || '').trim() || (u.username ? `@${u.username}` : `#${u.id}`);
  return name.length > 18 ? name.slice(0, 17) + '…' : name;
}

/** Upgrade chance in percent (2 decimals, rounded down). */
export function upgradeChance(betValue, targetValue, edgePct, maxChance) {
  if (!(targetValue > 0) || !(betValue > 0)) return 0;
  const raw = (betValue / targetValue) * (100 - edgePct);
  return Math.min(maxChance, Math.floor(raw * 100) / 100);
}

/** Weighted pick; chances may be any positive numbers (they are normalised). */
export function pickWeighted(entries, rng = cryptoRng) {
  const weights = entries.map((e) => Math.max(1, Math.round(e.chance * 10000)));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng.int(total);
  for (let i = 0; i < entries.length; i++) {
    if (r < weights[i]) return entries[i];
    r -= weights[i];
  }
  return entries[entries.length - 1];
}

export function createGame({ db, settings, live, tg, rng = cryptoRng }) {
  const catalog = { items: new Map(), cases: new Map(), order: [] };

  function publicItem(it) {
    if (!it) return null;
    return {
      id: it.id,
      name: it.name,
      value: it.value,
      emoji: it.emoji,
      rarity: rarityOf(it.value, it.rarity),
      image: it.image_url || (it.has_image ? `/api/img/item/${it.id}?v=${it.img_ver.slice(0, 8)}` : null),
    };
  }

  function caseImage(c) {
    return c.has_image ? `/api/img/case/${c.id}?v=${c.img_ver.slice(0, 8)}` : null;
  }

  function publicCase(c) {
    const sum = c.items.reduce((s, e) => s + e.chance, 0) || 1;
    return {
      id: c.id,
      slug: c.slug,
      name: { ru: c.name_ru, uk: c.name_uk, en: c.name_en },
      price: c.price,
      isFree: c.is_free,
      emoji: c.emoji,
      color: c.color,
      image: caseImage(c),
      items: c.items
        .map((e) => ({ item: publicItem(catalog.items.get(e.item_id)), chance: Math.round((e.chance / sum) * 100000) / 1000 }))
        .sort((a, b) => b.item.value - a.item.value),
    };
  }

  async function reloadCatalog() {
    const items = await db.many(
      `SELECT id, name, value, emoji, rarity, image_url, enabled,
              (image_data IS NOT NULL) AS has_image, md5(coalesce(image_data, '')) AS img_ver
         FROM bs_items ORDER BY value, id`,
    );
    const cases = await db.many(
      `SELECT id, slug, name_ru, name_uk, name_en, price, is_free, emoji, color, sort, enabled,
              (image_data IS NOT NULL) AS has_image, md5(coalesce(image_data, '')) AS img_ver
         FROM bs_cases ORDER BY sort, id`,
    );
    const links = await db.many('SELECT case_id, item_id, chance FROM bs_case_items ORDER BY case_id, item_id');
    catalog.items = new Map(items.map((i) => [i.id, i]));
    const map = new Map(cases.map((c) => [c.id, { ...c, items: [] }]));
    for (const l of links) {
      const c = map.get(l.case_id);
      const it = catalog.items.get(l.item_id);
      if (c && it) c.items.push({ item_id: l.item_id, chance: l.chance });
    }
    catalog.cases = map;
    catalog.order = cases.map((c) => c.id);
  }

  function listCases({ includeDisabled = false } = {}) {
    return catalog.order
      .map((id) => catalog.cases.get(id))
      .filter((c) => includeDisabled || (c.enabled && c.items.length > 0))
      .map(publicCase);
  }

  function listItems({ includeDisabled = false } = {}) {
    return [...catalog.items.values()].filter((i) => includeDisabled || i.enabled).map(publicItem);
  }

  function freeCase() {
    for (const id of catalog.order) {
      const c = catalog.cases.get(id);
      if (c.is_free && c.enabled && c.items.length) return c;
    }
    return null;
  }

  function upgradeSettings() {
    return {
      edge: settings.get('upgrade_edge'),
      minChance: settings.get('upgrade_min_chance'),
      maxChance: settings.get('upgrade_max_chance'),
    };
  }

  // ---------------------------------------------------------------- drops
  async function recordDrop(client, user, item, caseRow, kind) {
    const r = await client.query(
      'INSERT INTO bs_drops (user_id, item_id, value, case_id, kind) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at',
      [user.id, item.id, item.value, caseRow ? caseRow.id : null, kind],
    );
    return {
      id: r.rows[0].id,
      at: r.rows[0].created_at,
      kind,
      value: item.value,
      item: publicItem(item),
      user: { name: displayName(user) },
      caseId: caseRow ? caseRow.id : null,
    };
  }

  async function giveItem(client, userId, item, source) {
    const r = await client.query(
      'INSERT INTO bs_inventory (user_id, item_id, source) VALUES ($1, $2, $3) RETURNING id',
      [userId, item.id, source],
    );
    return r.rows[0].id;
  }

  // ---------------------------------------------------------------- cases
  async function openCase(user, caseId) {
    const c = catalog.cases.get(Number(caseId));
    if (!c || !c.enabled || !c.items.length) throw new GameError('case_not_found', 404);
    if (c.is_free) throw new GameError('use_free_endpoint');
    const pick = pickWeighted(c.items, rng);
    const item = catalog.items.get(pick.item_id);

    const res = await db.tx(async (cl) => {
      const u = (await cl.query('SELECT id, balance FROM bs_users WHERE id = $1 FOR UPDATE', [user.id])).rows[0];
      if (!u) throw new GameError('unauthorized', 401);
      if (u.balance < c.price) throw new GameError('not_enough', 400, { balance: u.balance });
      const invId = await giveItem(cl, user.id, item, 'case');
      const upd = await cl.query(
        `UPDATE bs_users SET balance = balance - $2, cases_opened = cases_opened + 1,
                total_spent = total_spent + $2, total_won = total_won + $3,
                best_item_id = CASE WHEN $3 > best_value THEN $4 ELSE best_item_id END,
                best_value = GREATEST(best_value, $3)
          WHERE id = $1 RETURNING balance`,
        [user.id, c.price, item.value, item.id],
      );
      const drop = await recordDrop(cl, user, item, c, 'case');
      return { invId, balance: upd.rows[0].balance, drop };
    });
    live?.pushDrop(res.drop);
    return { invId: res.invId, item: publicItem(item), balance: res.balance };
  }

  function freeState(u) {
    const cooldownMs = settings.get('free_cooldown_hours') * 3600_000;
    const last = u.free_last_at ? new Date(u.free_last_at).getTime() : 0;
    const nextAt = last && last + cooldownMs > Date.now() ? new Date(last + cooldownMs).toISOString() : null;
    const shared = !!u.shared_at && (!u.free_last_at || new Date(u.shared_at) > new Date(u.free_last_at));
    const channel = settings.get('channel');
    const c = freeCase();
    return {
      available: !!c,
      caseId: c ? c.id : null,
      nextAt,
      requireSub: !!(settings.get('free_require_sub') && channel),
      requireShare: !!settings.get('free_require_share'),
      shared,
      channelUrl: settings.get('channel_url') || (channel.startsWith('@') ? `https://t.me/${channel.slice(1)}` : ''),
    };
  }

  async function checkSubscription(userId) {
    const channel = settings.get('channel');
    if (!channel) return true;
    if (!tg) throw new GameError('sub_check_failed', 503);
    try {
      return await tg.isSubscribed(channel, userId);
    } catch (e) {
      console.warn('[free] subscription check failed:', e.message);
      throw new GameError('sub_check_failed', 503);
    }
  }

  async function markShared(userId) {
    await db.query('UPDATE bs_users SET shared_at = now() WHERE id = $1', [userId]);
  }

  async function openFree(user) {
    const c = freeCase();
    if (!c) throw new GameError('case_not_found', 404);
    const fresh = await db.one('SELECT * FROM bs_users WHERE id = $1', [user.id]);
    const st = freeState(fresh);
    if (st.nextAt) throw new GameError('cooldown', 400, { nextAt: st.nextAt });
    if (st.requireShare && !st.shared) throw new GameError('need_share');
    if (st.requireSub && !(await checkSubscription(user.id))) throw new GameError('need_sub');

    const pick = pickWeighted(c.items, rng);
    const item = catalog.items.get(pick.item_id);
    const cooldownMs = settings.get('free_cooldown_hours') * 3600_000;
    const res = await db.tx(async (cl) => {
      const u = (await cl.query('SELECT id, free_last_at, shared_at FROM bs_users WHERE id = $1 FOR UPDATE', [user.id]))
        .rows[0];
      if (!u) throw new GameError('unauthorized', 401);
      // Re-check inside the lock so parallel requests can't claim twice.
      if (u.free_last_at && new Date(u.free_last_at).getTime() + cooldownMs > Date.now()) {
        throw new GameError('cooldown', 400, { nextAt: new Date(new Date(u.free_last_at).getTime() + cooldownMs).toISOString() });
      }
      if (st.requireShare && !(u.shared_at && (!u.free_last_at || new Date(u.shared_at) > new Date(u.free_last_at)))) {
        throw new GameError('need_share');
      }
      const invId = await giveItem(cl, user.id, item, 'free');
      const upd = await cl.query(
        `UPDATE bs_users SET free_last_at = now(), cases_opened = cases_opened + 1,
                total_won = total_won + $2,
                best_item_id = CASE WHEN $2 > best_value THEN $3 ELSE best_item_id END,
                best_value = GREATEST(best_value, $2)
          WHERE id = $1 RETURNING balance, free_last_at`,
        [user.id, item.value, item.id],
      );
      const drop = await recordDrop(cl, user, item, c, 'free');
      return { invId, balance: upd.rows[0].balance, freeLastAt: upd.rows[0].free_last_at, drop };
    });
    live?.pushDrop(res.drop);
    return {
      invId: res.invId,
      item: publicItem(item),
      balance: res.balance,
      nextAt: new Date(new Date(res.freeLastAt).getTime() + cooldownMs).toISOString(),
    };
  }

  // ---------------------------------------------------------------- inventory
  async function inventory(userId) {
    const rows = await db.many(
      'SELECT id, item_id, created_at FROM bs_inventory WHERE user_id = $1 ORDER BY id DESC LIMIT 1000',
      [userId],
    );
    return rows
      .map((r) => ({ invId: r.id, at: r.created_at, item: publicItem(catalog.items.get(r.item_id)) }))
      .filter((r) => r.item);
  }

  function parseIds(ids, max = 1000) {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > max) throw new GameError('bad_request');
    const out = [...new Set(ids.map(Number))];
    if (out.some((n) => !Number.isSafeInteger(n) || n <= 0)) throw new GameError('bad_request');
    return out;
  }

  async function sell(userId, { ids, all } = {}) {
    const list = all ? null : parseIds(ids);
    return db.tx(async (cl) => {
      await cl.query('SELECT id FROM bs_users WHERE id = $1 FOR UPDATE', [userId]);
      const del = all
        ? await cl.query('DELETE FROM bs_inventory WHERE user_id = $1 RETURNING item_id', [userId])
        : await cl.query('DELETE FROM bs_inventory WHERE user_id = $1 AND id = ANY($2::bigint[]) RETURNING item_id', [
            userId,
            list,
          ]);
      if (!all && del.rowCount !== list.length) throw new GameError('items_missing');
      const total = del.rows.reduce((s, r) => s + (catalog.items.get(r.item_id)?.value || 0), 0);
      const upd = await cl.query(
        'UPDATE bs_users SET balance = balance + $2, sold_value = sold_value + $2 WHERE id = $1 RETURNING balance',
        [userId, total],
      );
      return { sold: del.rowCount, amount: total, balance: upd.rows[0].balance };
    });
  }

  // ---------------------------------------------------------------- upgrader
  async function upgrade(user, { ids, target }) {
    const list = parseIds(ids, 6);
    const targetItem = catalog.items.get(Number(target));
    if (!targetItem || !targetItem.enabled) throw new GameError('item_not_found', 404);
    const s = upgradeSettings();

    const res = await db.tx(async (cl) => {
      await cl.query('SELECT id FROM bs_users WHERE id = $1 FOR UPDATE', [user.id]);
      const inv = await cl.query(
        'SELECT id, item_id FROM bs_inventory WHERE user_id = $1 AND id = ANY($2::bigint[]) FOR UPDATE',
        [user.id, list],
      );
      if (inv.rowCount !== list.length) throw new GameError('items_missing');
      const bet = inv.rows.reduce((sum, r) => sum + (catalog.items.get(r.item_id)?.value || 0), 0);
      if (targetItem.value <= bet) throw new GameError('target_too_cheap');
      const chance = upgradeChance(bet, targetItem.value, s.edge, s.maxChance);
      if (chance < s.minChance) throw new GameError('chance_too_low');
      const roll = rng.int(100000) / 1000;
      const won = roll < chance;
      await cl.query('DELETE FROM bs_inventory WHERE id = ANY($1::bigint[])', [list]);
      let invId = null;
      let drop = null;
      if (won) {
        invId = await giveItem(cl, user.id, targetItem, 'upgrade');
        drop = await recordDrop(cl, user, targetItem, null, 'upgrade');
      }
      await cl.query(
        `UPDATE bs_users SET upgrades_total = upgrades_total + 1, upgrades_won = upgrades_won + $2,
                best_item_id = CASE WHEN $2 = 1 AND $3 > best_value THEN $4 ELSE best_item_id END,
                best_value = CASE WHEN $2 = 1 THEN GREATEST(best_value, $3) ELSE best_value END
          WHERE id = $1`,
        [user.id, won ? 1 : 0, targetItem.value, targetItem.id],
      );
      await cl.query(
        'INSERT INTO bs_upgrades (user_id, bet_value, target_item_id, chance, roll, won) VALUES ($1,$2,$3,$4,$5,$6)',
        [user.id, bet, targetItem.id, chance, roll, won],
      );
      return { won, roll, chance, bet, invId, drop };
    });
    if (res.drop) live?.pushDrop(res.drop, live.upgradeDelayMs);
    return { won: res.won, roll: res.roll, chance: res.chance, bet: res.bet, invId: res.invId, item: publicItem(targetItem) };
  }

  // ---------------------------------------------------------------- promo
  function normalizeCode(code) {
    return String(code || '')
      .trim()
      .toUpperCase()
      .slice(0, 40);
  }

  async function redeemPromo(userId, rawCode) {
    const code = normalizeCode(rawCode);
    if (!/^[A-Z0-9_-]{3,40}$/.test(code)) throw new GameError('promo_invalid');
    return db.tx(async (cl) => {
      const p = (await cl.query('SELECT * FROM bs_promo_codes WHERE code = $1 FOR UPDATE', [code])).rows[0];
      if (!p || !p.active) throw new GameError('promo_invalid');
      if (p.expires_at && new Date(p.expires_at).getTime() < Date.now()) throw new GameError('promo_expired');
      if (p.uses >= p.max_uses) throw new GameError('promo_limit');
      const ins = await cl.query(
        'INSERT INTO bs_promo_uses (code, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING code',
        [code, userId],
      );
      if (!ins.rowCount) throw new GameError('promo_used');
      await cl.query('UPDATE bs_promo_codes SET uses = uses + 1 WHERE code = $1', [code]);
      const upd = await cl.query('UPDATE bs_users SET balance = balance + $2 WHERE id = $1 RETURNING balance', [
        userId,
        p.amount,
      ]);
      if (!upd.rowCount) throw new GameError('unauthorized', 401);
      await cl.query("INSERT INTO bs_balance_log (user_id, delta, reason) VALUES ($1, $2, 'promo:' || $3)", [
        userId,
        p.amount,
        code,
      ]);
      return { code, amount: p.amount, balance: upd.rows[0].balance };
    });
  }

  // ---------------------------------------------------------------- stats
  async function stats(userId) {
    const u = await db.one('SELECT * FROM bs_users WHERE id = $1', [userId]);
    if (!u) return null;
    const inv = await db.one(
      'SELECT count(*)::int AS n, coalesce(sum(it.value), 0)::bigint AS v FROM bs_inventory inv JOIN bs_items it ON it.id = inv.item_id WHERE inv.user_id = $1',
      [userId],
    );
    return {
      casesOpened: u.cases_opened,
      totalSpent: u.total_spent,
      totalWon: u.total_won,
      bestDrop: u.best_item_id ? publicItem(catalog.items.get(u.best_item_id)) : null,
      upgradesTotal: u.upgrades_total,
      upgradesWon: u.upgrades_won,
      soldValue: u.sold_value,
      inventoryCount: inv.n,
      inventoryValue: inv.v,
      since: u.created_at,
    };
  }

  return {
    catalog,
    reloadCatalog,
    listCases,
    listItems,
    publicItem,
    caseImage,
    freeCase,
    freeState,
    upgradeSettings,
    openCase,
    openFree,
    checkSubscription,
    markShared,
    inventory,
    sell,
    upgrade,
    redeemPromo,
    normalizeCode,
    stats,
    giveItem,
    recordDrop,
  };
}
