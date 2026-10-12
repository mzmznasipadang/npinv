import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, displayStatus, formatDate, formatNumber, isValidDate, nextSequence, today } from "./rules.ts";

test("today is the date in Jakarta, not UTC", () => {
  assert.equal(today(new Date("2026-10-12T16:59:59Z")), "2026-10-12");
  assert.equal(today(new Date("2026-10-12T17:00:00Z")), "2026-10-13"); // midnight in Jakarta
});

test("addDays crosses month and year ends", () => {
  assert.equal(addDays("2026-10-12", 14), "2026-10-26");
  assert.equal(addDays("2026-10-25", 14), "2026-11-08");
  assert.equal(addDays("2026-12-25", 14), "2027-01-08");
  assert.equal(addDays("2026-10-12", 0), "2026-10-12");
});

test("isValidDate accepts real dates only", () => {
  assert.equal(isValidDate("2026-10-12"), true);
  assert.equal(isValidDate("2028-02-29"), true);
  assert.equal(isValidDate("2026-02-30"), false);
  assert.equal(isValidDate("2026-13-01"), false);
  assert.equal(isValidDate("12/10/2026"), false);
  assert.equal(isValidDate(""), false);
});

test("formatDate writes the month in words", () => {
  assert.equal(formatDate("2026-10-12"), "12 October 2026");
  assert.equal(formatDate("2027-01-05"), "5 January 2027");
});

test("a sent invoice is overdue the day after its due date", () => {
  assert.equal(displayStatus("sent", "2026-10-11", "2026-10-12"), "overdue");
  assert.equal(displayStatus("sent", "2026-10-12", "2026-10-12"), "sent"); // due today is not overdue
  assert.equal(displayStatus("sent", "2026-10-13", "2026-10-12"), "sent");
});

test("drafts and paid invoices are never overdue", () => {
  assert.equal(displayStatus("draft", "2026-01-01", "2026-10-12"), "draft");
  assert.equal(displayStatus("paid", "2026-01-01", "2026-10-12"), "paid");
});

test("numbers are prefix, year and a sequence padded to three digits", () => {
  assert.equal(formatNumber("INV", "2026", 1), "INV-2026-001");
  assert.equal(formatNumber("INV", "2026", 42), "INV-2026-042");
  assert.equal(formatNumber("INV", "2026", 1000), "INV-2026-1000");
});

test("next sequence is one above the highest for that prefix and year", () => {
  const numbers = ["INV-2026-001", "INV-2026-009", "INV-2025-050"];
  assert.equal(nextSequence(numbers, "INV", "2026"), 10);
  assert.equal(nextSequence(numbers, "INV", "2025"), 51);
});

test("a new year starts again at one", () => {
  assert.equal(nextSequence(["INV-2026-120"], "INV", "2027"), 1);
  assert.equal(nextSequence([], "INV", "2026"), 1);
});

test("sequences above 999 compare as numbers, not text", () => {
  assert.equal(nextSequence(["INV-2026-999", "INV-2026-1000"], "INV", "2026"), 1001);
});

test("numbers in another format are ignored", () => {
  assert.equal(nextSequence(["INV-2026-abc", "ABC-2026-005", "INV-2026-", "custom"], "INV", "2026"), 1);
});
