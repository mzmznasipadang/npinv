import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { getDb, migrate } from './db.ts';
import { createDeviceSession, verifyDeviceSession, listDeviceSessions, revokeDeviceSession } from './mobile-sessions.ts';
const NOW = Date.UTC(2026, 9, 15);
beforeEach(() => { process.env.ADMIN_PASSWORD = 'synthetic-test-password'; getDb().exec('DELETE FROM device_sessions'); });
test('opaque device credentials are independent and only hashes are stored', () => {
  const a = createDeviceSession('Phone', NOW); const b = createDeviceSession('Tablet', NOW);
  assert.match(a.token, /^[a-f0-9]{64}$/); assert.notEqual(a.token, b.token);
  assert.equal(verifyDeviceSession(a.token, NOW)?.id, a.id);
  const stored = JSON.stringify(getDb().prepare('SELECT * FROM device_sessions').all());
  assert.ok(!stored.includes(a.token)); assert.ok(!stored.includes(process.env.ADMIN_PASSWORD!));
  assert.equal(listDeviceSessions(NOW).length, 2);
  assert.ok(!JSON.stringify(listDeviceSessions(NOW)).includes('tokenHash'));
  assert.equal(revokeDeviceSession(a.id, NOW), true);
  assert.equal(verifyDeviceSession(a.token, NOW), null);
  assert.equal(verifyDeviceSession(b.token, NOW)?.id, b.id);
  assert.equal(revokeDeviceSession(99999, NOW), false);
});
test('sessions expire at the boundary and cannot survive password changes', () => {
  const a = createDeviceSession('Phone', NOW);
  const end = NOW + 30 * 86400000;
  assert.equal(verifyDeviceSession(a.token, end - 1)?.id, a.id);
  assert.equal(verifyDeviceSession(a.token, end), null);
  assert.equal(listDeviceSessions(end).length, 0);
  process.env.ADMIN_PASSWORD = 'another-synthetic-password';
  assert.equal(verifyDeviceSession(a.token, NOW), null);
  assert.equal(listDeviceSessions(NOW).length, 0);
  delete process.env.ADMIN_PASSWORD;
  assert.equal(verifyDeviceSession(a.token, NOW), null);
  assert.throws(() => createDeviceSession('Phone', NOW));
});
test('malformed bearer credentials never authenticate', () => {
  createDeviceSession('Phone', NOW);
  for (const token of ['', 'bad', 'a'.repeat(63), 'g'.repeat(64), 'a'.repeat(10000)]) assert.equal(verifyDeviceSession(token, NOW), null);
});
test('device session migration preserves all existing business records', () => {
  const db = new DatabaseSync(':memory:'); migrate(db, 4);
  db.exec("INSERT INTO clients(name) VALUES ('Synthetic'); INSERT INTO projects(client_id,name) VALUES(1,'Project')");
  const before = db.prepare('SELECT * FROM projects').all();
  migrate(db); migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 6);
  assert.deepEqual(db.prepare('SELECT * FROM projects').all(), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM device_sessions').get()!.n, 0);
  db.close();
});
test('write-scope migration keeps existing device sessions, read-only', () => {
  const db = new DatabaseSync(':memory:'); migrate(db, 5);
  db.exec("INSERT INTO device_sessions(token_hash,credential_binding,device_name,created_at,expires_at) VALUES('h','b','Phone',1,2)");
  migrate(db);
  assert.deepEqual({...db.prepare('SELECT device_name AS name, scope FROM device_sessions').get()}, {name:'Phone', scope:'read'});
  db.close();
});
test('new device sessions can write', () => {
  assert.equal(createDeviceSession('Phone', NOW).scope, 'write');
  assert.equal(verifyDeviceSession(createDeviceSession('Tablet', NOW).token, NOW)?.scope, 'write');
});
