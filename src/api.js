import express from 'express';
import { validateInitData, verifyWebToken } from './auth.js';
import { GameError } from './game.js';
import { LANGS } from './texts.js';
import { THEMES } from './users.js';

/** Sends GameError / unexpected errors as { error } JSON. */
export function sendError(res, e) {
  if (e instanceof GameError) return res.status(e.status).json({ error: e.code, ...e.extra });
  if (e && e.code === 'bad_setting') return res.status(400).json({ error: 'bad_setting', key: e.key, message: e.message });
  if (e && e.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_request' });
  if (e && e.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
  console.error('[api] unexpected error:', e);
  return res.status(500).json({ error: 'server_error' });
}

export const wrap = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) {
    sendError(res, e);
  }
};

/** Very small fixed-window limiter keyed by user id. */
export function rateLimiter(limit, windowMs) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs * 2);
  timer.unref?.();
  return (req, res, next) => {
    const key = req.user ? req.user.id : req.ip;
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) {
      h = { n: 0, reset: now + windowMs };
      hits.set(key, h);
    }
    if (++h.n > limit) return res.status(429).json({ error: 'rate_limited' });
    next();
  };
}

export function createAuth({ config, db, users, live }) {
  const lastSeenWrite = new Map();
  return async function auth(req, res, next) {
    try {
      const h = req.get('authorization') || '';
      let user = null;
      if (h.startsWith('tma ')) {
        const data = validateInitData(h.slice(4), config.botToken, config.initDataMaxAge);
        if (!data) return res.status(401).json({ error: 'unauthorized' });
        req.tgUser = data.user;
        // Bootstrap refreshes the profile (name, username, photo); other calls just load the row.
        user = req.path === '/bootstrap' ? null : await users.ensureUser(data.user.id);
        if (!user) user = await users.upsertFromTelegram(data.user);
      } else if (h.startsWith('web ')) {
        const t = verifyWebToken(h.slice(4), config.sessionSecret);
        if (!t) return res.status(401).json({ error: 'unauthorized' });
        user = await users.ensureUser(t.userId);
        if (!user || user.web_ver !== t.ver) return res.status(401).json({ error: 'unauthorized' });
      } else {
        return res.status(401).json({ error: 'unauthorized' });
      }
      if (user.is_banned) return res.status(403).json({ error: 'banned' });
      req.user = user;
      live.touch(user.id);
      const now = Date.now();
      if ((lastSeenWrite.get(user.id) || 0) < now - 60_000) {
        lastSeenWrite.set(user.id, now);
        db.query('UPDATE bs_users SET last_seen_at = now() WHERE id = $1', [user.id]).catch(() => {});
      }
      next();
    } catch (e) {
      sendError(res, e);
    }
  };
}

export function meView(u) {
  return {
    id: u.id,
    name: u.first_name || u.username || `#${u.id}`,
    username: u.username,
    photo: u.photo_url && /^https:\/\//.test(u.photo_url) ? u.photo_url : null,
    lang: u.lang,
    theme: u.theme,
    balance: u.balance,
    isAdmin: u.is_admin,
    createdAt: u.created_at,
  };
}

export function createApi(deps) {
  const { config, db, settings, game, live, users, tg } = deps;
  const r = express.Router();
  const auth = createAuth(deps);
  const limitActions = rateLimiter(12, 3000);
  const limitLight = rateLimiter(60, 10_000);

  r.get('/health', (req, res) => res.json({ ok: true, bot: tg.botUsername || null }));

  r.get('/public', (req, res) =>
    res.json({ bot: tg.botUsername || null, webUrl: config.webUrl || null }),
  );

  r.get('/feed', (req, res) => res.json(live.snapshot()));
  r.get('/stream', (req, res) => live.sseHandler(req, res));

  // uploaded pictures of items and cases (stored as data URLs)
  const sendImage = (table) => async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id)) return res.status(404).end();
    const row = await db.one(`SELECT image_data FROM ${table} WHERE id = $1`, [id]).catch(() => null);
    const m = row && /^data:(image\/(png|jpeg|webp|gif));base64,(.+)$/.exec(row.image_data || '');
    if (!m) return res.status(404).end();
    res.set('Content-Type', m[1]);
    res.set('Cache-Control', 'public, max-age=604800, immutable');
    res.send(Buffer.from(m[3], 'base64'));
  };
  r.get('/img/item/:id', sendImage('bs_items'));
  r.get('/img/case/:id', sendImage('bs_cases'));

  // ------------------------------------------------------------ player
  r.post(
    '/bootstrap',
    auth,
    limitLight,
    wrap(async (req) => {
      const u = req.user;
      return {
        me: meView(u),
        cases: game.listCases(),
        items: game.listItems(),
        upgrade: game.upgradeSettings(),
        free: game.freeState(u),
        live: live.snapshot(),
        stats: await game.stats(u.id),
        inventory: await game.inventory(u.id),
        bot: tg.botUsername || null,
        links: {
          news: settings.get('news_url') || settings.get('channel_url') || null,
          support: settings.get('support_url') || null,
        },
      };
    }),
  );

  r.post('/ping', auth, limitLight, (req, res) => res.json({ online: live.online() }));

  r.post(
    '/prefs',
    auth,
    limitLight,
    wrap(async (req) => {
      const { lang, theme } = req.body || {};
      if (lang !== undefined && !LANGS.includes(lang)) throw new GameError('bad_request');
      if (theme !== undefined && !THEMES.includes(theme)) throw new GameError('bad_request');
      const u = await db.one(
        'UPDATE bs_users SET lang = COALESCE($2, lang), theme = COALESCE($3, theme) WHERE id = $1 RETURNING lang, theme',
        [req.user.id, lang ?? null, theme ?? null],
      );
      return u;
    }),
  );

  r.get('/me', auth, limitLight, wrap(async (req) => ({ me: meView(req.user), stats: await game.stats(req.user.id), free: game.freeState(req.user) })));
  r.get('/inventory', auth, limitLight, wrap(async (req) => ({ inventory: await game.inventory(req.user.id) })));
  r.get('/catalog', auth, limitLight, wrap(async () => ({ cases: game.listCases(), items: game.listItems(), upgrade: game.upgradeSettings() })));

  r.post('/case/:id/open', auth, limitActions, wrap(async (req) => game.openCase(req.user, req.params.id)));

  r.post(
    '/free/check',
    auth,
    limitActions,
    wrap(async (req) => {
      const st = game.freeState(req.user);
      const subscribed = st.requireSub ? await game.checkSubscription(req.user.id) : true;
      return { ...st, subscribed };
    }),
  );

  r.post(
    '/free/share',
    auth,
    limitActions,
    wrap(async (req) => {
      const lang = req.user.lang;
      let preparedId = null;
      if (tg.enabled && req.get('authorization').startsWith('tma ')) {
        try {
          preparedId = await tg.prepareShare(req.user.id, lang);
        } catch (e) {
          console.warn('[share] savePreparedInlineMessage failed:', e.message);
        }
      }
      return { preparedId, url: tg.shareFallbackUrl(lang) };
    }),
  );

  r.post(
    '/free/shared',
    auth,
    limitActions,
    wrap(async (req) => {
      await game.markShared(req.user.id);
      const u = await users.ensureUser(req.user.id);
      return game.freeState(u);
    }),
  );

  r.post('/free/open', auth, limitActions, wrap(async (req) => game.openFree(req.user)));

  r.post('/sell', auth, limitActions, wrap(async (req) => game.sell(req.user.id, req.body || {})));

  r.post('/upgrade', auth, limitActions, wrap(async (req) => game.upgrade(req.user, req.body || {})));

  r.post('/promo', auth, limitActions, wrap(async (req) => game.redeemPromo(req.user.id, (req.body || {}).code)));

  return { router: r, auth };
}
