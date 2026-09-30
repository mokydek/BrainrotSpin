import express from 'express';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createDb, migrate } from './db.js';
import { createSettings } from './settings.js';
import { createGame } from './game.js';
import { createLive } from './live.js';
import { createUsers } from './users.js';
import { createTg } from './tg.js';
import { createApi, sendError } from './api.js';
import { createAdmin } from './admin.js';
import { createBot } from './bot.js';
import { GameError } from './game.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const paths = {
  web: path.join(root, 'web'),
  banner: path.join(root, 'web', 'img', 'banner.jpg'),
  avatar: path.join(root, 'assets', 'avatar.jpg'),
  avatarBytes: () => readFileSync(path.join(root, 'assets', 'avatar.jpg')),
};

function cors(config) {
  return (req, res, next) => {
    const origin = req.get('origin');
    if (origin && config.corsOrigins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.set('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  };
}

const noBroadcaster = {
  status: () => ({ running: false, total: 0, sent: 0, failed: 0, startedAt: null, finishedAt: null }),
  start: async () => {
    throw new GameError('bot_disabled', 503);
  },
};

/** Builds the whole app. Call start() to listen and connect the bot. */
export async function createServer(env = process.env, overrides = {}) {
  const config = { ...loadConfig(env), ...(overrides.config || {}) };
  const db = overrides.db || createDb(config.databaseUrl, config.databaseSsl);
  await migrate(db);
  const settings = createSettings(db);
  await settings.load();

  const holder = { bot: null, game: null };
  const tg = overrides.tg || createTg(() => holder.bot, config);
  const live = createLive({
    db,
    getPublicItem: (id) => holder.game.publicItem(holder.game.catalog.items.get(id)),
    // Drops appear in the live feed when the opening animation ends (≈6 s).
    revealDelayMs: Number(env.REVEAL_DELAY_MS ?? (config.isTest ? 0 : 6200)),
  });
  const game = createGame({ db, settings, live, tg, rng: overrides.rng });
  holder.game = game;
  await game.reloadCatalog();
  await live.init();
  const users = createUsers({ db, settings, config });

  let botPart = null;
  if (config.botToken && config.botMode !== 'off') {
    botPart = createBot({ config, db, settings, game, users, live, paths });
    holder.bot = botPart.bot;
  }

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(cors(config));

  if (botPart) app.post(config.webhookPath, express.json({ limit: '1mb' }), botPart.webhookHandler);

  const { router, auth } = createApi({ config, db, settings, game, live, users, tg });
  app.use(
    '/api/admin',
    express.json({ limit: '1mb' }),
    auth,
    createAdmin({ db, settings, game, live, tg, broadcaster: botPart ? botPart.broadcaster : noBroadcaster }),
  );
  app.use('/api', express.json({ limit: '64kb' }), router);
  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

  app.use(
    express.static(paths.web, {
      index: 'index.html',
      setHeaders(res, file) {
        if (file.endsWith('.html') || file.endsWith('config.js')) res.set('Cache-Control', 'no-cache');
        else res.set('Cache-Control', 'public, max-age=3600');
      },
    }),
  );

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => sendError(res, err));

  let server = null;
  const ctx = { config, db, settings, game, live, users, tg, bot: botPart, app };

  ctx.start = async (port = config.port) => {
    await new Promise((resolve) => {
      server = app.listen(port, resolve);
    });
    ctx.port = server.address().port;
    if (botPart) {
      try {
        await botPart.bot.init();
        console.log(`[bot] @${botPart.bot.botInfo.username} ready (${config.botMode})`);
        if (config.botMode === 'webhook') await botPart.setupWebhook();
        else if (config.botMode === 'polling') {
          await botPart.bot.api.deleteWebhook();
          botPart.bot.start({ allowed_updates: ['message', 'callback_query', 'my_chat_member'] }).catch((e) =>
            console.error('[bot] polling stopped:', e.message),
          );
        }
        if (config.setupBotProfile) {
          botPart.setupProfile().catch((e) => console.warn('[bot] profile setup failed:', e.message));
        }
      } catch (e) {
        console.error('[bot] failed to start:', e.description || e.message);
      }
    }
    return ctx.port;
  };

  ctx.stop = async () => {
    live.stop();
    if (botPart && botPart.bot.isRunning()) await botPart.bot.stop();
    if (server) await new Promise((r) => server.close(r));
    if (!overrides.db) await db.end();
  };

  return ctx;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ctx = await createServer();
  const port = await ctx.start();
  console.log(`[server] listening on :${port}`);
  const shutdown = async () => {
    console.log('[server] shutting down');
    await ctx.stop().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
