// Starts the app with demo data and drives it with Playwright (headless Chromium).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { startApp } from '../helpers.js';
import { buildInitData } from '../../src/auth.js';
import { BOT_TOKEN } from '../helpers.js';

const require = createRequire(import.meta.url);

export function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    const globalRoot = execSync('npm root -g').toString().trim();
    return require(`${globalRoot}/playwright`);
  }
}

export const ME = { id: 5001, first_name: 'Тест', username: 'brainrot_fan', language_code: 'ru' };

const OTHERS = ['Артём', 'Kira', 'Даня', 'Sasha', 'Лёша', 'Max', 'Ника', 'Olya', 'Женя', 'Tim'].map((n, i) => ({
  id: 6000 + i,
  first_name: n,
  language_code: i % 3 === 0 ? 'uk' : 'ru',
}));

export async function startDemo({ dbName = 'bs_t_ui', env = {} } = {}) {
  const app = await startApp({ dbName, env });
  const { ctx } = app;
  // Web URL for the UI = the local server itself
  const cases = [...ctx.game.catalog.cases.values()];
  const bySlug = Object.fromEntries(cases.map((c) => [c.slug, c]));

  // Other players open cases to fill the live feed
  for (const u of OTHERS) {
    await app.post('/api/bootstrap', { user: u });
    await app.setBalance(u.id, 20000);
  }
  const plan = ['noob', 'pro', 'fish', 'dlc', 'halloween', 'summer', 'dragon', 'mushroom', 'griffin', 'noob', 'fish', 'pro'];
  let k = 0;
  for (const slug of plan) {
    for (const u of OTHERS.slice(0, 3)) {
      const who = OTHERS[(k++ * 7) % OTHERS.length] || u;
      await app.post(`/api/case/${bySlug[slug].id}/open`, { user: who });
    }
  }

  // The tester: admin, some coins and items
  await app.post('/api/bootstrap', { user: ME });
  await app.makeAdmin(ME.id);
  await app.setBalance(ME.id, 5000);
  for (const slug of ['dlc', 'fish', 'pro', 'noob', 'halloween']) {
    await app.post(`/api/case/${bySlug[slug].id}/open`, { user: ME });
  }
  await new Promise((r) => setTimeout(r, 3100)); // rate-limit window
  await app.setBalance(ME.id, 1250);
  await ctx.db.query(
    "INSERT INTO bs_promo_codes (code, amount, max_uses) VALUES ('BRAINROT100', 100, 50), ('WELCOME', 25, 1000) ON CONFLICT DO NOTHING",
  );
  return { app, ctx, bySlug, me: ME, others: OTHERS };
}

export function telegramStub(user, { version = '8.0' } = {}) {
  const init = buildInitData(user, BOT_TOKEN);
  return `
  window.__tgCalls = [];
  window.Telegram = { WebApp: {
    initData: ${JSON.stringify(init)},
    initDataUnsafe: { user: ${JSON.stringify(user)} },
    version: ${JSON.stringify(version)}, platform: 'ios', colorScheme: 'dark', themeParams: {},
    isVersionAtLeast(v) { return parseFloat(this.version) >= parseFloat(v); },
    ready() { __tgCalls.push(['ready']); }, expand() { __tgCalls.push(['expand']); },
    disableVerticalSwipes() {}, setHeaderColor(c) { __tgCalls.push(['setHeaderColor', c]); },
    setBackgroundColor() {}, setBottomBarColor() {},
    BackButton: { isVisible: false, show() { this.isVisible = true; }, hide() { this.isVisible = false; }, onClick(cb) { window.__tgBack = cb; } },
    HapticFeedback: { impactOccurred() {}, notificationOccurred() {}, selectionChanged() {} },
    shareMessage(id, cb) { __tgCalls.push(['shareMessage', id]); setTimeout(() => cb && cb(true), 60); },
    openTelegramLink(u) { __tgCalls.push(['openTelegramLink', u]); },
    openLink(u) { __tgCalls.push(['openLink', u]); },
  } };`;
}

export async function newPage(browser, base, { user = ME, width = 390, height = 844, stub = true, path = '/' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: true, isMobile: width < 600, locale: 'ru-RU' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    // expected 4xx answers (e.g. an already used promo code) are handled by the app
    if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) {
      errors.push('console: ' + m.text());
    }
  });
  await page.route('https://telegram.org/js/telegram-web-app.js*', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: stub ? telegramStub(user) : 'window.Telegram={WebApp:{initData:"",initDataUnsafe:{},ready(){},expand(){},BackButton:{show(){},hide(){},onClick(){}}}};' }),
  );
  await page.goto(base + path);
  return { page, context, errors };
}
