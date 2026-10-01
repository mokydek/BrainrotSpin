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
