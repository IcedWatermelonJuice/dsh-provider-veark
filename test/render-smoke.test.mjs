import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
function makeElement(type, props) { const args = []; for (let i = 2; i < arguments.length; i++) args.push(arguments[i]); const kids = args.length === 1 && Array.isArray(args[0]) ? args[0] : args; return { type, props, children: kids }; }
function loadClientBundle() {
  const source = readFileSync(join(import.meta.dirname, "..", "lib", "client.js"), "utf8");
  const registered = [];
  globalThis.window = { __ModuleLoader__: { load(d) { registered.push(d); } } };
  new Function(source)();
  const fakeReact = { createElement: makeElement, useState: (init) => [init, () => {}] };
  const fakeRuntime = { createSnapshotStore: (initial) => ({ value: initial, listeners: new Set(), set() {}, getSnapshot() { return initial; }, subscribe() { return () => {}; } }) };
  return registered[0].factory((spec) => {
    if (spec === "react") return fakeReact;
    if (spec === "@deepseek-ai/dsh-client-runtime/client") return fakeRuntime;
    throw new Error("unexpected require: " + spec);
  });
}
test("collapsible card renders with built-in chrome", () => {
  const exports = loadClientBundle();
  const ctx = { card: null, get: () => undefined, remote: { $on: () => () => {} } };
  ctx.effect = (fn) => fn();
  ctx.locale = { bind: () => (k) => k, register: () => {} };
  const scope = { value: { preferFiles: true }, base: {}, user: {}, status: "ready", writable: true };
  ctx.settingsScope = { bind: () => ({ getSnapshot: () => ({ status: "ready", writable: true, value: scope.value, base: {}, user: {} }), subscribe: () => () => {}, set: async () => {}, unset: async () => {} }) };
  ctx.slots = { inject: (name, thunk) => { for (const r of thunk()) ctx.card = r; }, register: (options, component) => ({ options, component }) };
  exports.apply(ctx);
  const fields = {};
  for (const f of ["preferFiles","apiKeyEnv","chatBaseURL","filesBaseURL","filesApiKeyEnv","requestImagePixelBudget","requestImageMaxBytes","fileExpirySeconds","filesApiTimeoutMs","filesProbeIntervalMs"]) fields[f] = f === "preferFiles" ? { checked: true, overridden: false, invalid: false } : { text: "", overridden: false, invalid: false };
  const props = { t: (k) => k, useVearkCard: (sel) => sel({ available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false, fields, keyValue: { text: "", overridden: false, invalid: false }, keyRef: "ARK_API_KEY", keyConfigured: false, keyWritable: true, models: [], modelsInvalid: false }), edit() {}, editBool() {}, resetField() {}, editModels() {}, addModel() {}, removeModel() {}, save() {}, discard() {}, specsOf() { return {}; } };
  const card = ctx.card.component;
  const li = card(props);
  assert.equal(li.type, "li");
  assert.ok(String(li.props.className).includes("YyYd_a_card"), "内置同源类名");
  assert.ok(!String(li.props.className).includes("YyYd_a_cardOpen"), "默认收起");
  assert.equal(li.children[1], null, "收起时不渲染表单");
  const header = li.children[0];
  assert.equal(header.props.type, "button");
  assert.equal(header.props["aria-expanded"], false);
  assert.ok(String(header.props.className).includes("YyYd_a_header"));
  const headerKids = header.children;
  const chev = headerKids[2];
  assert.ok(String(chev.props.className).includes("YyYd_a_chevron"));
  const svg = chev.children[0];
  assert.equal(svg.type, "svg");
  assert.equal(svg.props.fill, "currentColor");
  assert.ok(String(svg.children[0].props.d).startsWith("M11.8486 5.5"), "内置 chevron path 原样复用");
});