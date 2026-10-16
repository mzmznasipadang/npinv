import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getDb } from './db.ts';
import { deviceCredentialBinding, SESSION_SECONDS } from './auth.ts';

export type DeviceSession = { id: number; deviceName: string; createdAt: string; expiresAt: string; scope: 'read' | 'write' };
type Row = { id: number; deviceName: string; createdAt: number; expiresAt: number; tokenHash: string; binding: string; scope: 'read' | 'write' };
const COLS = 'id, device_name AS deviceName, created_at AS createdAt, expires_at AS expiresAt, token_hash AS tokenHash, credential_binding AS binding, scope';
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
function validBinding(row: Row): boolean {
  const current = deviceCredentialBinding(row.tokenHash);
  return current !== null && current.length === row.binding.length && timingSafeEqual(Buffer.from(current), Buffer.from(row.binding));
}
function metadata(row: Row): DeviceSession {
  return { id: row.id, deviceName: row.deviceName, createdAt: new Date(row.createdAt).toISOString(), expiresAt: new Date(row.expiresAt).toISOString(), scope: row.scope };
}
export function createDeviceSession(deviceName: string, now = Date.now()): DeviceSession & { token: string } {
  if (!deviceName.trim() || deviceName.trim().length > 100) throw new Error('Enter a device name up to 100 characters.');
  const token = randomBytes(32).toString('hex');
  const tokenHash = hash(token); const binding = deviceCredentialBinding(tokenHash);
  if (binding === null) throw new Error('Mobile login is not configured.');
  const expiresAt = now + SESSION_SECONDS * 1000;
  // Signing in proves the admin password, so new sessions may write. Sessions from before writes existed stay 'read'.
  const result = getDb().prepare("INSERT INTO device_sessions(token_hash,credential_binding,device_name,created_at,expires_at,scope) VALUES(?,?,?,?,?,'write')").run(tokenHash, binding, deviceName.trim(), now, expiresAt);
  return { id: Number(result.lastInsertRowid), deviceName: deviceName.trim(), createdAt: new Date(now).toISOString(), expiresAt: new Date(expiresAt).toISOString(), scope: 'write', token };
}
export function verifyDeviceSession(token: string | undefined, now = Date.now()): DeviceSession | null {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = getDb().prepare(`SELECT ${COLS} FROM device_sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`).get(hash(token), now) as Row | undefined;
  return row && validBinding(row) ? metadata(row) : null;
}
export function listDeviceSessions(now = Date.now()): DeviceSession[] {
  return (getDb().prepare(`SELECT ${COLS} FROM device_sessions WHERE revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC, id DESC`).all(now) as Row[]).filter(validBinding).map(metadata);
}
export function revokeDeviceSession(id: number, now = Date.now()): boolean {
  return getDb().prepare('UPDATE device_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(now, id).changes > 0;
}
