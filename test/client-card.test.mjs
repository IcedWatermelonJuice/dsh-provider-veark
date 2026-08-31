/**
 * client 卡片冒烟测试：在 Node 里模拟 window.__ModuleLoader__ 与 require，
 * 验证 client bundle 的工厂执行、槽位注册、表单暂存/保存语义与密钥写只读控件。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadClientBundle() {
  const source = readFileSync(join(import.meta.dirname, "..", "lib", "client.js"), "utf8");
  const registered = [];
  globalThis.window = { __ModuleLoader__: { load(definition) { registered.push(definition); } } };
  new Function(source)();
  assert.equal(registered.length, 1);
  const { id, factory } = registered[0];
  assert.equal(id, "@icedcola/dsh-provider-veark");
  const fakeReact = { createElement: (type, props) => ({ type, props, children: [] }), useState: (init) => [init, () => {}] };
  const stores = [];
  const fakeRuntime = {
    createSnapshotStore(initial) {
      const store = { value: initial, listeners: new Set(),
        set(next) { store.value = next; for (const l of store.listeners) l(); },
        getSnapshot() { return store.value; },
        subscribe(listener) { store.listeners.add(listener); return () => store.listeners.delete(listener); } };
      stores.push(store);
      return store;
    }
  };
  const exports = factory((spec) => {
    if (spec === "react") return fakeReact;
    if (spec === "@deepseek-ai/dsh-client-runtime/client") return fakeRuntime;
    throw new Error("unexpected require: " + spec);
  });
  return { exports, stores };
}

function makeScope(initialValue) {
  const scope = { namespace: "dsh-provider-veark", value: initialValue ?? { preferFiles: true }, base: {}, user: {}, status: "ready", writable: true, listeners: new Set(),
    getSnapshot() { return { status: scope.status, writable: scope.writable, value: scope.value, base: scope.base, user: scope.user }; },
    subscribe(listener) { scope.listeners.add(listener); return () => scope.listeners.delete(listener); },
    async set(field, value) { const stored = JSON.parse(JSON.stringify(value)); scope.user = { ...scope.user, [field]: stored }; scope.value = { ...scope.value, [field]: stored }; for (const l of scope.listeners) l(); return true; },
    async unset(field) { const next = { ...scope.user }; delete next[field]; scope.user = next; for (const l of scope.listeners) l(); return true; } };
  return scope;
}

function makeCtx(scope, credentialLog) {
  const ctx = { card: null };
  ctx.effect = (fn) => fn();
  ctx.get = (name) => name === "connection" ? ctx.connection : name === "remote" ? ctx.remote : undefined;
  ctx.locale = { bind: () => (key) => key, register: (ns, dict) => { ctx.localeRegistered = { ns, dict }; } };
  ctx.connection = { api: { credentials: {
    set: async ({ ref, value }) => { credentialLog.sets.push({ ref, value }); return { result: { ok: true } }; },
    describe: async ({ refs }) => ({ result: { ok: true, value: { credentials: { [refs[0]]: { configured: credentialLog.sets.some((s) => s.ref === refs[0]), writable: true } } } } })
  } } };
  ctx.remote = { $on: () => () => {} };
  ctx.settingsScope = { bind: () => scope };
  ctx.slots = {
    inject: (name, thunk) => { for (const registration of thunk()) ctx.card = registration; },
    register: (options, component) => ({ options, component })
  };
  return ctx;
}

const ATTACHMENT_ID = "sha256:" + "a".repeat(64);
const ALL_FIELDS = ["preferFiles","apiKeyEnv","chatBaseURL","filesBaseURL","filesApiKeyEnv","requestImagePixelBudget","requestImageMaxBytes","fileExpirySeconds","filesApiTimeoutMs","filesProbeIntervalMs"];

describe("client 卡片", () => {
  test("工厂注册 + apply 挂载：注册进 settings.plugin.item，key=命名空间", () => {
    const { exports } = loadClientBundle();
    assert.equal(exports.inject.includes("slots"), true);
    assert.equal(exports.inject.includes("settingsScope"), true);
    assert.equal(exports.inject.includes("connection"), true);
    const log = { sets: [] };
    const ctx = makeCtx(makeScope(), log);
    exports.apply(ctx);
    assert.equal(ctx.localeRegistered.ns, "dsh-provider-veark");
    assert.equal(ctx.card.options.key, "dsh-provider-veark");
  });

  test("inject 面含 hooks、动作与全部字段；密钥状态默认未配置", () => {
    const { exports } = loadClientBundle();
    const log = { sets: [] };
    const ctx = makeCtx(makeScope(), log);
    exports.apply(ctx);
    const bag = ctx.card.options.inject();
    assert.ok(bag.hooks.vearkCard);
    assert.equal(typeof bag.save, "function");
    assert.equal(typeof bag.edit, "function");
    const snapshot = bag.hooks.vearkCard.getSnapshot();
    for (const field of ALL_FIELDS) assert.ok(Object.hasOwn(snapshot.fields, field), "缺字段 " + field);
    assert.equal(snapshot.keyConfigured, false);
    assert.ok(snapshot.keyValue && typeof snapshot.keyValue.text === "string", "投影必须含顶层 keyValue");
    assert.equal(snapshot.keyRef, "ARK_API_KEY");
  });

  test("暂存 → 保存：写回 scope.set；清空 → unset", async () => {
    const { exports } = loadClientBundle();
    const log = { sets: [] };
    const scope = makeScope();
    const ctx = makeCtx(scope, log);
    exports.apply(ctx);
    const bag = ctx.card.options.inject();
    bag.edit("chatBaseURL", "https://example.invalid/coding/v3");
    bag.editBool("preferFiles", false);
    bag.edit("requestImageMaxBytes", "2097152");
    const models = bag.hooks.vearkCard.getSnapshot().models.slice();
    models[0] = Object.assign({}, models[0], { _contextRaw: "2M", contextWindow: 2000000, _maxRaw: "256K", maxTokens: 256000 });
    bag.editModels(models);
    assert.equal(bag.hooks.vearkCard.getSnapshot().dirty, true);
    await bag.save();
    assert.equal(scope.user.chatBaseURL, "https://example.invalid/coding/v3");
    assert.equal(scope.user.preferFiles, false);
    assert.equal(scope.user.requestImageMaxBytes, 2097152);
    assert.equal(scope.user.models[0].contextWindow, 2000000);
    assert.equal(scope.user.models[0].maxTokens, 256000);
    assert.equal(bag.hooks.vearkCard.getSnapshot().dirty, false);
    bag.edit("chatBaseURL", "");
    await bag.save();
    assert.equal(Object.hasOwn(scope.user, "chatBaseURL"), false);
  });

    test("模型列表：默认 ark-code-latest 不可删除，新增模型可保存", async () => {
      const { exports } = loadClientBundle();
      const log = { sets: [] };
      const scope = makeScope();
      const ctx = makeCtx(scope, log);
      exports.apply(ctx);
      const bag = ctx.card.options.inject();
      const initial = bag.hooks.vearkCard.getSnapshot().models;
      assert.equal(initial.length, 1);
      assert.equal(initial[0].id, "ark-code-latest");
      assert.equal(initial[0].name, "Ark Code Latest");
      assert.equal(initial[0].contextWindow, 1000000);
      assert.equal(initial[0].maxTokens, 128000);
      assert.deepEqual(initial[0].inputModalities, ["text", "image"]);
      bag.removeModel(0);
      assert.equal(bag.hooks.vearkCard.getSnapshot().models.length, 1, "默认模型不可删除");
      bag.addModel();
      let models = bag.hooks.vearkCard.getSnapshot().models.slice();
      models[1] = Object.assign({}, models[1], { id: "my-model", name: "My Model", _contextRaw: "1M", contextWindow: 1000000, _maxRaw: "128K", maxTokens: 128000, _contextInvalid: false, _maxInvalid: false, inputModalities: ["text", "image"] });
      bag.editModels(models);
      assert.equal(bag.hooks.vearkCard.getSnapshot().dirty, true);
      await bag.save();
      assert.equal(scope.user.models.length, 2);
      assert.equal(scope.user.models[1].id, "my-model");
      assert.equal(scope.user.models[1].name, "My Model");
    });


  test("非法数字阻止保存（草稿保留）", async () => {
    const { exports } = loadClientBundle();
    const scope = makeScope();
    const ctx = makeCtx(scope, { sets: [] });
    exports.apply(ctx);
    const bag = ctx.card.options.inject();
    bag.edit("requestImageMaxBytes", "not-a-number");
    assert.equal(bag.hooks.vearkCard.getSnapshot().invalid, true);
    await bag.save();
    assert.equal(Object.hasOwn(scope.user, "requestImageMaxBytes"), false);
    assert.equal(bag.hooks.vearkCard.getSnapshot().dirty, true);
  });

  describe("密钥值写只读控件", () => {
    test("填写密钥并保存 → credentials.set 以当前引用写入；留空不写", async () => {
      const { exports } = loadClientBundle();
      const log = { sets: [] };
      const ctx = makeCtx(makeScope(), log);
      exports.apply(ctx);
      const bag = ctx.card.options.inject();
      bag.edit("keyValue", "sk-live-123");
      await bag.save();
      assert.deepEqual(log.sets, [{ ref: "ARK_API_KEY", value: "sk-live-123" }]);
      await bag.save();
      assert.equal(log.sets.length, 1, "留空不重复写入");
    });
    test("apiKeyEnv 已自定义时，密钥写入该引用", async () => {
      const { exports } = loadClientBundle();
      const log = { sets: [] };
      const scope = makeScope({ apiKeyEnv: "MY_CUSTOM_REF" });
      scope.user = { apiKeyEnv: "MY_CUSTOM_REF" };
      const ctx = makeCtx(scope, log);
      exports.apply(ctx);
      const bag = ctx.card.options.inject();
      bag.edit("keyValue", "sk-x");
      await bag.save();
      assert.deepEqual(log.sets, [{ ref: "MY_CUSTOM_REF", value: "sk-x" }]);
    });
  });
});