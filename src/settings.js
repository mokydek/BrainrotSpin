// Admin-editable settings stored in bs_settings (JSONB), cached in memory.
import { ADMIN_SECTIONS } from './access.js';

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
  upgrade_luck: { type: 'number', min: 1, max: 10, def: 1.06 }, // every upgrade chance is this many times lower
  start_balance: { type: 'number', min: 0, max: 1_000_000, def: 0, int: true },
  stars_rate: { type: 'number', min: 0.01, max: 1_000_000, def: 1 }, // coins for 1 Telegram Star
  welcome_ru: { type: 'string', max: 1000, def: '' },
  welcome_uk: { type: 'string', max: 1000, def: '' },
  welcome_en: { type: 'string', max: 1000, def: '' },
  admin_hidden: { type: 'list', values: ADMIN_SECTIONS, def: [] }, // admin sections the other admins don't see
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
  if (s.type === 'list') {
    if (!Array.isArray(value) || value.some((v) => !s.values.includes(v))) throw new SettingsError(key, `list of ${s.values.join(', ')} expected`);
    return s.values.filter((v) => value.includes(v));
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

/**
 * Once per database: the upgrader bad luck goes down to 1.06 if it is higher, so the 75% upgrade
 * is there again (80 / 1.06 = 75.4%). After that the main admin changes it as usual.
 */
export async function lowerLuckOnce(settings) {
  if (settings.get('_luck_106')) return false;
  const lower = settings.get('upgrade_luck') > 1.06;
  if (lower) await settings.update({ upgrade_luck: 1.06 });
  await settings.setInternal('_luck_106', true);
  return lower;
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
      if (clean.upgrade_min_chance !== undefined || clean.upgrade_max_chance !== undefined || clean.upgrade_luck !== undefined) {
        const min = clean.upgrade_min_chance ?? cache.upgrade_min_chance;
        const max = clean.upgrade_max_chance ?? cache.upgrade_max_chance;
        const luck = clean.upgrade_luck ?? cache.upgrade_luck;
        if (min >= max) throw new SettingsError('upgrade_min_chance', 'must be lower than max chance');
        // the highest chance a player can get must stay above the minimum
        if (min >= max / luck) throw new SettingsError('upgrade_luck', 'max chance / luck must be above min chance');
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
