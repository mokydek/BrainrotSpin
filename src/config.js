import crypto from 'node:crypto';

function trimSlash(u) {
  return (u || '').trim().replace(/\/+$/, '');
}

function derive(secret, label) {
  return crypto.createHmac('sha256', secret).update(label).digest('hex');
}

/**
 * Reads configuration from environment variables.
 * Only DATABASE_URL is strictly required; without BOT_TOKEN the bot is disabled
 * and Telegram authentication can't work (useful for local UI work only).
 */
export function loadConfig(env = process.env) {
  const botToken = (env.BOT_TOKEN || '').trim();
  const apiUrl = trimSlash(env.API_URL || env.RENDER_EXTERNAL_URL || '');
  const webUrl = trimSlash(env.WEB_URL || apiUrl);
  // Without a bot token or explicit secret, use a random per-process secret so login tokens can't be forged.
  const base = botToken || env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

  const cfg = {
    port: Number(env.PORT || 3000),
    databaseUrl: env.DATABASE_URL || '',
    databaseSsl: env.DATABASE_SSL || '',
    botToken,
    botMode: (env.BOT_MODE || (apiUrl ? 'webhook' : 'polling')).toLowerCase(),
    telegramApiRoot: env.TELEGRAM_API_ROOT || '',
    apiUrl,
    webUrl,
    webhookPath: '/tg/webhook',
    webhookSecret: env.WEBHOOK_SECRET || derive(base, 'webhook').slice(0, 48),
    sessionSecret: env.SESSION_SECRET || derive(base, 'session'),
    adminCode: (env.ADMIN_CODE || '').trim(),
    adminIds: (env.ADMIN_IDS || '')
      .split(/[\s,]+/)
      .map((s) => Number(s))
      .filter((n) => Number.isSafeInteger(n) && n > 0),
    // Main admins: always admin, can't be banned or demoted; shown as a regular admin.
    // By Telegram id, or by @username (the first account seen with it is pinned by id).
    ownerIds: (env.OWNER_IDS || '')
      .split(/[\s,]+/)
      .map((s) => Number(s))
      .filter((n) => Number.isSafeInteger(n) && n > 0),
    ownerUsernames: (env.OWNER_USERNAMES || '')
      .split(/[\s,]+/)
      .map((s) => s.replace(/^@+/, '').toLowerCase())
      .filter(Boolean),
    corsOrigins: (env.CORS_ORIGINS || '')
      .split(/[\s,]+/)
      .map(trimSlash)
      .filter(Boolean),
    initDataMaxAge: Number(env.INIT_DATA_MAX_AGE || 86400),
    setupBotProfile: env.SETUP_BOT_PROFILE !== '0',
    isTest: env.NODE_ENV === 'test',
  };

  if (cfg.webUrl) {
    try {
      const origin = new URL(cfg.webUrl).origin;
      if (!cfg.corsOrigins.includes(origin)) cfg.corsOrigins.push(origin);
    } catch {
      /* ignore invalid WEB_URL */
    }
  }
  return cfg;
}
