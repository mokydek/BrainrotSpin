// End-to-end UI checks in headless Chromium (skipped when Playwright isn't installed).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDemo, loadPlaywright, newPage, ME } from './ui/harness.mjs';
import { signWebToken } from '../src/auth.js';

let pw = null;
try {
  pw = loadPlaywright();
} catch {
  pw = null;
}

const skip = !pw && 'playwright not installed';
let demo;
let browser;
const allErrors = [];

before(async () => {
  if (skip) return;
  demo = await startDemo({ dbName: 'bs_t_ui' });
  browser = await pw.chromium.launch();
});
after(async () => {
  await browser?.close();
  await demo?.app.close();
});

async function open(opts = {}) {
  const r = await newPage(browser, demo.app.base, opts);
  allErrors.push(r.errors);
  return r;
}
const num = (s) => Number(String(s).replace(/[^\d]/g, ''));
const apiMe = async () => (await demo.app.get('/api/me', { user: ME })).body;

test('home: header, live drops, top drop, all 10 cases, no errors', { skip }, async () => {
  const { page, errors } = await open();
  await page.waitForSelector('.case-grid');
  assert.equal(await page.textContent('.brand-name'), 'BrainrotSpin');
  assert.equal(num(await page.textContent('#bal')), 1250);
  assert.match(await page.textContent('#online'), /^\d+ онлайн$/);
  assert.equal(await page.locator('.free-card').count(), 1);
  assert.equal(await page.locator('.case-card').count(), 9);
  const names = await page.locator('.case-name').allTextContents();
  assert.deepEqual(names, ['Нуб кейс', 'Про кейс', 'Рыбный кейс', 'DLC кейс', 'Хэллоуин кейс', 'Летний кейс', 'Драгон кейс', 'Грибной кейс', 'Грифон кейс']);
  const prices = (await page.locator('.case-price').allTextContents()).map(num);
  assert.deepEqual(prices, [10, 25, 65, 200, 250, 350, 450, 750, 2000]);
  assert.ok((await page.locator('#feed .drop').count()) >= 10);
  assert.match(await page.textContent('#top24'), /Топ дроп 24ч/);
  assert.equal(await page.textContent('.live-title span'), 'Последние дропы онлайн');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('opening a paid case: charge, spin, result, sell', { skip }, async () => {
  const { page, errors } = await open();
  await page.waitForSelector('.case-grid');
  const noob = demo.bySlug.noob;
  await page.click(`[data-case="${noob.id}"]`);
  await page.waitForSelector('#roulette');
  assert.equal(await page.locator('.grid.items .item').count(), noob.items.length);
  const before = num(await page.textContent('#bal'));
  await page.click('[data-act="open"]');
  await page.waitForFunction((b) => Number(document.querySelector('#bal').textContent.replace(/\D/g, '')) === b - 10, before);
  await page.waitForSelector('.result', { timeout: 9000 });
  const name = await page.textContent('.result-name');
  const value = num(await page.textContent('.result-val'));
  const inv = (await demo.app.get('/api/inventory', { user: ME })).body.inventory;
  assert.equal(inv[0].item.name, name, 'shown item is the one the server gave');
  assert.equal(inv[0].item.value, value);
  // the winning tile under the marker is the same item
  assert.equal(await page.textContent('#track .r-tile.win .r-name'), name);
  await page.click('[data-act="sell-won"]');
  await page.waitForSelector('.toast.ok');
  assert.equal(num(await page.textContent('#bal')), before - 10 + value);
  assert.equal((await apiMe()).me.balance, before - 10 + value);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('selling the drop re-enables opening when the balance is enough again', { skip }, async () => {
  const noob = demo.bySlug.noob;
  await demo.app.setBalance(ME.id, 10);
  const { page } = await open({ path: `/#/case/${noob.id}` });
  await page.waitForSelector('[data-act="open"]');
  await page.click('[data-act="open"]');
  // tapping Back during the spin is ignored
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__tgBack && window.__tgBack());
  await page.click('.view-head .back');
  await page.waitForSelector('.result', { timeout: 9000 });
  assert.ok(page.url().includes(`#/case/${noob.id}`), 'still on the case page');
  await page.click('[data-act="sell-won"]');
  await page.waitForSelector('.toast.ok');
  const bal = num(await page.textContent('#bal'));
  const btn = page.locator('#openRow .btn');
  assert.equal(await btn.isDisabled(), bal < 10, `balance ${bal}`);
  await demo.app.setBalance(ME.id, 1250);
  await page.context().close();
});

test('theme saved on the server is used on a new device', { skip }, async () => {
  await demo.app.post('/api/prefs', { user: ME, body: { theme: 'mint' } });
  const { page } = await open();
  await page.waitForSelector('.case-grid');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'mint');
  await demo.app.post('/api/prefs', { user: ME, body: { theme: 'sunset' } });
  await page.context().close();
});

test('not enough coins disables the button', { skip }, async () => {
  const { page } = await open({ path: `/#/case/${demo.bySlug.griffin.id}` });
  await page.waitForSelector('#openRow .btn');
  assert.equal(await page.isDisabled('#openRow .btn'), true);
  assert.equal(await page.textContent('#openRow .btn'), 'Недостаточно монет');
  await page.context().close();
});

test('free case: share via Telegram, open, then cooldown', { skip }, async () => {
  const { page, errors } = await open({ path: `/#/case/${demo.bySlug.free.id}` });
  await page.waitForSelector('.tasks');
  assert.equal(await page.isDisabled('[data-act="open"]'), true);
  assert.match(await page.textContent('.task-text'), /Скинь ссылку на бота в любой чат/);
  await page.click('[data-act="share"]');
  await page.waitForSelector('.task.done');
  const calls = await page.evaluate(() => window.__tgCalls.filter((c) => c[0] === 'shareMessage'));
  assert.deepEqual(calls, [['shareMessage', `prep_${ME.id}`]]);
  assert.equal(await page.isDisabled('[data-act="open"]'), false);
  await page.click('[data-act="open"]');
  await page.waitForSelector('.result', { timeout: 9000 });
  await page.click('.result [data-act="close-modal"]');
  await page.waitForSelector('#cooldown');
  assert.match(await page.textContent('#cooldown'), /Следующий бесплатный кейс через 2[34]:\d\d:\d\d/);
  await page.evaluate(() => (location.hash = '#/cases'));
  await page.waitForSelector('#freeState');
  assert.match(await page.textContent('#freeState'), /^Через \d\d:\d\d:\d\d$/);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('upgrader: chance matches the formula and the result matches the server', { skip }, async () => {
  const { page, errors } = await open({ path: '/#/upgrade' });
  await page.waitForSelector('[data-act="up-pick"]');
  await page.click('[data-act="up-pick"] >> nth=0');
  const betText = await page.textContent('#upSlots .slot:first-child .slot-val');
  const bet = num(betText);
  await page.click('[data-act="up-tab"][data-v="targets"]');
  await page.click('[data-act="up-target"] >> nth=0');
  const target = num(await page.textContent('#upSlots .slot:last-child .slot-val'));
  const expected = Math.min(80, Math.floor((bet / target) * 90 * 100) / 100);
  const shown = Number((await page.textContent('#gPct')).replace('%', '').replace(',', '.').replace(/\s/g, ''));
  assert.equal(shown, expected);
  const invBefore = (await demo.app.get('/api/inventory', { user: ME })).body.inventory.length;
  await page.click('#upBtn');
  await page.waitForSelector('.result', { timeout: 9000 });
  const title = await page.textContent('.result-title');
  const last = await demo.ctx.db.one('SELECT won FROM bs_upgrades WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [ME.id]);
  assert.equal(title, last.won ? 'Успех!' : 'Не повезло');
  const invAfter = (await demo.app.get('/api/inventory', { user: ME })).body.inventory.length;
  assert.equal(invAfter, invBefore - 1 + (last.won ? 1 : 0));
  await page.click('.result [data-act="close-modal"]');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-act="up-pick"]').count(), invAfter);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('promo code from the balance button', { skip }, async () => {
  const { page } = await open();
  await page.waitForSelector('.case-grid');
  const before = num(await page.textContent('#bal'));
  await page.click('[data-act="promo"]');
  await page.fill('#promoInput', 'brainrot100');
  await page.click('#promoForm button');
  await page.waitForSelector('.toast.ok');
  assert.equal(num(await page.textContent('#bal')), before + 100);
  await page.click('[data-act="promo"]');
  await page.fill('#promoInput', 'brainrot100');
  await page.click('#promoForm button');
  await page.waitForSelector('.toast.error');
  assert.match(await page.textContent('.toast.error'), /Ты уже активировал этот промокод/);
  await page.context().close();
});

test('language switch: UA and EN texts, saved on the server', { skip }, async () => {
  const { page } = await open();
  await page.waitForSelector('.case-grid');
  await page.click('#langBtn');
  await page.click('[data-lang="en"]');
  await page.waitForSelector('.case-grid');
  assert.deepEqual(await page.locator('#tabbar span').allTextContents(), ['Cases', 'Upgrader', 'Profile', 'Admin']);
  assert.equal(await page.textContent('.case-name >> nth=0'), 'Noob case');
  assert.equal(await page.textContent('.live-title span'), 'Live drops');
  await page.waitForTimeout(300);
  assert.equal((await apiMe()).me.lang, 'en');
  await page.click('#langBtn');
  await page.click('[data-lang="uk"]');
  await page.waitForSelector('.case-grid');
  assert.deepEqual(await page.locator('#tabbar span').allTextContents(), ['Кейси', 'Апгрейдер', 'Профіль', 'Адмін']);
  assert.equal(await page.textContent('.case-name >> nth=2'), 'Рибний кейс');
  assert.equal(await page.textContent('#langBtn'), 'UA');
  await page.click('#langBtn');
  await page.click('[data-lang="ru"]');
  await page.waitForTimeout(300);
  assert.equal((await apiMe()).me.lang, 'ru');
  await page.context().close();
});

test('theme switch: 6 colours, applied instantly and saved', { skip }, async () => {
  const { page } = await open();
  await page.waitForSelector('.case-grid');
  await page.click('#themeBtn');
  assert.equal(await page.locator('.swatch').count(), 6);
  assert.deepEqual(await page.locator('.swatch span').allTextContents(), ['Жёлто-оранжевый', 'Серо-чёрный', 'Зелёно-синий', 'Красно-синий', 'Фиолетово-розовый', 'Океан']);
  await page.click('[data-theme="redblue"]');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--a1').trim()), '#FF4D6D');
  const header = await page.evaluate(() => window.__tgCalls.filter((c) => c[0] === 'setHeaderColor').at(-1));
  assert.deepEqual(header, ['setHeaderColor', '#070a1c']);
  await page.waitForTimeout(300);
  assert.equal((await apiMe()).me.theme, 'redblue');
  await page.click('[data-theme="sunset"]');
  await page.waitForTimeout(300);
  await page.context().close();
});

test('profile shows the same stats as the server', { skip }, async () => {
  const { page } = await open({ path: '/#/profile' });
  await page.waitForSelector('.stats');
  const s = (await apiMe()).stats;
  const vals = await page.locator('.stats .s-val').allTextContents();
  assert.equal(num(vals[0]), s.casesOpened);
  assert.equal(num(vals[1]), s.totalWon);
  assert.equal(await page.textContent('.best-name'), s.bestDrop.name);
  assert.equal(await page.locator('.grid.items .item').count(), s.inventoryCount);
  await page.context().close();
});

test('live feed updates when someone else opens a case', { skip }, async () => {
  const { page } = await open();
  await page.waitForSelector('#feed .drop');
  await page.waitForTimeout(500);
  const other = demo.others[4];
  await demo.app.post(`/api/case/${demo.bySlug.summer.id}/open`, { user: other });
  await page.waitForFunction((n) => document.querySelector('#feed .drop .drop-user')?.textContent === n, other.first_name, { timeout: 5000 });
  await page.context().close();
});

test('admin: edit a case price from the panel and players see it', { skip }, async () => {
  const { page, errors } = await open({ path: `/#/admin/cases/${demo.bySlug.pro.id}` });
  await page.waitForSelector('#caseForm');
  await page.fill('#cPrice', '30');
  const rtp = await page.textContent('#lootSum');
  assert.match(rtp, /75%/, 'return recalculated live (22.5 / 30)');
  await page.click('#caseForm button[type=submit]');
  await page.waitForSelector('.toast.ok');
  const pub = (await demo.app.get('/api/catalog', { user: demo.others[0] })).body.cases.find((c) => c.slug === 'pro');
  assert.equal(pub.price, 30);
  await page.evaluate(() => (location.hash = '#/cases'));
  await page.waitForSelector('.case-grid');
  assert.equal(num(await page.textContent('.case-price >> nth=1')), 30);
  // restore
  await page.evaluate((id) => (location.hash = '#/admin/cases/' + id), demo.bySlug.pro.id);
  await page.waitForSelector('#caseForm');
  await page.fill('#cPrice', '25');
  await page.click('#caseForm button[type=submit]');
  await page.waitForSelector('.toast.ok');
  // every admin section renders
  for (const s of ['overview', 'items', 'users', 'promos', 'settings', 'broadcast']) {
    await page.evaluate((x) => (location.hash = '#/admin/' + x), s);
    await page.waitForSelector('#admBody > :not(.spinner)');
  }
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('admin: case picture upload shows on the case card, removal brings the chest back', { skip }, async () => {
  const id = demo.bySlug.summer.id;
  const { page, errors } = await open({ path: `/#/admin/cases/${id}` });
  await page.waitForSelector('#caseForm #cImgRow');
  assert.equal(await page.$('#cImgDel'), null, 'nothing to remove yet');
  // unsaved edit in the form must survive the upload
  await page.fill('#cPrice', '351');
  const jpg = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1360;
    c.height = 1157;
    const g = c.getContext('2d');
    g.fillStyle = '#1d6b3a';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#ffd23f';
    g.fillRect(300, 250, 700, 600);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  await page.setInputFiles('#cImgFile', { name: 'summer.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpg, 'base64') });
  await page.waitForSelector('#cImgDel');
  await page.waitForSelector('#cPreview img.case-img');
  assert.equal(await page.inputValue('#cPrice'), '351', 'form edits kept');
  const adm = (await demo.app.get('/api/admin/cases', { user: ME })).body.cases.find((c) => c.id === id);
  assert.match(adm.image, /^\/api\/img\/case\//);
  assert.equal(adm.price, 350, 'price not saved by the upload');
  // stored picture is downscaled to 512px
  const size = await page.evaluate(async (src) => {
    const im = new Image();
    im.src = src;
    await im.decode();
    return [im.naturalWidth, im.naturalHeight];
  }, await page.getAttribute('#cPreview img.case-img', 'src'));
  assert.deepEqual(size, [512, 436]);

  // players see the picture instead of the chest
  await page.evaluate(() => (location.hash = '#/cases'));
  await page.waitForSelector('.case-grid');
  const card = page.locator(`.case-card[data-case="${id}"]`);
  assert.equal(await card.locator('img.case-img').count(), 1);
  assert.equal(await card.locator('svg.chest').count(), 0);
  const box = await card.locator('img.case-img').boundingBox();
  const cardBox = await card.boundingBox();
  assert.ok(box.width > cardBox.width * 0.7 && box.width <= cardBox.width, `picture fills the card (${box.width} of ${cardBox.width})`);
  assert.ok(await card.locator('img.case-img').evaluate((im) => im.complete && im.naturalWidth > 0), 'picture loaded');
  // other cases keep the chest
  assert.equal(await page.locator(`.case-card[data-case="${demo.bySlug.noob.id}"] svg.chest`).count(), 1);

  // remove it again
  await page.evaluate((x) => (location.hash = '#/admin/cases/' + x), id);
  await page.waitForSelector('#cImgDel');
  await page.click('#cImgDel');
  await page.waitForSelector('#cPreview svg.chest');
  assert.equal((await demo.app.get('/api/admin/cases', { user: ME })).body.cases.find((c) => c.id === id).image, null);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('non-admins have no admin tab and cannot open it', { skip }, async () => {
  const { page } = await open({ user: demo.others[1], path: '/#/admin/cases' });
  await page.waitForSelector('.case-grid');
  assert.deepEqual(await page.locator('#tabbar span').allTextContents(), ['Кейсы', 'Апгрейдер', 'Профиль']);
  await page.context().close();
});

test('website mode: login link works outside Telegram and is removed from the URL', { skip }, async () => {
  const u = await demo.ctx.db.one('SELECT id, web_ver FROM bs_users WHERE id = $1', [ME.id]);
  const token = signWebToken(u.id, u.web_ver, demo.ctx.config.sessionSecret);
  const { page } = await open({ stub: false, path: `/?login=${token}`, width: 1280, height: 860 });
  await page.waitForSelector('.case-grid');
  assert.ok(!page.url().includes('login='));
  assert.equal(await page.textContent('.brand-name'), 'BrainrotSpin');
  const box = await page.locator('#app').boundingBox();
  assert.ok(box.width <= 560 && box.x > 300, 'centred column on desktop');
  await page.reload();
  await page.waitForSelector('.case-grid'); // token kept in localStorage
  await page.context().close();

  const anon = await open({ stub: false });
  await anon.page.waitForSelector('.splash a.btn');
  assert.equal(await anon.page.getAttribute('.splash a.btn', 'href'), 'https://t.me/BrainrotSpin_Bot');
  assert.equal(await anon.page.textContent('.splash-name'), 'BrainrotSpin');
  await anon.page.context().close();
});

test('small phones (360px): no horizontal scrolling anywhere', { skip }, async () => {
  // the biggest possible top drop must still fit its card
  const top = [...demo.ctx.game.catalog.items.values()].find((i) => i.name === 'Strawberry Elephant');
  await demo.ctx.db.query("INSERT INTO bs_drops (user_id, item_id, value, kind) VALUES ($1, $2, $3, 'case')", [demo.others[9].id, top.id, top.value]);
  await demo.ctx.live.refreshTop();
  const { page } = await open({ width: 360, height: 740 });
  await page.waitForSelector('.case-grid');
  assert.match(await page.textContent('.top24-val'), /50\s000/);
  const fits = await page.evaluate(() => {
    const card = document.querySelector('.top24').getBoundingClientRect();
    const val = document.querySelector('.top24-val').getBoundingClientRect();
    return val.right <= card.right - 4;
  });
  assert.ok(fits, 'top drop value fits inside the card');
  for (const h of ['#/cases', `#/case/${demo.bySlug.dragon.id}`, `#/case/${demo.bySlug.free.id}`, '#/upgrade', '#/profile', '#/admin/cases', `#/admin/cases/${demo.bySlug.noob.id}`, '#/admin/users', '#/admin/settings']) {
    await page.evaluate((x) => (location.hash = x), h);
    await page.waitForTimeout(500);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.equal(over, 0, `${h} overflows by ${over}px`);
  }
  await page.context().close();
});

test('no console errors in any UI test', { skip }, () => {
  assert.deepEqual(allErrors.flat(), []);
});
