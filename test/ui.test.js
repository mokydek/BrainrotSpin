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
  demo = await startDemo({ dbName: 'bs_t_ui', env: { OWNER_USERNAMES: 'owner_ui' } });
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

test('opening a case x3: three strips, one charge of 3 × price, all drops shown', { skip }, async () => {
  await demo.app.setBalance(ME.id, 250); // enough for one x3 only
  const { page, errors } = await open();
  await page.waitForSelector('.case-grid');
  const fish = demo.bySlug.fish; // 65
  await page.click(`[data-case="${fish.id}"]`);
  await page.waitForSelector('#countSeg');
  assert.deepEqual(await page.locator('#countSeg button').allTextContents(), ['x1', 'x2', 'x3', 'x5']);
  assert.equal(await page.isDisabled('[data-act="count"][data-n="5"]'), true, '5 × 65 > 250');
  assert.equal(await page.locator('#roulettes .roulette').count(), 1);
  const before = num(await page.textContent('#bal'));
  await page.click('[data-act="count"][data-n="3"]');
  assert.equal(await page.locator('#roulettes .roulette').count(), 3);
  assert.equal(num(await page.textContent('[data-act="open"]')), 195);
  const invBefore = (await demo.app.get('/api/inventory', { user: ME })).body.inventory.length;
  await page.click('[data-act="open"]');
  await page.waitForFunction((b) => Number(document.querySelector('#bal').textContent.replace(/\D/g, '')) === b - 195, before);
  await page.waitForSelector('.result.multi', { timeout: 10000 });
  await page.waitForTimeout(300);
  // the strips keep showing the drops even though x3 is no longer affordable
  assert.equal(await page.locator('#roulettes .roulette').count(), 3);
  assert.equal(await page.locator('#roulettes .r-tile.win').count(), 3);
  const names = await page.locator('.result-items .item-name').allTextContents();
  assert.equal(names.length, 3);
  const inv = (await demo.app.get('/api/inventory', { user: ME })).body.inventory;
  assert.equal(inv.length, invBefore + 3);
  assert.deepEqual(inv.slice(0, 3).map((i) => i.item.name).sort(), [...names].sort(), 'shown items are the ones the server gave');
  // every strip stopped on its own drop
  const wins = await page.locator('#roulettes .r-tile.win .r-name').allTextContents();
  assert.deepEqual([...wins].sort(), [...names].sort());
  const total = inv.slice(0, 3).reduce((s, i) => s + i.item.value, 0);
  assert.equal(num(await page.textContent('.result.multi [data-act="sell-won"]')), total);
  await page.click('.result.multi [data-act="sell-won"]');
  await page.waitForSelector('.toast.ok');
  assert.equal(num(await page.textContent('#bal')), before - 195 + total);
  assert.equal((await demo.app.get('/api/inventory', { user: ME })).body.inventory.length, invBefore);
  // not enough for x3 any more -> that option is disabled and fewer strips are shown
  await demo.app.setBalance(ME.id, 140);
  await page.evaluate(() => (location.hash = '#/cases'));
  await page.reload();
  await page.waitForSelector('.case-grid');
  await page.click(`[data-case="${fish.id}"]`);
  await page.waitForSelector('#countSeg');
  assert.equal(await page.isDisabled('[data-act="count"][data-n="3"]'), true);
  assert.equal(await page.isDisabled('[data-act="count"][data-n="2"]'), false);
  await page.click('[data-act="count"][data-n="2"]');
  assert.equal(await page.locator('#roulettes .roulette').count(), 2);
  await page.click('[data-act="count"][data-n="1"]');
  assert.equal(await page.locator('#roulettes .roulette').count(), 1);
  await demo.app.setBalance(ME.id, 1250);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('opening a case x5: five strips, 5 × price, five drops', { skip }, async () => {
  const fish = demo.bySlug.fish; // 65
  await demo.app.setBalance(ME.id, 300); // x5 = 325 is too much, x3 = 195 is fine
  const { page, errors } = await open({ path: `/#/case/${fish.id}` });
  await page.waitForSelector('#countSeg');
  assert.equal(await page.isDisabled('[data-act="count"][data-n="5"]'), true);
  await demo.app.setBalance(ME.id, 400);
  await page.reload();
  await page.waitForSelector('#countSeg');
  await page.click('[data-act="count"][data-n="5"]');
  assert.equal(await page.locator('#roulettes .roulette').count(), 5);
  assert.equal(num(await page.textContent('[data-act="open"]')), 325);
  // all five strips fit on a phone screen together with the Open button
  const fits = await page.evaluate(() => {
    const r = [...document.querySelectorAll('#roulettes .roulette')].map((e) => e.getBoundingClientRect());
    const b = document.querySelector('[data-act="open"]').getBoundingClientRect();
    return b.bottom - r[0].top <= innerHeight - 60 && r.every((x) => x.width > 300);
  });
  assert.ok(fits, 'strips + button fit in one screen');
  const invBefore = (await demo.app.get('/api/inventory', { user: ME })).body.inventory.length;
  await page.click('[data-act="open"]');
  await page.waitForFunction(() => Number(document.querySelector('#bal').textContent.replace(/\D/g, '')) === 75);
  await page.waitForSelector('.result.multi', { timeout: 10000 });
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#roulettes .r-tile.win').count(), 5);
  const names = await page.locator('.result-items .item-name').allTextContents();
  assert.equal(names.length, 5);
  const inv = (await demo.app.get('/api/inventory', { user: ME })).body.inventory;
  assert.equal(inv.length, invBefore + 5);
  assert.deepEqual(inv.slice(0, 5).map((i) => i.item.name).sort(), [...names].sort());
  const wins = await page.locator('#roulettes .r-tile.win .r-name').allTextContents();
  assert.deepEqual([...wins].sort(), [...names].sort(), 'every strip stopped on its own drop');
  await page.click('.result.multi [data-act="close-modal"]');
  await page.waitForTimeout(300);
  // 75 left: x5 / x3 / x2 are out of reach, the case falls back to x1
  assert.equal(await page.locator('#countSeg button.on').textContent(), 'x1');
  for (const n of [2, 3, 5]) assert.equal(await page.isDisabled(`[data-act="count"][data-n="${n}"]`), true, `x${n} disabled`);
  assert.equal(num(await page.textContent('[data-act="open"]')), 65);
  await demo.app.setBalance(ME.id, 1250);
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
  // 1.3 times lower than bet / target * 90, and the app shows exactly that
  const expected = Math.floor((Math.min(80, (bet / target) * 90) / 1.3) * 100) / 100;
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

test('upgrader: 75% / 50% / 30% buttons pick the target with the closest chance', { skip }, async () => {
  const { page, errors } = await open({ path: '/#/upgrade' });
  await page.waitForSelector('#upPcts button');
  // bad luck 1.3: the highest chance is 80 / 1.3 = 61%, so there is no 75% button
  assert.deepEqual(await page.locator('#upPcts button').allTextContents(), ['50%', '30%']);
  assert.equal(await page.isDisabled('#upRange'), true, 'slider is off until items are picked');
  await page.click('[data-act="up-pct"][data-p="50"]');
  await page.waitForSelector('.toast');
  assert.equal(await page.textContent('.toast'), 'Выбери предметы');
  await page.click('[data-act="up-pick"] >> nth=0');
  const bet = num(await page.textContent('#upSlots .slot:first-child .slot-val'));
  const { items, upgrade } = (await demo.app.get('/api/catalog', { user: ME })).body;
  assert.equal(upgrade.luck, 1.3);
  const formula = (b, v) => Math.floor((Math.min(upgrade.maxChance, (b / v) * (100 - upgrade.edge)) / upgrade.luck) * 100) / 100;
  const chanceOf = (v) => formula(bet, v);
  const candidates = items.filter((i) => i.value > bet && chanceOf(i.value) >= upgrade.minChance);
  const gauge = async () => Number((await page.textContent('#gPct')).replace('%', '').replace(',', '.').replace(/\s/g, ''));
  for (const p of [50, 30]) {
    await page.click(`[data-act="up-pct"][data-p="${p}"]`);
    const target = num(await page.textContent('#upSlots .slot:last-child .slot-val'));
    const shown = await gauge();
    assert.equal(shown, chanceOf(target));
    const bestDiff = Math.min(...candidates.map((i) => Math.abs(chanceOf(i.value) - p)));
    assert.ok(Math.abs(Math.abs(shown - p) - bestDiff) < 1e-9, `${p}%: picked ${shown}%, best possible diff ${bestDiff}`);
    assert.equal(await page.getAttribute(`[data-act="up-pct"][data-p="${p}"]`, 'class'), 'on');
    assert.equal(await page.isDisabled('#upBtn'), false);
    assert.equal(await page.inputValue('#upRange'), String(p), 'slider follows the button');
  }
  // the slider: any percentage between min and max chance picks the closest target
  const { min, max } = await page.$eval('#upRange', (el) => ({ min: Number(el.min), max: Number(el.max) }));
  assert.deepEqual({ min, max }, { min: Math.max(1, Math.ceil(upgrade.minChance)), max: Math.floor(upgrade.maxChance / upgrade.luck) });
  assert.equal(max, 61);
  for (const v of [12, 58, 41]) {
    await page.$eval('#upRange', (el, x) => {
      el.value = String(x);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
    const target = num(await page.textContent('#upSlots .slot:last-child .slot-val'));
    const shown = await gauge();
    assert.equal(shown, chanceOf(target));
    const bestDiff = Math.min(...candidates.map((i) => Math.abs(chanceOf(i.value) - v)));
    assert.ok(Math.abs(Math.abs(shown - v) - bestDiff) < 1e-9, `${v}%: picked ${shown}%, best possible diff ${bestDiff}`);
    assert.equal(await page.textContent('#upRangeVal'), `${v}%`);
    assert.equal(await page.locator('#upPcts button.on').count(), 0);
  }
  // dragging it with the mouse/finger works too
  const box = await page.locator('#upRange').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 30, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  assert.equal(await page.inputValue('#upRange'), String(max));
  assert.equal(await page.textContent('#upRangeVal'), `${max}%`);
  {
    const shown = await gauge();
    const bestDiff = Math.min(...candidates.map((i) => Math.abs(chanceOf(i.value) - max)));
    assert.ok(Math.abs(Math.abs(shown - max) - bestDiff) < 1e-9, `dragged to ${max}%: picked ${shown}%`);
  }
  await page.click('[data-act="up-pct"][data-p="30"]');
  // adding an item re-picks the target for the same percentage
  if ((await page.locator('[data-act="up-pick"]').count()) > 1) {
    await page.click('[data-act="up-tab"][data-v="inv"]');
    await page.click('[data-act="up-pick"] >> nth=1');
    const bet2 = num(await page.textContent('#upSlots .slot:first-child .slot-val'));
    const t2 = num(await page.textContent('#upSlots .slot:last-child .slot-val'));
    assert.ok(t2 > bet2);
    assert.equal(await page.getAttribute('[data-act="up-pct"][data-p="30"]', 'class'), 'on');
  }
  // the bet changes elsewhere (an item sold in the profile): the same percentage picks again
  await page.click('[data-act="up-tab"][data-v="inv"]');
  const selected = await page.$$eval('[data-act="up-pick"].sel', (els) => els.map((e) => Number(e.dataset.inv)));
  if (selected.length > 1) {
    await page.evaluate(() => (location.hash = '#/profile'));
    await page.waitForSelector(`[data-act="sell"][data-inv="${selected[1]}"]`);
    await page.click(`[data-act="sell"][data-inv="${selected[1]}"]`);
    await page.waitForFunction((id) => !document.querySelector(`[data-act="sell"][data-inv="${id}"]`), selected[1]);
    await page.evaluate(() => (location.hash = '#/upgrade'));
    await page.waitForSelector('#upPcts button');
    const bet3 = num(await page.textContent('#upSlots .slot:first-child .slot-val'));
    const t3 = num(await page.textContent('#upSlots .slot:last-child .slot-val'));
    const ch = (v) => formula(bet3, v);
    const cands = items.filter((i) => i.value > bet3 && ch(i.value) >= upgrade.minChance);
    const best = Math.min(...cands.map((i) => Math.abs(ch(i.value) - 30)));
    assert.ok(Math.abs(Math.abs(ch(t3) - 30) - best) < 1e-9, 'target re-picked for 30% with the new bet');
    assert.equal(await gauge(), ch(t3));
    assert.equal(await page.getAttribute('[data-act="up-pct"][data-p="30"]', 'class'), 'on');
  }
  // picking a target by hand drops the percentage highlight
  await page.click('[data-act="up-tab"][data-v="targets"]');
  await page.click('[data-act="up-target"] >> nth=0');
  assert.equal(await page.locator('#upPcts button.on').count(), 0);
  // without bad luck all three buttons are there again
  await demo.ctx.settings.update({ upgrade_luck: 1 });
  await page.reload();
  await page.waitForSelector('#upPcts button');
  assert.deepEqual(await page.locator('#upPcts button').allTextContents(), ['75%', '50%', '30%']);
  assert.equal(await page.getAttribute('#upRange', 'max'), '80');
  await demo.ctx.settings.update({ upgrade_luck: 1.3 });
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('upgrader: the chance on screen is the one the server rolls; a changed chance is shown before a new try', { skip }, async () => {
  const give = async (name) => {
    const it = [...demo.ctx.game.catalog.items.values()].find((i) => i.name === name);
    return (await demo.ctx.db.one("INSERT INTO bs_inventory (user_id, item_id, source) VALUES ($1, $2, 'test') RETURNING id", [ME.id, it.id])).id;
  };
  const inv = await give('Chimpanzini Bananini'); // 30
  const spooky = [...demo.ctx.game.catalog.items.values()].find((i) => i.name === 'Spooky and Pumpky'); // 200
  const { page, errors } = await open({ path: '/#/upgrade' });
  await page.waitForSelector(`[data-act="up-pick"][data-inv="${inv}"]`);
  await page.click(`[data-act="up-pick"][data-inv="${inv}"]`);
  await page.click('[data-act="up-tab"][data-v="targets"]');
  await page.click(`[data-act="up-target"][data-id="${spooky.id}"]`);
  const gauge = async () => Number((await page.textContent('#gPct')).replace('%', '').replace(',', '.').replace(/\s/g, ''));
  // 30 / 200 * 90 = 13.5%, 1.3 times lower = 10.38%
  assert.equal(await gauge(), 10.38);
  // the main admin changes the bad luck while the player looks at the old chance
  await demo.ctx.settings.update({ upgrade_luck: 2 });
  const upsBefore = (await demo.ctx.db.one('SELECT count(*)::int AS n FROM bs_upgrades WHERE user_id = $1', [ME.id])).n;
  await page.click('#upBtn');
  await page.waitForSelector('.toast.error');
  assert.equal(await page.textContent('.toast.error'), 'Шанс изменился — проверь и попробуй ещё раз');
  await page.waitForFunction(() => document.querySelector('#gPct').textContent.replace(/\s/g, '') === '6,75%');
  assert.equal((await demo.ctx.db.one('SELECT count(*)::int AS n FROM bs_upgrades WHERE user_id = $1', [ME.id])).n, upsBefore, 'nothing rolled');
  assert.ok(await page.$(`[data-act="up-target"][data-id="${spooky.id}"].sel`), 'the target is still picked');
  assert.equal(num(await page.textContent('#upSlots .slot:first-child .slot-val')), 30, 'and the bet too');
  // the next try uses the new chance; the server rolls with exactly what was shown
  await page.click('#upBtn');
  await page.waitForSelector('.result', { timeout: 9000 });
  const last = await demo.ctx.db.one('SELECT chance FROM bs_upgrades WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [ME.id]);
  assert.equal(Number(last.chance), 6.75);
  await page.click('.result [data-act="close-modal"]');
  await demo.ctx.settings.update({ upgrade_luck: 1.3 });
  assert.deepEqual(errors.filter((e) => !/status of 409/.test(e)), []);
  await page.context().close();
});

test('live drops: hovering a tile shows the case or the upgrader it came from (tap on phones)', { skip }, async () => {
  const items = [...demo.ctx.game.catalog.items.values()];
  const it = items.find((i) => i.name === 'Spooky and Pumpky');
  demo.ctx.live.pushDrop(
    { id: 9000001, at: new Date().toISOString(), kind: 'upgrade', value: it.value, item: demo.ctx.game.publicItem(it), user: { name: 'Апгрейдер-тест' }, caseId: null },
    0,
  );
  const visible = (loc) => loc.evaluate((el) => getComputedStyle(el).opacity === '1');
  const caseOf = (id) => demo.ctx.game.catalog.cases.get(id);
  const { feed } = (await demo.app.get('/api/feed')).body;
  const caseDrop = feed.find((d) => d.kind === 'case' && d.caseId);
  assert.ok(caseDrop, 'the demo feed has case drops');

  // computer with a mouse: hover
  {
    const { page, errors } = await open({ width: 1280, height: 860, touch: false });
    await page.waitForSelector('#feed .drop');
    assert.equal(await page.evaluate(() => matchMedia('(hover: hover)').matches), true);
    const tiles = page.locator('#feed .drop');
    const n = await tiles.count();
    const kinds = await tiles.evaluateAll((els) => els.map((e) => e.dataset.src));
    // every tile carries its source, hidden until hovered
    for (let i = 0; i < n; i++) assert.equal(await visible(tiles.nth(i).locator('.drop-src')), false);
    const up = tiles.nth(kinds.indexOf('upgrade'));
    await up.hover();
    await page.waitForTimeout(300);
    assert.equal(await visible(up.locator('.drop-src')), true);
    assert.equal(await up.locator('.src-name').textContent(), 'Апгрейдер');
    assert.equal(await up.locator('.src-art svg').count(), 1);
    // a case drop: that very case, by name
    const feedNow = (await demo.app.get('/api/feed')).body.feed.slice(0, n);
    const ci = feedNow.findIndex((d) => d.kind === 'case');
    const tile = tiles.nth(ci);
    await tile.hover();
    await page.waitForTimeout(300);
    assert.equal(await visible(tile.locator('.drop-src')), true);
    assert.equal(await tile.locator('.src-name').textContent(), caseOf(feedNow[ci].caseId).name_ru);
    assert.equal(await visible(up.locator('.drop-src')), false, 'the previous tile went back');
    // moving away restores the drop
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
    assert.equal(await visible(tile.locator('.drop-src')), false);
    // the top drop of the day too
    const top = (await demo.app.get('/api/feed')).body.top24;
    await page.hover('#top24');
    await page.waitForTimeout(300);
    assert.equal(await visible(page.locator('#top24 .drop-src')), true);
    assert.equal(
      await page.textContent('#top24 .src-name'),
      top.kind === 'upgrade' ? 'Апгрейдер' : caseOf(top.caseId).name_ru,
    );
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  // phone: a tap shows it, another tap hides it; nothing else happens
  {
    const { page, errors } = await open();
    await page.waitForSelector('#feed .drop');
    assert.equal(await page.evaluate(() => matchMedia('(hover: none)').matches), true);
    const tile = page.locator('#feed .drop').first();
    await tile.tap();
    await page.waitForTimeout(300);
    assert.equal(await visible(tile.locator('.drop-src')), true);
    assert.equal(await tile.locator('.src-name').textContent(), 'Апгрейдер');
    assert.equal(new URL(page.url()).hash, '', 'stays on the main screen');
    const second = page.locator('#feed .drop').nth(1);
    await second.tap();
    await page.waitForTimeout(300);
    assert.equal(await visible(tile.locator('.drop-src')), false, 'one at a time');
    assert.equal(await visible(second.locator('.drop-src')), true);
    await second.tap();
    await page.waitForTimeout(300);
    assert.equal(await visible(second.locator('.drop-src')), false);
    assert.deepEqual(errors, []);
    await page.context().close();
  }
});

test('promo code from the balance button', { skip }, async () => {
  const { page } = await open();
  await page.waitForSelector('.case-grid');
  const before = num(await page.textContent('#bal'));
  await page.click('[data-act="topup"]');
  await page.click('.topup [data-act="promo"]');
  await page.fill('#promoInput', 'brainrot100');
  await page.click('#promoForm button');
  await page.waitForSelector('.toast.ok');
  assert.equal(num(await page.textContent('#bal')), before + 100);
  await page.click('[data-act="topup"]');
  await page.click('.topup [data-act="promo"]');
  await page.fill('#promoInput', 'brainrot100');
  await page.click('#promoForm button');
  await page.waitForSelector('.toast.error');
  assert.match(await page.textContent('.toast.error'), /Ты уже активировал этот промокод/);
  await page.context().close();
});

test('top-up menu: Stars, brainrots and promo code', { skip }, async () => {
  const { page, errors } = await open();
  await page.waitForSelector('.case-grid');
  await page.click('[data-act="topup"]');
  await page.waitForSelector('.topup .tu-opts');
  assert.equal(await page.textContent('.topup .sheet-title'), 'Пополнение');
  assert.deepEqual(await page.locator('.tu-opt b').allTextContents(), ['Звёзды', 'Брейнроты']);
  assert.equal(await page.textContent('.tu-promo'), 'Промокод');
  await page.click('[data-act="tu-brainrots"]');
  await page.waitForSelector('#depForm');
  await page.click('[data-act="tu-menu"]');
  await page.waitForSelector('.tu-opts');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('top-up with Telegram Stars: invoice opens, payment is credited', { skip }, async () => {
  const { page, errors } = await open();
  await page.waitForSelector('.case-grid');
  const before = num(await page.textContent('#bal'));
  await page.click('[data-act="topup"]');
  await page.click('[data-act="tu-stars"]');
  await page.waitForSelector('#starsForm');
  assert.equal(num(await page.textContent('#starsGet')), 100, 'default 100 stars at rate 1');
  await page.fill('#starsInput', '0');
  assert.equal(await page.isDisabled('#starsPay'), true);
  await page.fill('#starsInput', '40');
  assert.equal(num(await page.textContent('#starsGet')), 40);
  assert.equal(num(await page.textContent('#starsPay')), 40);
  demo.app.tg.reset();
  await page.click('#starsPay');
  await page.waitForFunction(() => window.__tgCalls.some((c) => c[0] === 'openInvoice'));
  const link = await page.evaluate(() => window.__tgCalls.find((c) => c[0] === 'openInvoice')[1]);
  assert.match(link, /^https:\/\/t\.me\/\$inv_/);
  const inv = demo.app.tg.calls('createInvoiceLink')[0].payload;
  assert.deepEqual(inv.prices, [{ label: '40 монет', amount: 40 }]);
  // Telegram: pre-checkout, then the payment message, then the Mini App callback
  await demo.app.sendUpdate({ pre_checkout_query: { id: 'pq1', from: { is_bot: false, ...ME }, currency: 'XTR', total_amount: 40, invoice_payload: inv.payload } });
  assert.equal(demo.app.tg.calls('answerPreCheckoutQuery')[0].payload.ok, true);
  await demo.app.sendUpdate({
    message: {
      message_id: 501, date: 0, chat: { id: ME.id, type: 'private' }, from: { is_bot: false, ...ME },
      successful_payment: { currency: 'XTR', total_amount: 40, invoice_payload: inv.payload, telegram_payment_charge_id: 'ui-charge-1', provider_payment_charge_id: '' },
    },
  });
  await page.evaluate(() => window.__invoiceCb('paid'));
  await page.waitForSelector('.toast.ok');
  assert.match(await page.textContent('.toast.ok'), /Баланс пополнен: \+40/);
  await page.waitForFunction((b) => Number(document.querySelector('#bal').textContent.replace(/\D/g, '')) === b + 40, before);
  await page.waitForSelector('.modal-wrap', { state: 'detached' }); // sheet closed
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('website mode: Stars invoice opens as a Telegram link and the balance updates by itself', { skip }, async () => {
  const u = await demo.ctx.db.one('SELECT id, web_ver FROM bs_users WHERE id = $1', [ME.id]);
  const token = signWebToken(u.id, u.web_ver, demo.ctx.config.sessionSecret);
  const { page, context, errors } = await open({ stub: false, path: `/?login=${token}` });
  await context.route('https://t.me/**', (r) => r.fulfill({ contentType: 'text/html', body: '<title>Telegram</title>' }));
  await page.waitForSelector('.case-grid');
  const before = num(await page.textContent('#bal'));
  await page.click('[data-act="topup"]');
  await page.click('[data-act="tu-stars"]');
  await page.fill('#starsInput', '15');
  await page.click('#starsPay');
  await page.waitForSelector('#starsLink');
  // changing the amount drops the link made for the old amount
  await page.fill('#starsInput', '500');
  await page.waitForSelector('#starsPay');
  assert.equal(await page.locator('#starsLink').count(), 0);
  assert.equal(num(await page.textContent('#starsPay')), 500);
  await page.fill('#starsInput', '15');
  demo.app.tg.reset();
  await page.click('#starsPay');
  await page.waitForSelector('#starsLink');
  assert.match(await page.getAttribute('#starsLink', 'href'), /^https:\/\/t\.me\/\$inv_/);
  assert.equal(await page.getAttribute('#starsLink', 'target'), '_blank');
  const inv = demo.app.tg.calls('createInvoiceLink')[0].payload;
  assert.deepEqual(inv.prices.map((p) => p.amount), [15]);
  const [tab] = await Promise.all([context.waitForEvent('page'), page.click('#starsLink')]);
  await tab.close();
  await page.waitForSelector('.modal-wrap', { state: 'detached' });
  await demo.app.sendUpdate({
    message: {
      message_id: 502, date: 0, chat: { id: ME.id, type: 'private' }, from: { is_bot: false, ...ME },
      successful_payment: { currency: 'XTR', total_amount: 15, invoice_payload: inv.payload, telegram_payment_charge_id: 'ui-charge-web', provider_payment_charge_id: '' },
    },
  });
  await page.waitForFunction((b) => Number(document.querySelector('#bal').textContent.replace(/\D/g, '')) === b + 15, before, { timeout: 8000 });
  await page.waitForSelector('.toast.ok');
  assert.deepEqual(errors, []);
  await context.close();
});

test('deposit by brainrots: nickname + brainrots picked from the list, request reaches the admins', { skip }, async () => {
  const { page, errors } = await open();
  await page.waitForSelector('.case-grid');
  await page.click('[data-act="topup"]');
  await page.click('[data-act="tu-brainrots"]');
  await page.waitForSelector('#depForm');
  // no text field any more: a list of brainrots to pick from
  assert.equal(await page.locator('#depForm textarea').count(), 0);
  const total = await page.locator('#depGrid [data-dep]').count();
  assert.equal(total, (await demo.app.get('/api/catalog', { user: ME })).body.items.length, 'every brainrot can be picked');
  assert.equal(await page.isDisabled('#depBtn'), true, 'nothing picked yet');
  const items = [...demo.ctx.game.catalog.items.values()];
  const idOf = (n) => items.find((i) => i.name === n).id;
  const visibleNames = () => page.$$eval('#depGrid [data-dep]:not(.hidden) .item-name', (els) => els.map((e) => e.textContent));
  // search
  await page.fill('#depSearch', 'trala');
  const found = await visibleNames();
  assert.ok(found.length >= 1 && found.length < total);
  assert.ok(found.every((n) => n.toLowerCase().includes('trala')), found.join(', '));
  await page.click(`[data-dep="${idOf('Tralalero Tralala')}"]`);
  const isSel = (n) => page.$eval(`[data-dep="${idOf(n)}"]`, (el) => el.classList.contains('sel'));
  assert.equal(await isSel('Tralalero Tralala'), true);
  assert.equal(await page.isDisabled('#depBtn'), false);
  // how many: + / −
  const row = (n) => page.locator(`#depSel [data-row="${idOf(n)}"]`);
  await row('Tralalero Tralala').locator('[data-dep-inc]').click();
  await row('Tralalero Tralala').locator('[data-dep-inc]').click();
  assert.equal(await row('Tralalero Tralala').locator('.dep-cnt b').textContent(), '3');
  await page.fill('#depSearch', 'cerberus');
  assert.deepEqual(await visibleNames(), ['Cerberus']);
  await page.click(`[data-dep="${idOf('Cerberus')}"]`);
  assert.equal(await page.locator('#depSel .dep-row').count(), 2);
  await row('Cerberus').locator('[data-dep-dec]').click(); // 1 -> removed
  assert.equal(await page.locator('#depSel .dep-row').count(), 1);
  assert.equal(await isSel('Cerberus'), false);
  await page.click(`[data-dep="${idOf('Cerberus')}"]`);
  await page.fill('#depSearch', '');
  assert.equal((await visibleNames()).length, total);
  // nickname is still required
  await page.fill('#depForm [name=nick]', '');
  await page.click('#depBtn');
  await page.waitForSelector('.toast.error');
  assert.match(await page.textContent('.toast.error'), /ник в Roblox/);
  await page.fill('#depForm [name=nick]', 'TestRoblox');
  await page.click('#depBtn');
  await page.waitForSelector('.toast.ok');
  const req = await demo.ctx.db.one("SELECT * FROM bs_requests WHERE user_id = $1 AND kind = 'deposit' ORDER BY id DESC LIMIT 1", [ME.id]);
  assert.equal(req.nick, 'TestRoblox');
  assert.deepEqual(
    req.offer.map((e) => [e.name, e.count]),
    [['Tralalero Tralala', 3], ['Cerberus', 1]],
  );
  assert.equal(req.details, 'Tralalero Tralala ×3, Cerberus');
  assert.equal(await page.textContent('.toast.ok'), `Заявка #${req.id} отправлена`);
  await page.waitForSelector('.modal-wrap', { state: 'detached' });
  // the nickname is remembered
  await page.click('[data-act="topup"]');
  await page.click('[data-act="tu-brainrots"]');
  assert.equal(await page.inputValue('#depForm [name=nick]'), 'TestRoblox');
  await page.click('.modal-backdrop', { position: { x: 10, y: 10 } });
  await page.waitForSelector('.modal-wrap', { state: 'detached' });
  // the admin sees exactly what was picked
  await page.evaluate((id) => (location.hash = '#/admin/deposits/' + id), req.id);
  await page.waitForSelector('.req .offer-n');
  assert.deepEqual(await page.locator('.req .offer-n').allTextContents(), ['×3', '×1']);
  const sum = req.offer.reduce((s, e) => s + e.value * e.count, 0);
  assert.equal(num(await page.textContent('.req .kv:has-text("На сумму") b')), sum);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('admin: «Можно пополнять» in the item editor decides which brainrots players can deposit', { skip }, async () => {
  const cer = [...demo.ctx.game.catalog.items.values()].find((i) => i.name === 'Cerberus');
  const { page, errors } = await open({ path: '/#/admin/items' });
  await page.waitForSelector(`[data-item="${cer.id}"]`);
  await page.click(`[data-item="${cer.id}"]`);
  await page.waitForSelector('#itemForm [name="depositable"]', { state: 'attached' });
  assert.equal(await page.isChecked('#itemForm [name="depositable"]'), true, 'on by default');
  assert.ok((await page.textContent('#itemForm')).includes('Можно пополнять'));
  await page.click('#itemForm label.switch:has([name="depositable"])');
  await page.click('#itemForm button[type=submit]');
  await page.waitForSelector('.toast.ok');
  assert.equal(demo.ctx.game.catalog.items.get(cer.id).depositable, false);
  // the player no longer sees it in the deposit list (after the app reloads its data)
  await page.reload();
  await page.waitForSelector('#admBody');
  await page.click('[data-act="topup"]');
  await page.click('[data-act="tu-brainrots"]');
  await page.waitForSelector('#depGrid [data-dep]');
  assert.equal(await page.locator(`#depGrid [data-dep="${cer.id}"]`).count(), 0);
  const shown = await page.locator('#depGrid [data-dep]').count();
  assert.equal(shown, (await demo.app.get('/api/catalog', { user: ME })).body.depositIds.length);
  await page.click('.modal-backdrop', { position: { x: 10, y: 10 } });
  await page.waitForSelector('.modal-wrap', { state: 'detached' });
  // switched back on
  await page.click(`[data-item="${cer.id}"]`);
  await page.waitForSelector('#itemForm [name="depositable"]', { state: 'attached' });
  assert.equal(await page.isChecked('#itemForm [name="depositable"]'), false);
  await page.click('#itemForm label.switch:has([name="depositable"])');
  await page.click('#itemForm button[type=submit]');
  await page.waitForSelector('.toast.ok');
  assert.equal(demo.ctx.game.catalog.items.get(cer.id).depositable, true);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('withdrawal from the profile: listed brainrots go as they are, others are exchanged with a remainder', { skip }, async () => {
  const give = async (name) => {
    const it = [...demo.ctx.game.catalog.items.values()].find((i) => i.name === name);
    return (await demo.ctx.db.one("INSERT INTO bs_inventory (user_id, item_id, source) VALUES ($1, $2, 'test') RETURNING id", [ME.id, it.id])).id;
  };
  const garama = await give('Garama and Madundung');
  const croc = await give('Bombardiro Crocodilo'); // 75, can't be withdrawn
  const goose = await give('Bombombini Gusini'); // 85, can't be withdrawn
  const cerberus = await give('Cerberus');
  const { page, errors } = await open({ path: '/#/profile' });
  await page.waitForSelector('.p-card');
  const before = await page.locator('.grid.items .item').count();
  const bal = num(await page.textContent('#bal'));

  // 1) only listed brainrots: straight to a request
  await page.click('[data-act="withdraw"]');
  await page.waitForSelector('#wdForm');
  assert.equal(await page.isDisabled('#wdBtn'), true);
  assert.equal(await page.locator('[data-wd]').count(), before);
  await page.click(`[data-wd="${cerberus}"]`);
  assert.equal(num(await page.textContent('#wdBtn')), 150);
  await page.fill('#wdForm [name=nick]', 'TestRoblox');
  await page.click('#wdBtn');
  await page.waitForSelector('.toast.ok');
  let row = await demo.ctx.db.one("SELECT * FROM bs_requests WHERE user_id = $1 AND kind = 'withdraw' ORDER BY id DESC LIMIT 1", [ME.id]);
  assert.deepEqual(row.items.map((i) => i.name), ['Cerberus']);
  assert.equal(row.exchange, null);
  await page.waitForFunction((n) => document.querySelectorAll('.grid.items .item').length === n, before - 1);
  await page.waitForSelector('.toast', { state: 'detached' });

  // 2) others picked: choose one of the listed brainrots, the remainder is shown and credited
  await page.click('[data-act="withdraw"]');
  await page.waitForSelector('#wdForm');
  assert.equal(await page.inputValue('#wdForm [name=nick]'), 'TestRoblox', 'nickname remembered');
  for (const id of [garama, croc, goose]) await page.click(`[data-wd="${id}"]`);
  await page.click('#wdBtn');
  await page.waitForSelector('#wdSwap:not(.hidden) [data-wt]');
  assert.equal(await page.textContent('#wdSwap .sheet-title'), 'Выбери, кого вывести');
  const names = await page.locator('#wdTargets .item-name').allTextContents();
  assert.deepEqual([...names].sort(), ['Burguro and Fryuro', 'Capitano Moby', 'Cerberus', 'Dragon Cannelloni', 'Garama and Madundung']);
  const id = (n) => [...demo.ctx.game.catalog.items.values()].find((i) => i.name === n).id;
  assert.equal(await page.isDisabled(`[data-wt="${id('Dragon Cannelloni')}"]`), true, '1100 > 160');
  assert.equal(await page.textContent(`[data-wt="${id('Cerberus')}"] .wd-rest`), 'Остаток +10');
  assert.equal(await page.textContent(`[data-wt="${id('Burguro and Fryuro')}"] .wd-rest`), 'Остаток +60');
  assert.equal(await page.isDisabled('#wdGo'), true);
  // back to the list keeps the selection
  await page.click('#wdBack');
  assert.equal(await page.locator('#wdGrid .item.sel').count(), 3);
  await page.click('#wdBtn');
  await page.click(`[data-wt="${id('Cerberus')}"]`);
  await page.click('#wdGo');
  await page.waitForSelector('.toast.ok');
  await page.waitForFunction((b) => Number(document.querySelector('#bal').textContent.replace(/\D/g, '')) === b + 10, bal);
  row = await demo.ctx.db.one("SELECT * FROM bs_requests WHERE user_id = $1 AND kind = 'withdraw' ORDER BY id DESC LIMIT 1", [ME.id]);
  assert.deepEqual(row.items.map((i) => i.name), ['Cerberus', 'Garama and Madundung']);
  assert.equal(row.exchange.rest, 10);
  await page.waitForFunction((n) => document.querySelectorAll('.grid.items .item').length === n, before - 4);
  assert.equal((await demo.app.get('/api/inventory', { user: ME })).body.inventory.length, before - 4);
  await demo.ctx.db.query("UPDATE bs_requests SET status = 'done' WHERE user_id = $1 AND kind = 'withdraw' AND status = 'new'", [ME.id]);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('admin: deposits tab — conversation with the player, coins, completion', { skip }, async () => {
  const kira = demo.others[1];
  const req = await demo.ctx.db.one("SELECT id FROM bs_requests WHERE user_id = $1 AND kind = 'deposit'", [kira.id]);
  const { page, errors } = await open({ path: '/#/admin/deposits' });
  await page.waitForSelector('#reqList .req-row');
  await page.waitForFunction(() => document.querySelector('.chip-n[data-cnt="deposit"]')?.textContent !== '');
  assert.ok(Number(await page.textContent('.chip-n[data-cnt="deposit"]')) >= 1);
  assert.match(await page.textContent(`[data-req="${req.id}"]`), /KiraPlays/);
  await page.click(`[data-req="${req.id}"]`);
  await page.waitForSelector('#reqChat .msg');
  assert.equal(await page.textContent('.req .form-head b'), `Пополнение #${req.id}`);
  assert.equal(await page.textContent('.req .code'), 'KiraPlays');
  const bubbles = () => page.locator('#reqChat .msg').allTextContents();
  assert.match((await bubbles()).join('|'), /Добавила, ник KiraPlays/);

  // admin -> player through the bot
  demo.app.tg.reset();
  await page.fill('#reqMsg', 'Отправил трейд, прими');
  await page.click('#reqForm button[type=submit]');
  await page.waitForFunction(() => [...document.querySelectorAll('#reqChat .msg.admin')].some((m) => m.textContent.includes('Отправил трейд, прими')));
  const toKira = demo.app.tg.calls('sendMessage').find((c) => Number(c.payload.chat_id) === kira.id);
  assert.match(toKira.payload.text, /Отправил трейд, прими/);
  assert.equal(await page.inputValue('#reqMsg'), '', 'draft cleared after sending');

  // player answers in the bot -> shows up in the open card by itself
  await page.fill('#reqMsg', 'черновик');
  await demo.app.sendUpdate({
    callback_query: { id: 'cb2', from: { is_bot: false, ...kira }, chat_instance: 'x', data: `rq:${req.id}`, message: { message_id: 1, date: 0, chat: { id: kira.id, type: 'private' }, text: 'x' } },
  });
  await demo.app.message(kira, 'Принял, спасибо!');
  await page.waitForFunction(() => [...document.querySelectorAll('#reqChat .msg.user')].some((m) => m.textContent.includes('Принял, спасибо!')), null, { timeout: 9000 });
  assert.equal(await page.inputValue('#reqMsg'), 'черновик', 'typing is not lost when new messages arrive');

  // credit coins — while a slow background refresh is on its way (it must not undo the result on screen)
  const bal = (await demo.ctx.db.one('SELECT balance FROM bs_users WHERE id = $1', [kira.id])).balance;
  let slowed = 0;
  await page.route(/\/api\/admin\/requests\/\d+$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    // the server answers now, the answer reaches the page 6 s later
    const response = await route.fetch();
    slowed++;
    await new Promise((r) => setTimeout(r, 6000));
    await route.fulfill({ response }).catch(() => {});
  });
  await new Promise((r) => setTimeout(r, 5200)); // a refresh (every 5 s) is now pending
  await page.fill('#reqAmount', '75');
  await page.click('[data-ra="credit"]');
  await page.click('#confirmYes');
  await page.waitForFunction(() => [...document.querySelectorAll('#reqChat .msg.sys')].some((m) => m.textContent.includes('Начислено +75')));
  assert.equal((await demo.ctx.db.one('SELECT balance FROM bs_users WHERE id = $1', [kira.id])).balance, bal + 75);
  await new Promise((r) => setTimeout(r, 6500)); // the stale refresh has arrived by now
  assert.ok(slowed >= 1, 'a refresh was in flight');
  assert.ok((await page.textContent('#admBody')).includes('Начислено +75'), 'stale refresh did not overwrite the card');
  assert.match(await page.textContent('.req .kv:has-text("Начислено")'), /75/);
  await page.unroute(/\/api\/admin\/requests\/\d+$/);

  // complete
  await page.click('[data-ra="done"]');
  await page.click('#confirmYes');
  await page.waitForFunction(() => document.querySelector('.req .badge')?.textContent === 'Выполнена');
  assert.equal(await page.locator('[data-ra]').count(), 0, 'no actions on a closed request');
  assert.equal((await demo.ctx.db.one('SELECT status FROM bs_requests WHERE id = $1', [req.id])).status, 'done');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('admin: requests are split into «Работает» / «Выполнено» / «Отклонено» (deposits and withdrawals)', { skip }, async () => {
  const someone = demo.others[0];
  const rejected = await demo.ctx.db.one(
    "INSERT INTO bs_requests (user_id, kind, status, nick, details) VALUES ($1, 'deposit', 'rejected', 'NoThanks', 'отклонённая') RETURNING id",
    [someone.id],
  );
  const { page, errors } = await open({ path: '/#/admin/deposits' });
  await page.waitForSelector('#reqList');
  const tabs = () => page.locator('.adm-seg button').allTextContents();
  const badges = () => page.locator('#reqList .badge').allTextContents();
  const rowIds = () => page.$$eval('#reqList [data-req]', (els) => els.map((e) => Number(e.dataset.req)));
  const fromDb = async (kind, statuses) =>
    (await demo.ctx.db.many('SELECT id FROM bs_requests WHERE kind = $1 AND status = ANY($2::text[]) ORDER BY id', [kind, statuses])).map((r) => Number(r.id));
  const sorted = (a) => [...a].sort((x, y) => x - y);
  for (const [section, kind] of [['deposits', 'deposit'], ['withdrawals', 'withdraw']]) {
    await page.evaluate((s) => (location.hash = '#/admin/' + s), section);
    await page.waitForSelector('#reqList');
    assert.deepEqual(await tabs(), ['Работает', 'Выполнено', 'Отклонено']);
    for (const [scope, statuses, labels] of [
      ['active', ['new', 'active'], ['Новая', 'В работе']],
      ['done', ['done'], ['Выполнена']],
      ['rejected', ['rejected'], ['Отклонена']],
    ]) {
      await page.click(`.adm-seg [data-scope="${scope}"]`);
      await page.waitForSelector(`.adm-seg [data-scope="${scope}"].on`);
      await page.waitForSelector('#reqList');
      const want = await fromDb(kind, statuses);
      assert.deepEqual(sorted(await rowIds()), want, `${kind}/${scope}: exactly these requests`);
      assert.ok((await badges()).every((b) => labels.includes(b)), `${kind}/${scope}: ${await badges()}`);
      if (!want.length) assert.ok(await page.isVisible('#reqList .empty-box'));
    }
  }
  // the chosen tab stays when switching sections; the declined deposit is there
  await page.evaluate(() => (location.hash = '#/admin/deposits'));
  await page.waitForSelector('.adm-seg [data-scope="rejected"].on');
  await page.waitForSelector(`#reqList [data-req="${rejected.id}"]`);
  await page.click('.adm-seg [data-scope="active"]');
  await page.waitForSelector('.adm-seg [data-scope="active"].on');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('admin: bot notification link opens the request (?go=…)', { skip }, async () => {
  const wd = await demo.ctx.db.one("SELECT id FROM bs_requests WHERE kind = 'withdraw' AND status = 'new' ORDER BY id LIMIT 1");
  const { page, errors } = await open({ path: `/?go=admin/withdrawals/${wd.id}` });
  await page.waitForSelector('#reqChat', { state: 'attached' });
  assert.equal(await page.textContent('.req .form-head b'), `Вывод #${wd.id}`);
  assert.ok(!page.url().includes('go='));
  assert.ok((await page.locator('.req .list .row').count()) >= 1, 'held brainrots listed');
  // decline -> brainrots return to the player
  const owner = (await demo.ctx.db.one('SELECT user_id, items FROM bs_requests WHERE id = $1', [wd.id]));
  const invBefore = (await demo.ctx.db.one('SELECT count(*)::int AS n FROM bs_inventory WHERE user_id = $1', [owner.user_id])).n;
  await page.click('[data-ra="rejected"]');
  assert.match(await page.textContent('.confirm p'), /Брейнроты вернутся в инвентарь игрока/);
  await page.click('#confirmYes');
  await page.waitForFunction(() => document.querySelector('.req .badge')?.textContent === 'Отклонена');
  const invAfter = (await demo.ctx.db.one('SELECT count(*)::int AS n FROM bs_inventory WHERE user_id = $1', [owner.user_id])).n;
  assert.equal(invAfter, invBefore + owner.items.length);
  assert.deepEqual(errors, []);
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
  for (const s of ['overview', 'deposits', 'withdrawals', 'items', 'users', 'promos', 'settings', 'broadcast']) {
    await page.evaluate((x) => (location.hash = '#/admin/' + x), s);
    await page.waitForSelector('#admBody > :not(.spinner)');
  }
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('admin: categories — make one, drop cases in, players see them under the heading', { skip }, async () => {
  const { page, errors } = await open({ path: '/#/admin/cases' });
  await page.waitForSelector('[data-cat-edit="new"]');
  await page.click('[data-cat-edit="new"]');
  await page.waitForSelector('#catForm');
  await page.fill('#catForm [name=name]', 'Топовые');
  await page.check(`#catForm input[name=case][value="${demo.bySlug.griffin.id}"]`);
  await page.check(`#catForm input[name=case][value="${demo.bySlug.dragon.id}"]`);
  await page.click('#catForm button[type=submit]');
  await page.waitForSelector('.cat-head');
  assert.equal(await page.textContent('.cat-head .sec-title'), 'Топовые');
  assert.equal(await page.locator('.cat-head + .list .row').count(), 2);
  // move one more case there from its editor
  await page.evaluate((id) => (location.hash = '#/admin/cases/' + id), demo.bySlug.mushroom.id);
  await page.waitForSelector('#caseForm [name=category_id]');
  await page.selectOption('#caseForm [name=category_id]', { label: 'Топовые' });
  await page.waitForSelector('.toast', { state: 'detached' }); // the earlier "Saved" toast is gone
  await page.click('#caseForm button[type=submit]');
  await page.waitForSelector('.toast.ok');
  // players: cases without a category first, then the titled block
  await page.evaluate(() => (location.hash = '#/cases'));
  await page.waitForSelector('.case-cat');
  assert.equal(await page.textContent('.case-cat .cat-title'), 'Топовые');
  assert.deepEqual(await page.locator('.case-cat .case-name').allTextContents(), ['Драгон кейс', 'Грибной кейс', 'Грифон кейс']);
  assert.equal(await page.locator('.case-card').count(), 9, 'every case still listed once');
  assert.ok(!(await page.locator('.case-grid').first().textContent()).includes('Грифон'));
  // delete: the cases go back to the common grid
  await page.evaluate(() => (location.hash = '#/admin/cases'));
  await page.waitForSelector('.cat-head [data-cat-edit]');
  await page.click('.cat-head [data-cat-edit]');
  await page.waitForSelector('#catDel');
  await page.click('#catDel');
  await page.click('#confirmYes');
  await page.waitForFunction(() => !document.querySelector('.cat-head'));
  await page.evaluate(() => (location.hash = '#/cases'));
  await page.waitForSelector('.case-grid');
  assert.equal(await page.locator('.case-cat').count(), 0);
  assert.equal(await page.locator('.case-card').count(), 9);
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

test('admin: the player card shows where each brainrot came from', { skip }, async () => {
  const p = demo.others[2];
  const items = [...demo.ctx.game.catalog.items.values()];
  const byName = (n) => items.find((i) => i.name === n);
  const noob = demo.bySlug.noob;
  await demo.app.setBalance(p.id, 1000);
  const opened = await demo.app.post(`/api/case/${noob.id}/open`, { user: p });
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  const gift = await demo.app.post(`/api/admin/users/${p.id}/give`, { user: ME, body: { itemId: byName('Tim Cheese').id } });
  const target = byName('Spooky and Pumpky');
  const up = await demo.ctx.db.one(
    'INSERT INTO bs_upgrades (user_id, bet_value, target_item_id, chance, roll, won) VALUES ($1, 287, $2, 64.57, 12.5, TRUE) RETURNING id',
    [p.id, target.id],
  );
  const row = async (source, itemId, ref) =>
    (await demo.ctx.db.one('INSERT INTO bs_inventory (user_id, item_id, source, ref_id) VALUES ($1, $2, $3, $4) RETURNING id', [p.id, itemId, source, ref])).id;
  const upInv = await row('upgrade', target.id, up.id);
  const dep = await demo.ctx.db.one("SELECT id FROM bs_requests WHERE kind = 'deposit' ORDER BY id LIMIT 1");
  const depInv = await row('deposit', byName('Cerberus').id, dep.id);
  const wd = await demo.ctx.db.one("SELECT id FROM bs_requests WHERE kind = 'withdraw' ORDER BY id LIMIT 1");
  const refInv = await row('refund', byName('Capitano Moby').id, wd.id);

  const { page, errors } = await open({ path: `/#/admin/users/${p.id}` });
  await page.waitForSelector('.inv-src');
  const src = (invId) => page.textContent(`.row:has([data-inv="${invId}"]) .inv-src`);
  const when = / · \d{1,2} [а-я]+\.?, \d{2}:\d{2}$/;
  const caseName = demo.ctx.game.catalog.cases.get(noob.id).name_ru;
  assert.match(await src(opened.body.invId), new RegExp(`^${caseName}${when.source}`), 'the name already says «кейс»');
  // a case named without the word gets «Кейс «…»»
  await demo.ctx.db.query("UPDATE bs_cases SET name_ru = 'Сокровища' WHERE id = $1", [noob.id]);
  await page.reload();
  await page.waitForSelector('.inv-src');
  assert.match(await src(opened.body.invId), new RegExp(`^Кейс «Сокровища»${when.source}`));
  await demo.ctx.db.query('UPDATE bs_cases SET name_ru = $2 WHERE id = $1', [noob.id, caseName]);
  assert.match(await src(gift.body.invId), new RegExp(`^Выдал админ ${ME.first_name}${when.source}`));
  assert.match(await src(upInv), new RegExp(`^Апгрейдер · шанс 64,57% · ставка\\s*287${when.source}`));
  assert.match(await src(depInv), new RegExp(`^Пополнение #${dep.id}${when.source}`));
  assert.match(await src(refInv), new RegExp(`^Возврат с вывода #${wd.id}${when.source}`));
  // the request number opens the request
  await page.click(`.row:has([data-inv="${depInv}"]) .src-link`);
  await page.waitForSelector('.req .form-head b');
  assert.equal(await page.textContent('.req .form-head b'), `Пополнение #${dep.id}`);
  await page.goBack();
  await page.waitForSelector('.inv-src');
  // English admin panel
  await page.evaluate(() => (location.hash = '#/profile'));
  await page.click('[data-act="lang"]');
  await page.click('[data-lang="en"]');
  await page.evaluate((id) => (location.hash = '#/admin/users/' + id), p.id);
  await page.waitForSelector('.inv-src');
  const en = demo.ctx.game.catalog.cases.get(noob.id).name_en;
  assert.ok((await src(opened.body.invId)).startsWith(en));
  assert.ok((await src(upInv)).startsWith('Upgrader · 64.57% chance · bet'));
  await page.click('[data-act="lang"]');
  await page.click('[data-lang="ru"]');
  // the language is saved on the server in the background: wait for it, later tests expect Russian
  for (let i = 0; i < 50 && (await apiMe()).me.lang !== 'ru'; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal((await apiMe()).me.lang, 'ru');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('main admin: shown as a plain admin, a ban attempt just fails', { skip }, async () => {
  const boss = { id: 7001, first_name: 'Босс', username: 'owner_ui', language_code: 'ru' };
  await demo.app.post('/api/bootstrap', { user: boss });
  const { page, errors } = await open({ path: '/#/admin/users' });
  await page.waitForSelector('#uList .row');
  const html = (sel) => page.$eval(sel, (el) => el.querySelector('.row-side').innerHTML.replace(/<b>[^<]*<\/b>/, ''));
  // same badge markup as any other admin (only the balance differs)
  assert.equal(await html(`a[href="#/admin/users/${boss.id}"]`), await html(`a[href="#/admin/users/${ME.id}"]`));
  assert.equal(await page.textContent(`a[href="#/admin/users/${boss.id}"] .badge`), 'Админ');
  await page.click(`a[href="#/admin/users/${boss.id}"]`);
  await page.waitForSelector('[data-flag="is_banned"]');
  assert.equal(await page.textContent('[data-flag="is_banned"]'), 'Забанить');
  assert.equal(await page.textContent('[data-flag="is_admin"]'), 'Снять админа');
  await page.click('[data-flag="is_banned"]');
  await page.waitForSelector('.toast.error');
  assert.equal(await page.textContent('.toast.error'), 'Что-то пошло не так');
  await page.click('[data-flag="is_admin"]');
  await page.waitForTimeout(400);
  const r = await demo.ctx.db.one('SELECT is_admin, is_banned FROM bs_users WHERE id = $1', [boss.id]);
  assert.deepEqual(r, { is_admin: true, is_banned: false });
  assert.equal(await page.textContent('[data-flag="is_banned"]'), 'Забанить');
  assert.deepEqual(errors.filter((e) => !/status of 403/.test(e)), []);
  await page.context().close();
});

test('Stars rate: the field is only in the main admin\'s settings', { skip }, async () => {
  const boss = { id: 7001, first_name: 'Босс', username: 'owner_ui', language_code: 'ru' };
  await demo.app.post('/api/bootstrap', { user: boss });
  const rate = () => demo.ctx.settings.get('stars_rate');
  const before = rate();
  // a regular admin: no field, saving the rest keeps the rate
  {
    const { page, errors } = await open({ path: '/#/admin/settings' });
    await page.waitForSelector('#setForm');
    assert.equal(await page.locator('[name="stars_rate"]').count(), 0);
    assert.ok(!(await page.textContent('#setForm')).includes('Курс звёзд'));
    await page.fill('[name="start_balance"]', '3');
    await page.click('#setForm button[type=submit]');
    await page.waitForSelector('.toast.ok');
    assert.equal(demo.ctx.settings.get('start_balance'), 3);
    assert.equal(rate(), before);
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  // the main admin: the field is there and works
  {
    const { page, errors } = await open({ user: boss, path: '/#/admin/settings' });
    await page.waitForSelector('#setForm');
    assert.equal(await page.inputValue('[name="stars_rate"]'), String(before));
    assert.ok((await page.textContent('#setForm')).includes('Курс звёзд: монет за 1 ⭐'));
    await page.fill('[name="stars_rate"]', '3');
    await page.fill('[name="start_balance"]', '0');
    await page.click('#setForm button[type=submit]');
    await page.waitForSelector('.toast.ok');
    assert.equal(rate(), 3);
    // the top-up sheet uses the new rate right away
    await page.click('[data-act="topup"]');
    await page.click('[data-act="tu-stars"]');
    await page.waitForSelector('#starsInput');
    await page.fill('#starsInput', '10');
    await page.waitForFunction(() => document.querySelector('#starsGet').textContent.replace(/\D/g, '') === '30');
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  await demo.ctx.settings.update({ stars_rate: before, start_balance: 0 });
});

test('admin: a regular admin edits case odds; the upgrader settings only the main admin', { skip }, async () => {
  const boss = { id: 7001, first_name: 'Босс', username: 'owner_ui', language_code: 'ru' };
  await demo.app.post('/api/bootstrap', { user: boss });
  const noob = demo.bySlug.noob;
  const loot = () => demo.ctx.game.catalog.cases.get(noob.id).items.map((e) => [e.item_id, e.chance]);
  const before = loot();
  const edge = demo.ctx.settings.get('upgrade_edge');
  {
    const { page, errors } = await open({ path: `/#/admin/cases/${noob.id}` });
    await page.waitForSelector('#caseForm .lr-chance');
    await page.fill('#caseForm .lr-chance >> nth=0', '33');
    await page.click('#caseForm button[type=submit]');
    await page.waitForSelector('.toast.ok');
    assert.ok(loot().some(([, c]) => c === 33), 'new chance saved');
    await page.evaluate(() => (location.hash = '#/admin/settings'));
    await page.waitForSelector('#setForm [name="upgrade_edge"]');
    assert.equal(await page.locator('[name="upgrade_luck"]').count(), 0, 'bad luck is not shown to regular admins');
    await page.waitForSelector('.toast.ok', { state: 'detached', timeout: 6000 }); // the case was saved
    await page.fill('[name="upgrade_edge"]', '25');
    await page.click('#setForm button[type=submit]');
    await page.waitForSelector('.toast.error');
    assert.equal(await page.textContent('.toast.error'), 'Что-то пошло не так');
    assert.equal(demo.ctx.settings.get('upgrade_edge'), edge);
    assert.deepEqual(errors.filter((e) => !/status of 403/.test(e)), []);
    await page.context().close();
  }
  {
    const { page, errors } = await open({ user: boss, path: '/#/admin/settings' });
    await page.waitForSelector('#setForm [name="upgrade_luck"]');
    assert.equal(await page.inputValue('[name="upgrade_luck"]'), '1.3');
    assert.ok((await page.textContent('#setForm')).includes('Невезение апгрейдера: шанс ниже в N раз'));
    await page.fill('[name="upgrade_edge"]', '25');
    await page.fill('[name="upgrade_luck"]', '1.5');
    await page.click('#setForm button[type=submit]');
    await page.waitForSelector('.toast.ok');
    assert.equal(demo.ctx.settings.get('upgrade_edge'), 25);
    assert.equal(demo.ctx.settings.get('upgrade_luck'), 1.5);
    assert.deepEqual((await demo.app.get('/api/catalog', { user: ME })).body.upgrade, { edge: 25, minChance: 1, maxChance: 80, luck: 1.5 });
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  // restore
  const c = demo.ctx.game.catalog.cases.get(noob.id);
  await demo.app.put(`/api/admin/cases/${noob.id}`, {
    user: ME,
    body: { name_ru: c.name_ru, name_uk: c.name_uk, name_en: c.name_en, emoji: c.emoji, color: c.color, sort: c.sort, enabled: c.enabled, price: c.price, category_id: c.category_id, items: before.map(([itemId, chance]) => ({ itemId, chance })) },
  });
  await demo.ctx.settings.update({ upgrade_edge: edge, upgrade_luck: 1.3 });
  assert.deepEqual(loot(), before);
});

test('main admin: bad luck for one account from the player card; that player sees and gets the lower chance', { skip }, async () => {
  const boss = { id: 7001, first_name: 'Босс', username: 'owner_ui', language_code: 'ru' };
  await demo.app.post('/api/bootstrap', { user: boss });
  const p = demo.others[4];
  await demo.app.post('/api/bootstrap', { user: p });
  const luckOf = async () => Number((await demo.ctx.db.one('SELECT upgrade_luck FROM bs_users WHERE id = $1', [p.id])).upgrade_luck);
  // a regular admin: no such control
  {
    const { page, errors } = await open({ path: `/#/admin/users/${p.id}` });
    await page.waitForSelector('[data-flag="is_banned"]');
    assert.equal(await page.locator('#uLuck, #uLuckIn, [data-luck]').count(), 0);
    assert.ok(!(await page.content()).includes('Невезение аккаунта'));
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  // the main admin sets it in the player card
  {
    const { page, errors } = await open({ user: boss, path: `/#/admin/users/${p.id}` });
    await page.waitForSelector('#uLuckIn');
    assert.equal(await page.textContent('.kv:has(#uLuck) span'), 'Невезение аккаунта: шанс в апгрейдере ниже ещё в N раз');
    assert.equal(await page.textContent('#uLuck'), '×1');
    assert.equal(await page.inputValue('#uLuckIn'), '1');
    await page.fill('#uLuckIn', '2');
    await page.click('[data-luck]');
    await page.waitForSelector('.toast.ok');
    await page.waitForFunction(() => document.querySelector('#uLuck')?.textContent === '×2');
    assert.equal(await page.inputValue('#uLuckIn'), '2');
    assert.equal(await luckOf(), 2);
    // out of range: refused, nothing changes
    await page.waitForSelector('.toast.ok', { state: 'detached', timeout: 6000 });
    await page.fill('#uLuckIn', '50');
    await page.click('[data-luck]');
    await page.waitForSelector('.toast.error');
    assert.equal(await luckOf(), 2);
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  // the player: 30 / 200 * 90 = 13.5%, 1.3 × 2 = 2.6 times lower = 5.19% (other players: 10.38%)
  const items = [...demo.ctx.game.catalog.items.values()];
  const chimp = items.find((i) => i.name === 'Chimpanzini Bananini');
  const spooky = items.find((i) => i.name === 'Spooky and Pumpky');
  const inv = (await demo.ctx.db.one("INSERT INTO bs_inventory (user_id, item_id, source) VALUES ($1, $2, 'test') RETURNING id", [p.id, chimp.id])).id;
  {
    const { page, errors } = await open({ user: p, path: '/#/upgrade' });
    await page.waitForSelector(`[data-act="up-pick"][data-inv="${inv}"]`);
    await page.click(`[data-act="up-pick"][data-inv="${inv}"]`);
    await page.click('[data-act="up-tab"][data-v="targets"]');
    await page.click(`[data-act="up-target"][data-id="${spooky.id}"]`);
    assert.equal(Number((await page.textContent('#gPct')).replace('%', '').replace(',', '.').replace(/\s/g, '')), 5.19);
    await page.click('#upBtn');
    await page.waitForSelector('.result', { timeout: 9000 });
    const last = await demo.ctx.db.one('SELECT chance FROM bs_upgrades WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [p.id]);
    assert.equal(Number(last.chance), 5.19, 'rolled with the chance on the screen');
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  assert.equal((await demo.app.post(`/api/admin/users/${p.id}/luck`, { user: boss, body: { luck: 1 } })).status, 200);
  assert.equal(await luckOf(), 1);
});

test('main admin: switches off sections for the other admins; they lose those tabs', { skip }, async () => {
  const boss = { id: 7001, first_name: 'Босс', username: 'owner_ui', language_code: 'ru' };
  await demo.app.post('/api/bootstrap', { user: boss });
  const chips = (page) => page.$$eval('.adm-tabs .chip', (els) => els.map((e) => e.firstChild.textContent));
  const doneDeposits = async (page) => {
    await page.evaluate(() => (location.hash = '#/admin/deposits'));
    await page.waitForSelector('.adm-seg [data-scope="done"]');
    if (!(await page.$('.adm-seg [data-scope="done"].on'))) await page.click('.adm-seg [data-scope="done"]');
    await page.waitForSelector('.adm-seg [data-scope="done"].on');
    await page.waitForSelector('#reqList .req-row, #reqList .empty-box');
    return page.$$eval('#reqList .req-row', (els) => els.map((e) => e.textContent));
  };
  const ALL_TABS = ['Обзор', 'Пополнения', 'Выводы', 'Кейсы', 'Предметы', 'Игроки', 'Промо', 'Настройки', 'Рассылка'];
  // a regular admin sees everything and has no such switches
  {
    const { page, errors } = await open({ path: '/#/admin/settings' });
    await page.waitForSelector('#setForm');
    assert.deepEqual(await chips(page), ALL_TABS);
    assert.equal(await page.locator('[data-sec]').count(), 0);
    assert.ok(!(await page.textContent('#setForm')).includes('Что видят обычные админы'));
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  // the main admin switches off cases, Stars deposits and broadcasts
  {
    const { page, errors } = await open({ user: boss, path: '/#/admin/settings' });
    await page.waitForSelector('#setForm [data-sec]', { state: 'attached' });
    const labels = await page.$$eval('#setForm label:has([data-sec])', (els) => els.map((e) => e.textContent.trim()));
    assert.deepEqual(labels, ['Обзор', 'Пополнения брейнротами', 'Пополнения звёздами', 'Выводы', 'Кейсы', 'Предметы', 'Игроки', 'Промо', 'Настройки', 'Рассылка']);
    assert.ok((await page.textContent('#setForm')).includes('Что видят обычные админы'));
    assert.equal(await page.locator('[data-sec]:checked').count(), 10, 'all on by default');
    for (const x of ['cases', 'deposits_stars', 'broadcast']) await page.click(`label:has([data-sec="${x}"])`);
    await page.click('#setForm button[type=submit]');
    await page.waitForSelector('.toast.ok');
    assert.deepEqual(demo.ctx.settings.get('admin_hidden'), ['deposits_stars', 'cases', 'broadcast']);
    assert.deepEqual(await chips(page), ALL_TABS, 'the main admin keeps every tab');
    await page.reload();
    await page.waitForSelector('#setForm [data-sec]', { state: 'attached' });
    assert.deepEqual(
      await page.$$eval('[data-sec]', (els) => els.filter((e) => !e.checked).map((e) => e.dataset.sec)),
      ['deposits_stars', 'cases', 'broadcast'],
      'saved',
    );
    // the main admin still sees the Stars payment among the done deposits
    assert.ok((await doneDeposits(page)).some((x) => x.includes('⭐')));
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  // the regular admin: no Cases / Broadcast tabs; an old link to cases opens the first tab instead
  {
    const { page, errors } = await open({ path: `/#/admin/cases/${demo.bySlug.noob.id}` });
    await page.waitForSelector('.adm-tabs .chip.on');
    assert.deepEqual(await chips(page), ['Обзор', 'Пополнения', 'Выводы', 'Предметы', 'Игроки', 'Промо', 'Настройки']);
    assert.equal(await page.textContent('.adm-tabs .chip.on'), 'Обзор');
    await page.waitForSelector('.adm-stats');
    // deposits: brainrot requests only, no Stars payments
    assert.ok(!(await doneDeposits(page)).some((x) => x.includes('⭐')), 'no Stars payments');
    assert.ok((await page.textContent('#admBody')).length > 0);
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  await demo.ctx.settings.update({ admin_hidden: [] });
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
  const reqIds = await demo.ctx.db.many('SELECT id, kind FROM bs_requests ORDER BY id');
  const reqHashes = reqIds.map((r) => `#/admin/${r.kind === 'deposit' ? 'deposits' : 'withdrawals'}/${r.id}`);
  for (const h of ['#/cases', `#/case/${demo.bySlug.dragon.id}`, `#/case/${demo.bySlug.free.id}`, '#/upgrade', '#/profile', '#/admin/cases', `#/admin/cases/${demo.bySlug.noob.id}`, '#/admin/users', '#/admin/settings', '#/admin/deposits', '#/admin/withdrawals', ...reqHashes]) {
    await page.evaluate((x) => (location.hash = x), h);
    await page.waitForTimeout(500);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.equal(over, 0, `${h} overflows by ${over}px`);
  }
  // top-up and withdrawal sheets
  for (const steps of [['[data-act="topup"]'], ['[data-act="topup"]', '[data-act="tu-stars"]'], ['[data-act="topup"]', '[data-act="tu-brainrots"]']]) {
    await page.evaluate(() => (location.hash = '#/cases'));
    await page.waitForSelector('.case-grid');
    for (const sel of steps) await page.click(sel);
    await page.waitForTimeout(350);
    const over = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - window.innerWidth, ...[...document.querySelectorAll('.sheet *')].map((e) => e.getBoundingClientRect().right - window.innerWidth)));
    assert.ok(over <= 0, `${steps.join(' > ')} overflows by ${over}px`);
    await page.click('.modal-backdrop', { position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);
  }
  await page.context().close();
});

test('no console errors in any UI test', { skip }, () => {
  assert.deepEqual(allErrors.flat(), []);
});
