// Main admin (OWNER_USERNAMES / OWNER_IDS): always admin, can't be banned or demoted.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, users } from './helpers.js';

let app;
const owner = { id: 3001, first_name: 'Михаил', username: 'Mokydel', language_code: 'ru' };
const admin = { id: 3002, first_name: 'Помощник', username: 'helper', language_code: 'ru' };
const impostor = { id: 3003, first_name: 'Фейк', username: 'mokydel', language_code: 'ru' };
const pinnedById = { id: 3004, first_name: 'Второй', language_code: 'ru' };

before(async () => {
  app = await startApp({ dbName: 'bs_t_owner', env: { OWNER_USERNAMES: '@mokydel', OWNER_IDS: String(pinnedById.id) } });
});
after(async () => {
  await app?.close();
});

const row = (id) => app.ctx.db.one('SELECT is_admin, is_banned FROM bs_users WHERE id = $1', [id]);
const settingsOf = async (u) => (await app.get('/api/admin/settings', { user: u })).body.settings;

test('the main admin becomes an admin by username and looks like any other admin', async () => {
  const r = await app.post('/api/bootstrap', { user: owner });
  assert.equal(r.status, 200);
  assert.equal(r.body.me.isAdmin, true);
  assert.deepEqual(Object.keys(r.body.me).sort(), ['balance', 'createdAt', 'id', 'isAdmin', 'lang', 'name', 'nick', 'photo', 'theme', 'username']);
  await app.post('/api/bootstrap', { user: admin });
  await app.makeAdmin(admin.id);
  const list = (await app.get('/api/admin/users', { user: admin })).body.users;
  const o = list.find((u) => u.id === owner.id);
  const a = list.find((u) => u.id === admin.id);
  assert.deepEqual(Object.keys(o).sort(), Object.keys(a).sort(), 'no extra fields that would give it away');
  assert.equal(o.isAdmin, true);
  // not exposed in the admin settings either
  const s = (await app.get('/api/admin/settings', { user: admin })).body.settings;
  assert.ok(!JSON.stringify(s).toLowerCase().includes('mokydel'));
});

test('other admins can neither ban nor demote the main admin', async () => {
  const ban = await app.post(`/api/admin/users/${owner.id}/flags`, { user: admin, body: { is_banned: true } });
  assert.equal(ban.status, 403);
  assert.equal(ban.body.error, 'forbidden');
  const demote = await app.post(`/api/admin/users/${owner.id}/flags`, { user: admin, body: { is_admin: false } });
  assert.equal(demote.status, 403);
  assert.deepEqual(await row(owner.id), { is_admin: true, is_banned: false });
  // harmless flags still work
  assert.equal((await app.post(`/api/admin/users/${owner.id}/flags`, { user: admin, body: { is_admin: true } })).status, 200);
  // the main admin can still ban and demote everyone else
  const b = await app.post(`/api/admin/users/${admin.id}/flags`, { user: owner, body: { is_banned: true } });
  assert.equal(b.status, 200);
  assert.equal((await row(admin.id)).is_banned, true);
  await app.post(`/api/admin/users/${admin.id}/flags`, { user: owner, body: { is_banned: false } });
  assert.equal((await app.post(`/api/admin/users/${admin.id}/flags`, { user: owner, body: { is_admin: false } })).status, 200);
  assert.equal((await row(admin.id)).is_admin, false);
  await app.makeAdmin(admin.id);
});

test('even a direct database change is undone on the next visit (app and bot)', async () => {
  await app.ctx.db.query('UPDATE bs_users SET is_admin = FALSE, is_banned = TRUE WHERE id = $1', [owner.id]);
  const r = await app.get('/api/me', { user: owner });
  assert.equal(r.status, 200);
  assert.equal(r.body.me.isAdmin, true);
  assert.deepEqual(await row(owner.id), { is_admin: true, is_banned: false });

  await app.ctx.db.query('UPDATE bs_users SET is_banned = TRUE WHERE id = $1', [owner.id]);
  app.tg.reset();
  await app.message(owner, '/start');
  const sent = app.tg.calls('sendPhoto').concat(app.tg.calls('sendMessage')).map((c) => c.payload);
  assert.ok(sent.some((p) => /Добро пожаловать/.test(p.caption || '')), 'welcome, not "access restricted"');
  assert.equal((await row(owner.id)).is_banned, false);
});

test('the account is pinned by id: a new holder of the username gets nothing', async () => {
  // the owner renames their account
  const renamed = { ...owner, username: 'mokydel_new' };
  assert.equal((await app.post('/api/bootstrap', { user: renamed })).body.me.isAdmin, true);
  // someone else takes the old username
  const r = await app.post('/api/bootstrap', { user: impostor });
  assert.equal(r.body.me.isAdmin, false);
  assert.equal((await app.post(`/api/admin/users/${impostor.id}/flags`, { user: admin, body: { is_banned: true } })).status, 200);
  assert.equal((await app.post(`/api/admin/users/${renamed.id}/flags`, { user: admin, body: { is_banned: true } })).status, 403);
  assert.equal((await app.get('/api/me', { user: impostor })).status, 403, 'impostor is banned');
});

test('OWNER_IDS works without a username; regular admins are unaffected', async () => {
  assert.equal((await app.post('/api/bootstrap', { user: pinnedById })).body.me.isAdmin, true);
  assert.equal((await app.post(`/api/admin/users/${pinnedById.id}/flags`, { user: admin, body: { is_admin: false } })).status, 403);
  await app.post('/api/bootstrap', { user: users.alice });
  assert.equal((await app.post('/api/bootstrap', { user: users.alice })).body.me.isAdmin, false);
});

test('Stars rate: only the main admin sees and changes it', async () => {
  const s = settingsOf;
  assert.ok(!('stars_rate' in (await s(admin))), 'a regular admin does not even see the field');
  assert.equal((await s(owner)).stars_rate, 1);
  // a regular admin's save never touches the rate, the rest is saved
  const r = await app.put('/api/admin/settings', { user: admin, body: { stars_rate: 999, start_balance: 7 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(!('stars_rate' in r.body.settings));
  assert.equal(r.body.settings.start_balance, 7);
  assert.equal(app.ctx.settings.get('stars_rate'), 1);
  // the main admin changes it; players get the new rate
  const o = await app.put('/api/admin/settings', { user: owner, body: { stars_rate: 2.5 } });
  assert.equal(o.status, 200, JSON.stringify(o.body));
  assert.equal(o.body.settings.stars_rate, 2.5);
  assert.equal((await app.get('/api/catalog', { user: users.alice })).body.topup.starsRate, 2.5);
  assert.equal((await app.put('/api/admin/settings', { user: owner, body: { stars_rate: 0 } })).status, 400, 'still validated');
  await app.put('/api/admin/settings', { user: owner, body: { stars_rate: 1, start_balance: 0 } });
  assert.equal(app.ctx.settings.get('stars_rate'), 1);
});

test('case odds: every admin changes them; the upgrader settings: only the main admin', async () => {
  const noob = [...app.ctx.game.catalog.cases.values()].find((c) => c.slug === 'noob');
  const byId = (a) => [...a].sort((x, y) => x.itemId - y.itemId);
  const lootOf = () => byId(app.ctx.game.catalog.cases.get(noob.id).items.map((e) => ({ itemId: e.item_id, chance: e.chance })));
  const body = (over = {}) => ({
    name_ru: noob.name_ru, name_uk: noob.name_uk, name_en: noob.name_en, emoji: noob.emoji, color: noob.color,
    sort: noob.sort, enabled: true, price: noob.price, items: lootOf(), ...over,
  });
  const loot0 = lootOf();
  const put = (u, b) => app.put(`/api/admin/cases/${noob.id}`, { user: u, body: b });

  // a regular admin edits the case and its odds: change a chance, remove and add a drop
  const changed = loot0.map((e, i) => (i === 0 ? { ...e, chance: e.chance + 1 } : e));
  const extra = [...app.ctx.game.catalog.items.keys()].find((id) => !loot0.some((e) => e.itemId === id));
  for (const items of [changed, loot0.slice(1), [...loot0, { itemId: extra, chance: 1 }]]) {
    const r = await put(admin, body({ price: noob.price + 1, items }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(lootOf(), byId(items));
    assert.equal(app.ctx.game.catalog.cases.get(noob.id).price, noob.price + 1);
  }
  // players see the new chances
  await put(admin, body({ price: noob.price, items: changed }));
  const pub = (await app.get('/api/catalog', { user: users.alice })).body.cases.find((c) => c.id === noob.id);
  const sum = changed.reduce((s, e) => s + e.chance, 0);
  assert.equal(pub.items.find((e) => e.item.id === changed[0].itemId).chance, Math.round((changed[0].chance / sum) * 100000) / 1000);
  // and creates cases with drops
  const fresh = { name_ru: 'Новый', name_uk: 'Новий', name_en: 'New', emoji: '📦', color: '#f59e0b', sort: 500, price: 10 };
  const created = await app.post('/api/admin/cases', { user: admin, body: { ...fresh, enabled: true, items: [{ itemId: loot0[0].itemId, chance: 100 }] } });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  await put(admin, body({ price: noob.price, items: loot0 }));
  assert.deepEqual(lootOf(), loot0);

  // upgrader settings: other admins see edge / min / max, but only the main admin changes them;
  // the bad-luck factor is not even shown to them
  const s0 = (await app.get('/api/admin/settings', { user: admin })).body.settings;
  assert.ok(!('stars_rate' in s0), 'the Stars rate stays hidden from regular admins');
  assert.ok(!('upgrade_luck' in s0), 'so does the upgrader luck');
  assert.equal(s0.upgrade_edge, 10);
  const same = await app.put('/api/admin/settings', { user: admin, body: { ...s0, start_balance: 5 } });
  assert.equal(same.status, 200, 'the form with unchanged upgrader values saves');
  assert.equal(app.ctx.settings.get('start_balance'), 5);
  for (const [k, v] of [['upgrade_edge', 25], ['upgrade_min_chance', 2], ['upgrade_max_chance', 66]]) {
    const r = await app.put('/api/admin/settings', { user: admin, body: { ...s0, start_balance: 6, [k]: v } });
    assert.equal(r.status, 403, k);
    assert.equal(app.ctx.settings.get(k), s0[k], `${k} unchanged`);
  }
  assert.equal(app.ctx.settings.get('start_balance'), 5, 'nothing saved');
  const sneak = await app.put('/api/admin/settings', { user: admin, body: { upgrade_luck: 1 } });
  assert.equal(sneak.status, 200);
  assert.equal(app.ctx.settings.get('upgrade_luck'), 1.3, 'luck from a regular admin is ignored');
  // the main admin: luck 1.3 by default, can change it and the rest; players get it
  const so = (await app.get('/api/admin/settings', { user: owner })).body.settings;
  assert.equal(so.upgrade_luck, 1.3);
  const o = await app.put('/api/admin/settings', { user: owner, body: { upgrade_luck: 2, upgrade_edge: 25, start_balance: 0 } });
  assert.equal(o.status, 200, JSON.stringify(o.body));
  const up = (await app.get('/api/catalog', { user: users.alice })).body.upgrade;
  assert.deepEqual(up, { edge: 25, minChance: 1, maxChance: 80, luck: 2 });
  // the highest possible chance (max / luck) must stay above the minimum
  assert.equal((await app.put('/api/admin/settings', { user: owner, body: { upgrade_luck: 10, upgrade_max_chance: 5 } })).body.error, 'bad_setting');
  await app.put('/api/admin/settings', { user: owner, body: { upgrade_luck: 1.3, upgrade_edge: s0.upgrade_edge } });
  assert.equal(app.ctx.settings.get('upgrade_luck'), 1.3);
});

test('account bad luck: only the main admin sees and sets it; that player gets the lower chance', async () => {
  const p = users.alice;
  await app.post('/api/bootstrap', { user: p });
  await app.post('/api/bootstrap', { user: users.bob });
  // regular admins neither see nor change it
  const seen = (await app.get(`/api/admin/users/${p.id}`, { user: admin })).body;
  assert.ok(seen.user && !('luck' in seen), 'not shown to regular admins');
  const deny = await app.post(`/api/admin/users/${p.id}/luck`, { user: admin, body: { luck: 2 } });
  assert.equal(deny.status, 403);
  assert.equal(deny.body.error, 'forbidden');
  // the main admin: 1 (as everyone) by default, from 1 to 10
  assert.equal((await app.get(`/api/admin/users/${p.id}`, { user: owner })).body.luck, 1);
  for (const bad of [0.5, 11, 'x', null]) {
    const r = await app.post(`/api/admin/users/${p.id}/luck`, { user: owner, body: { luck: bad } });
    assert.equal(r.status, 400, String(bad));
    assert.equal(r.body.error, 'bad_field');
  }
  assert.equal((await app.post('/api/admin/users/999999/luck', { user: owner, body: { luck: 2 } })).status, 404);
  const set = await app.post(`/api/admin/users/${p.id}/luck`, { user: owner, body: { luck: 2 } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.deepEqual(set.body, { luck: 2 });
  assert.equal((await app.get(`/api/admin/users/${p.id}`, { user: owner })).body.luck, 2);
  // that player: 1.3 × 2; everyone else keeps 1.3; nothing about it in the player's profile
  assert.equal((await app.get('/api/catalog', { user: p })).body.upgrade.luck, 2.6);
  const boot = (await app.post('/api/bootstrap', { user: p })).body;
  assert.equal(boot.upgrade.luck, 2.6);
  assert.ok(!('luck' in boot.me) && !('upgrade_luck' in boot.me));
  assert.equal((await app.get('/api/catalog', { user: users.bob })).body.upgrade.luck, 1.3);
  // the upgrade rolls the very chance that player is shown: 55 / 200 * 90 = 24.75% -> / 2.6 = 9.51%
  const item = (name) => [...app.ctx.game.catalog.items.values()].find((i) => i.name === name).id;
  const put = async (name) =>
    (await app.ctx.db.one("INSERT INTO bs_inventory (user_id, item_id, source) VALUES ($1, $2, 'test') RETURNING id", [p.id, item(name)])).id;
  const ids = [await put('Salamino Penguino'), await put('Chimpanzini Bananini')];
  const target = item('Spooky and Pumpky');
  const stale = await app.post('/api/upgrade', { user: p, body: { ids, target, chance: 19.03 } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.chance, 9.51);
  const up = await app.post('/api/upgrade', { user: p, body: { ids, target, chance: 9.51 } });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.chance, 9.51);
  assert.equal((await app.ctx.db.one('SELECT chance FROM bs_upgrades WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [p.id])).chance, 9.51);
  // back to normal
  assert.deepEqual((await app.post(`/api/admin/users/${p.id}/luck`, { user: owner, body: { luck: '1' } })).body, { luck: 1 });
  assert.equal((await app.get('/api/catalog', { user: p })).body.upgrade.luck, 1.3);
});
