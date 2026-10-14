import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPassword, createSession, verifySession } from "./auth.ts";

process.env.ADMIN_PASSWORD = "correct horse";

test("password check", () => {
  assert.equal(checkPassword("correct horse"), true);
  assert.equal(checkPassword("wrong"), false);
});

test("session round trip, expiry and tampering", () => {
  const now = 1_700_000_000_000;
  const token = createSession(now)!;
  assert.equal(verifySession(token, now), true);
  assert.equal(verifySession(token, now + 31 * 24 * 3600 * 1000), false);
  assert.equal(verifySession(token.replace(/.$/, "0"), now), false);
  assert.equal(verifySession(undefined, now), false);
});

test("fails closed without a password", () => {
  const token = createSession()!;
  delete process.env.ADMIN_PASSWORD;
  assert.equal(verifySession(token), false);
  assert.equal(checkPassword(""), false);
});
