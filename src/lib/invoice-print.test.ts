import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml } from "./invoice-print.ts";

test("escapeHtml covers every character that can open markup or end an attribute", () => {
  assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), "&lt;a href=&quot;x&quot; title=&#x27;y&#x27;&gt;&amp;&lt;/a&gt;");
  assert.equal(escapeHtml(12), "12");
  assert.equal(escapeHtml("Rp 1.000 · ok"), "Rp 1.000 · ok");
});
