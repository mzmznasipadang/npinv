import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "npinv_session";
export const SESSION_SECONDS = 60 * 60 * 24 * 30;

// The single admin password lives in the environment, never in the database or the repo.
// It also keys the session signature, so changing it signs everyone out.
function password(): string | null {
  const value = process.env.ADMIN_PASSWORD;
  return value && value.length >= 8 ? value : null;
}

/** Binds a device token hash to the current admin credential without storing it. */
export function deviceCredentialBinding(tokenHash: string): string | null {
  const key = password();
  return key === null ? null : createHmac("sha256", key).update(`npinv-device:${tokenHash}`).digest("hex");
}

function sign(expires: number, key: string): string {
  return createHmac("sha256", key).update(String(expires)).digest("hex");
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkPassword(attempt: string): boolean {
  const key = password();
  return key !== null && same(sign(0, attempt), sign(0, key));
}

export function createSession(now = Date.now()): string | null {
  const key = password();
  if (key === null) return null;
  const expires = Math.floor(now / 1000) + SESSION_SECONDS;
  return `${expires}.${sign(expires, key)}`;
}

export function verifySession(token: string | undefined, now = Date.now()): boolean {
  const key = password();
  if (key === null || !token) return false;
  const [expires, signature = ""] = token.split(".");
  const seconds = Number(expires);
  return Number.isInteger(seconds) && seconds > now / 1000 && same(signature, sign(seconds, key));
}
