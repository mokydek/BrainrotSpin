// Admin-editable settings stored in bs_settings (JSONB), cached in memory.

const url = { type: 'string', max: 300, url: true };

export const SETTINGS_SCHEMA = {
  channel: { type: 'string', max: 100, def: '' }, // @username or -100… id used for the subscription check
  channel_url: { ...url, def: '' }, // link opened by the "subscribe" button
  news_url: { ...url, def: '' }, // "News" button in /start (falls back to channel_url)
  support_url: { ...url, def: '' }, // "Support" button in /start
  free_cooldown_hours: { type: 'number', min: 1, max: 720, def: 24 },
  free_require_sub: { type: 'boolean', def: true },
  free_require_share: { type: 'boolean', def: true },
  upgrade_edge: { type: 'number', min: 0, max: 90, def: 10 }, // % kept by the upgrader
  upgrade_min_chance: { type: 'number', min: 0.01, max: 50, def: 1 },
  upgrade_max_chance: { type: 'number', min: 1, max: 95, def: 80 },
  start_balance: { type: 'number', min: 0, max: 1_000_000, def: 0, int: true },
  welcome_ru: { type: 'string', max: 1000, def: '' },
  welcome_uk: { type: 'string', max: 1000, def: '' },
  welcome_en: { type: 'string', max: 1000, def: '' },
};

// Internal keys (prefixed with _) are never exposed through the admin API.
const INTERNAL = /^_/;

export class SettingsError extends Error {
  constructor(key, reason) {
    super(`${key}: ${reason}`);
    this.key = key;
    this.code = 'bad_setting';
  }
}

export function validateSetting(key, value) {
  const s = SETTINGS_SCHEMA[key];
  if (!s) throw new SettingsError(key, 'unknown');
  if (s.type === 'boolean') {
    if (typeof value !== 'boolean') throw new SettingsError(key, 'boolean expected');
    return value;
  }
  if (s.type === 'number') {
    const n = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
    if (typeof n !== 'number' || !Number.isFinite(n)) throw new SettingsError(key, 'number expected');
    if (n < s.min || n > s.max) throw new SettingsError(key, `must be ${s.min}..${s.max}`);
    return s.int ? Math.round(n) : Math.round(n * 1000) / 1000;
  }
  if (typeof value !== 'string') throw new SettingsError(key, 'string expected');
  const v = value.trim();
  if (v.length > s.max) throw new SettingsError(key, 'too long');
  if (s.url && v && !/^https:\/\/\S+$/i.test(v) && !/^tg:\/\/\S+$/i.test(v)) {
    throw new SettingsError(key, 'https link expected');
  }
  if (key === 'channel' && v && !/^(@[A-Za-z0-9_]{4,64}|-100\d{5,20})$/.test(v)) {
    throw new SettingsError(key, '@username or -100… id expected');
  }
  return v;
}

export function createSettings(db) {
  const cache = {};
  for (const [k, s] of Object.entries(SETTINGS_SCHEMA)) cache[k] = s.def;

  return {
    async load() {
      const rows = await db.many('SELECT key, value FROM bs_settings');
      for (const r of rows) cache[r.key] = r.value;
    },
    get(key) {
      return cache[key];
    },
    /** Public (admin-visible) settings only. */
    all() {
      const out = {};
      for (const k of Object.keys(SETTINGS_SCHEMA)) out[k] = cache[k];
      return out;
    },
    async update(patch) {
      const clean = {};
      for (const [k, v] of Object.entries(patch || {})) clean[k] = validateSetting(k, v);
      if (clean.upgrade_min_chance !== undefined || clean.upgrade_max_chance !== undefined) {
        const min = clean.upgrade_min_chance ?? cache.upgrade_min_chance;
        const max = clean.upgrade_max_chance ?? cache.upgrade_max_chance;
        if (min >= max) throw new SettingsError('upgrade_min_chance', 'must be lower than max chance');
      }
      for (const [k, v] of Object.entries(clean)) {
        await db.query(
          'INSERT INTO bs_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
          [k, JSON.stringify(v)],
        );
        cache[k] = v;
      }
      return this.all();
    },
    /** Internal values (file ids, profile hashes). */
    async setInternal(key, value) {
      if (!INTERNAL.test(key)) throw new Error('internal keys must start with _');
      await db.query(
        'INSERT INTO bs_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        [key, JSON.stringify(value)],
      );
      cache[key] = value;
    },
  };
}
