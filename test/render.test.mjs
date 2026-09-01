/**
 * 真实 React 渲染冒烟：用 renderToString 驱动卡片组件的两个状态（收起/展开），
 * 捕获"投影缺字段 → 渲染抛错 → 槽位渲染 data-slot-error"这类假 React 测不出的问题。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadCard(openState) {
  const source = readFileSync(join(import.meta.dirname, "..", "lib", "client.js"), "utf8");
  const registered = [];
  globalThis.window = { __ModuleLoader__: { load(d) { registered.push(d); } } };
  globalThis.document = { querySelector: () => null, createElement: () => ({ dataset: {} }), head: { appendChild: () => {} } };
  new Function(source)();
  const exports = registered[0].factory((spec) => {
    if (spec === "react") return openState ? Object.assign(Object.create(React), React, { useState: () => [true, () => {}] }) : React;
    if (spec === "@deepseek-ai/dsh-client-runtime/client") return { createSnapshotStore: (initial) => ({ value: initial, listeners: new Set(), set() {}, getSnapshot() { return initial; }, subscribe() { return () => {}; } }) };
    throw new Error("unexpected require: " + spec);
  });
  const fields = {};
  for (const f of ["preferFiles","apiKeyEnv","chatBaseURL","filesBaseURL","filesApiKeyEnv","requestImagePixelBudget","requestImageMaxBytes","fileExpirySeconds","filesApiTimeoutMs","filesProbeIntervalMs","pdfRetentionDays"]) fields[f] = f === "preferFiles" ? { checked: true, overridden: false, invalid: false } : { text: "", overridden: false, invalid: false };
  const specs = {};
  for (const f of ["preferFiles","apiKeyEnv","chatBaseURL","filesBaseURL","filesApiKeyEnv","requestImagePixelBudget","requestImageMaxBytes","fileExpirySeconds","filesApiTimeoutMs","filesProbeIntervalMs","pdfRetentionDays"]) specs[f] = f === "preferFiles" ? { kind: "bool" } : { kind: "text" };
  const state = { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false, keyConfigured: false, keyWritable: true, keyRef: "ARK_API_KEY", keyValue: { text: "", overridden: false, invalid: false }, fields, models: [{ id: "ark-code-latest", name: "Ark Code Latest", contextWindow: 1000000, maxTokens: 128000, inputModalities: ["text", "image", "pdf"], _contextRaw: "1M", _maxRaw: "128K", _contextInvalid: false, _maxInvalid: false }], modelsInvalid: false };
  const props = { t: (k) => k, useVearkCard: (sel) => sel(state), edit: () => {}, editBool: () => {}, resetField: () => {}, save: () => {}, discard: () => {}, editModels: () => {}, addModel: () => {}, removeModel: () => {}, specsOf: () => specs };
  const ctx = { card: null, remote: { $on: () => () => {} }, effect(fn) { fn(); }, inject(names, callback) { callback(ctx); }, get: (n) => n === "connection" ? { api: { credentials: { describe: async () => ({ result: { ok: true, value: { credentials: { ARK_API_KEY: { configured: false, writable: true } } } } }) } } } : undefined, locale: { bind: () => (k) => k, register() {} }, settingsScope: { bind: () => ({ getSnapshot: () => ({ status: "ready", writable: true, value: { preferFiles: true }, base: {}, user: {} }), subscribe: () => () => {}, set: async () => {}, unset: async () => {} }) }, slots: { inject: (name, thunk) => { for (const r of thunk()) ctx.card = r; }, register: (options, component) => ({ options, component }) } };
  exports.apply(ctx);
  return ctx.card.component;
}

describe("真实 React 渲染", () => {
  test("收起态：仅 header，无表单", () => {
    const card = loadCard(false);
    const F = { text: "", overridden: false, invalid: false };
    const fields = { preferFiles: { checked: true, overridden: false, invalid: false }, apiKeyEnv: F, chatBaseURL: F, filesBaseURL: F, filesApiKeyEnv: F, requestImagePixelBudget: F, requestImageMaxBytes: F, fileExpirySeconds: F, filesApiTimeoutMs: F, filesProbeIntervalMs: F, pdfRetentionDays: F };
    const state = { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false, keyConfigured: false, keyWritable: true, keyRef: "ARK_API_KEY", keyValue: F, fields };
    const props = { t: (k) => k, useVearkCard: (sel) => sel(state), edit: () => {}, editBool: () => {}, resetField: () => {}, save: () => {}, discard: () => {}, specsOf: () => ({}) };
    const html = renderToString(React.createElement(card, props));
    assert.ok(html.includes("YyYd_a_card"), "内置同源类名");
    assert.ok(!html.includes("groupEndpoints"), "收起时不渲染分组");
  });
  test("展开态：密钥值控件 + 分组 + 保存按钮齐全且不抛错", () => {
    const card = loadCard(true);
    const F = { text: "", overridden: false, invalid: false };
    const fields = { preferFiles: { checked: true, overridden: false, invalid: false }, apiKeyEnv: F, chatBaseURL: F, filesBaseURL: F, filesApiKeyEnv: F, requestImagePixelBudget: F, requestImageMaxBytes: F, fileExpirySeconds: F, filesApiTimeoutMs: F, filesProbeIntervalMs: F, pdfRetentionDays: F };
    const state = { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false, keyConfigured: false, keyWritable: true, keyRef: "ARK_API_KEY", keyValue: F, fields, models: [{ id: "ark-code-latest", name: "Ark Code Latest", contextWindow: 1000000, maxTokens: 128000, inputModalities: ["text", "image", "pdf"], _contextRaw: "1M", _maxRaw: "128K", _contextInvalid: false, _maxInvalid: false }], modelsInvalid: false };
    const props = { t: (k) => k, useVearkCard: (sel) => sel(state), edit: () => {}, editBool: () => {}, resetField: () => {}, save: () => {}, discard: () => {}, editModels: () => {}, addModel: () => {}, removeModel: () => {}, specsOf: () => ({ preferFiles: { kind: "bool" }, apiKeyEnv: { kind: "text" }, chatBaseURL: { kind: "text" }, filesBaseURL: { kind: "text" }, filesApiKeyEnv: { kind: "text" }, requestImagePixelBudget: { kind: "number" }, requestImageMaxBytes: { kind: "number" }, fileExpirySeconds: { kind: "number" }, filesApiTimeoutMs: { kind: "number" }, filesProbeIntervalMs: { kind: "number" }, pdfRetentionDays: { kind: "number" } }) };
    const html = renderToString(React.createElement(card, props));
    assert.ok(html.includes("password"), "密钥值密码框");
    assert.ok(html.includes("groupEndpoints"), "折叠分组");
    assert.ok(html.includes("modelList"), "模型列表小节");
    assert.ok(html.includes(">pdf<"), "模型能力列表包含 pdf");
    assert.ok(html.includes("addModel"), "新增模型按钮");
    assert.ok(html.length > 4000, "展开态应有完整表单输出");
  });
});
