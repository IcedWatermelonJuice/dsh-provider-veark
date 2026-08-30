/**
 * dsh-provider-veark 单元测试（mock HTTP，node:test）。
 * 覆盖实施方案 §7.1：上传成功→file_id；上传 403/超时→降级；服务端拒绝 file_id→降级；
 * 无图零 files 调用；归一化预算生效；resolveModel 校验；外加 SSE 翻译与状态机。
 */
import assert from "node:assert/strict";
import { test, describe, beforeEach, afterEach } from "node:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { VeArkAdapter } from "../lib/adapter.js";
import { resolveAdapterOptions, Config, apply, PROVIDER } from "../lib/index.js";
import { VeArkFileStore, VeArkUploadIndex } from "../lib/pipeline.js";
import { FilesModeController, FilesStateStore } from "../lib/policy.js";
import { providerRejectedFileId, providerRejectedNormalizedImage } from "../lib/adapter.js";
import { classifyFilesFailure } from "../lib/files-api.js";

const TMP_ROOT = join(import.meta.dirname, "tmp");
mkdirSync(TMP_ROOT, { recursive: true });
const ATTACHMENT_ID = "sha256:" + "a".repeat(64);
const VARIANT_ID = "sha256:" + "b".repeat(64);
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function tempDir() {
	return mkdtempSync(join(TMP_ROOT, "case-"));
}

/** 构造一个可注入 files 客户端替身与 Responses 客户端替身的 adapter。 */
function makeAdapter({ responsesClient, client, preferFiles = true, mode, tmp, models } = {}) {
	const options = resolveAdapterOptions({
		models: models ?? [{
			id: "ark-code-latest",
			name: "Ark Code Latest",
			contextWindow: 1000000,
			maxTokens: 128000,
			inputModalities: ["text", "image"],
			imagePixelBudget: 640000,
			imageMaxBytes: 1048576
		}],
		preferFiles,
		filesApiTimeoutMs: 15000
	});
	const index = new VeArkUploadIndex(join(tmp ?? tempDir(), "files-index.json"));
	const files = new VeArkFileStore({
		index,
		createClient: client ? () => client : undefined
	});
	return new VeArkAdapter({
		options: () => options,
		resolveApiKey: async () => "test-key",
		resolveFilesApiKey: async () => "test-key",
		resolveAttachments: () => attachments,
		files,
		mode: mode ?? new FilesModeController({ store: new FilesStateStore(join(tmp ?? tempDir(), "files-state.json")) }),
		createResponsesClient: responsesClient ? () => responsesClient : undefined
	});
}

function attachmentsWith(calls, policySeen) {
	return {
		async readImageRequest(ref, policy, signal) {
			calls.readImageRequest = (calls.readImageRequest ?? 0) + 1;
			Object.assign(policySeen ?? {}, policy);
			if (signal?.aborted) throw new Error("aborted");
			return {
				attachment: ref,
				variantId: VARIANT_ID,
				data: PNG_BYTES,
				bytes: PNG_BYTES.byteLength,
				mediaType: "image/png",
				width: 64,
				height: 64,
				hasAlpha: false
			};
		}
	};
}
const calls = {};
const policySeen = {};
const attachments = attachmentsWith(calls, policySeen);

const userText = (text) => ({ role: "user", content: [{ type: "text", text }] });
const userImage = () => ({ role: "user", content: [{ type: "text", text: "看这张图" }, { type: "image", attachment: { attachmentId: ATTACHMENT_ID, bytes: PNG_BYTES.byteLength, name: "shot.png" } }] });

function responsesStream(events) {
	return (async function* () {
		for (const event of events) yield event;
	})();
}

/**
 * 模拟 ArkRuntimeClient.createResponsesStream()：接收已解析的 Responses 事件对象。
 * error 可以是 Error，也可以是 (callIndex) => Error | null；后者用于“首次抛错、重试成功”。
 */
function fakeResponsesClient({ events = [], error } = {}) {
	const state = { calls: 0, bodies: [], options: [] };
	return {
		state,
		async createResponsesStream(body, opts) {
			state.calls += 1;
			state.bodies.push(body);
			state.options.push(opts);
			const err = typeof error === "function" ? error(state.calls) : error;
			if (err) throw err;
			return responsesStream(events);
		}
	};
}

function arkError(status, code, message) {
	return Object.assign(new Error(message), {
		name: "ArkAPIError",
		httpStatusCode: status,
		status,
		code,
		type: "invalid_request_error",
		requestId: "req_test"
	});
}

const COMPLETED = {
	type: "response.completed",
	response: {
		id: "resp_1",
		usage: {
			input_tokens: 100,
			output_tokens: 20,
			input_tokens_details: { cached_tokens: 40 },
			output_tokens_details: { reasoning_tokens: 5 },
			total_tokens: 120
		}
	}
};

async function collect(stream) {
	const chunks = [];
	for await (const chunk of stream) chunks.push(chunk);
	return chunks;
}

function fakeFilesClient({ uploadError, uploadCalls = { value: 0 }, deleteCalls = { value: 0 }, fileCounter = { value: 0 } } = {}) {
	return {
		async upload({ data, mediaType, filename, signal }) {
			uploadCalls.value += 1;
			if (signal?.aborted) throw new Error("aborted");
			if (uploadError) throw uploadError();
			fileCounter.value += 1;
			return {
				object: "file",
				id: `file-test-${fileCounter.value}`,
				purpose: "user_data",
				filename,
				bytes: data.byteLength,
				mime_type: mediaType,
				created_at: 1700000000,
				expire_at: 1700604800,
				status: "active"
			};
		},
		async retrieveFile(id) {
			return { object: "file", id, purpose: "user_data", filename: "f", created_at: 1700000000, status: "active" };
		},
		async listFiles() {
			return { object: "list", data: [], has_more: false };
		},
		async deleteFile(id) {
			deleteCalls.value += 1;
			return { object: "file", id, deleted: true };
		}
	};
}

describe("resolveModel / 目录契约", () => {
	beforeEach(() => { calls.readImageRequest = 0; });
	test("resolveModel 返回 §4.1 契约结构", async () => {
		const adapter = makeAdapter({});
		const info = await adapter.resolveModel("volcengine", "ark-code-latest");
		assert.equal(info.provider, "volcengine");
		assert.equal(info.id, "ark-code-latest");
		assert.equal(info.name, "Ark Code Latest");
		assert.deepEqual(info.inputModalities, ["text", "image"]);
		assert.equal(info.context.contextWindow, 1000000);
		assert.equal(info.defaultMaxTokens, 128000);
		assert.deepEqual(info.reasoning.efforts.map((e) => e.id), ["minimal", "low", "medium", "high"]);
		assert.equal(info.reasoning.defaultEffort, "medium");
	});
	test("未知模型回退 text-only 且沿用 adapter 默认", async () => {
		const adapter = makeAdapter({});
		const info = await adapter.resolveModel("volcengine", "unknown-model");
		assert.deepEqual(info.inputModalities, ["text"]);
		assert.equal(info.defaultMaxTokens, 128000);
	});
	test("listModels 含图片模态声明（能力门依赖）", async () => {
		const adapter = makeAdapter({});
		const models = await adapter.listModels("volcengine");
		assert.ok(models.every((m) => m.provider === "volcengine"));
		const ark = models.find((m) => m.id === "ark-code-latest");
		assert.deepEqual(ark.inputModalities, ["text", "image"]);
	});
	test("listModels 包含 UI 新增的模型", async () => {
		const adapter = makeAdapter({
			models: [
				{ id: "ark-code-latest", name: "Ark Code Latest", contextWindow: 1000000, maxTokens: 128000, inputModalities: ["text", "image"], imagePixelBudget: 640000, imageMaxBytes: 1048576 },
				{ id: "my-model", name: "My Model", contextWindow: 2000000, maxTokens: 256000, inputModalities: ["text"] }
			]
		});
		const models = await adapter.listModels("volcengine");
		const added = models.find((m) => m.id === "my-model");
		assert.ok(added, "UI 新增模型应出现在 listModels 结果中");
		assert.equal(added.name, "My Model");
		assert.deepEqual(added.inputModalities, ["text"]);
	});
});

describe("文本链路（无图）", () => {
	beforeEach(() => { calls.readImageRequest = 0; });
	test("纯文本请求：SDK Responses 流翻译出 text 块 + usage + finish stop，零 files 调用", async () => {
		const filesClient = fakeFilesClient({ uploadCalls: (calls.files = { value: 0 }) });
		const responses = fakeResponsesClient({
			events: [
				{ type: "response.created", response: { id: "resp_1" } },
				{ type: "response.output_item.added", output_index: 0, item: { type: "message", role: "assistant" } },
				{ type: "response.output_text.delta", output_index: 0, delta: "Hello" },
				{ type: "response.output_text.delta", output_index: 0, delta: " world" },
				{ type: "response.output_item.done", output_index: 0, item: { type: "message", content: [{ type: "output_text", text: "Hello world" }], id: "msg_1" } },
				COMPLETED
			]
		});
		const adapter = makeAdapter({ responsesClient: responses, client: filesClient });
		const chunks = await collect(adapter.stream({ model: "ark-code-latest", messages: [userText("你好")] }));
		assert.deepEqual(chunks.filter((c) => c.type === "block-start"), [{ type: "block-start", index: 0, blockType: "text" }]);
		assert.deepEqual(chunks.filter((c) => c.type === "text-delta").map((c) => c.text), ["Hello", " world"]);
		const end = chunks.find((c) => c.type === "block-end");
		assert.deepEqual(end.block, { type: "text", text: "Hello world" });
		const usage = chunks.find((c) => c.type === "usage");
		assert.equal(usage.usage.inputTokens, 60); // 100 - 40 cached
		assert.equal(usage.usage.outputTokens, 20);
		assert.equal(usage.usage.cacheReadTokens, 40);
		assert.equal(usage.usage.reasoningTokens, 5);
		assert.deepEqual(chunks.at(-1), { type: "finish", reason: { kind: "stop" } });
		assert.equal(calls.files.value, 0, "无图消息不得调用 files");
		assert.equal(responses.state.calls, 1, "文本链路应调用一次 createResponsesStream");
		const body = responses.state.bodies[0];
		assert.equal(body.model, "ark-code-latest");
		assert.equal(body.stream, true);
		assert.equal(body.store, false);
		assert.deepEqual(body.input[0], { role: "user", content: [{ type: "input_text", text: "你好" }] });
		assert.ok(String(responses.state.options[0].customHeaders["user-agent"]).includes("deepseek-harness"));
	});
	test("reasoningEffort 会写入 Responses 请求体 reasoning.effort", async () => {
		const responses = fakeResponsesClient({
			events: [
				{ type: "response.output_text.delta", output_index: 0, delta: "ok" },
				{ type: "response.output_item.done", output_index: 0, item: { type: "message", content: [{ type: "output_text", text: "ok" }] } },
				COMPLETED
			]
		});
		const adapter = makeAdapter({ responsesClient: responses, client: fakeFilesClient() });
		await collect(adapter.stream({ model: "ark-code-latest", reasoningEffort: "high", messages: [userText("hi")] }));
		assert.deepEqual(responses.state.bodies[0].reasoning, { effort: "high" });
	});
	test("工具调用：function_call 翻译为 tool-call 块，finish=tool-calls", async () => {
		const responses = fakeResponsesClient({
			events: [
				{ type: "response.output_item.added", output_index: 0, item: { type: "function_call", call_id: "call_1", name: "read_file", arguments: "" } },
				{ type: "response.function_call_arguments.delta", output_index: 0, delta: '{"path":' },
				{ type: "response.function_call_arguments.delta", output_index: 0, delta: '"a.txt"}' },
				{ type: "response.output_item.done", output_index: 0, item: { type: "function_call", call_id: "call_1", name: "read_file", arguments: '{"path":"a.txt"}' } },
				COMPLETED
			]
		});
		const adapter = makeAdapter({ responsesClient: responses, client: fakeFilesClient() });
		const chunks = await collect(adapter.stream({ model: "ark-code-latest", messages: [userText("读文件")] }));
		const start = chunks.find((c) => c.type === "block-start");
		assert.equal(start.blockType, "tool-call");
		const deltas = chunks.filter((c) => c.type === "tool-call-delta");
		assert.equal(deltas.reduce((acc, d) => acc + d.argumentsDelta, ""), '{"path":"a.txt"}');
		assert.equal(deltas[0].id, "call_1");
		assert.equal(deltas[0].name, "read_file");
		const end = chunks.find((c) => c.type === "block-end");
		assert.deepEqual(end.block, { type: "tool-call", id: "call_1", name: "read_file", arguments: '{"path":"a.txt"}' });
		assert.deepEqual(chunks.at(-1), { type: "finish", reason: { kind: "tool-calls" } });
	});
	test("流未终止即结束 → STREAM_CLOSED", async () => {
		const responses = fakeResponsesClient({
			events: [{ type: "response.output_text.delta", output_index: 0, delta: "partial" }]
		});
		const adapter = makeAdapter({ responsesClient: responses, client: fakeFilesClient() });
		await assert.rejects(collect(adapter.stream({ model: "ark-code-latest", messages: [userText("hi")] })), (error) => error.code === "STREAM_CLOSED");
	});
	test("空响应（stop 且无内容）→ EMPTY_RESPONSE 错误 finish", async () => {
		const responses = fakeResponsesClient({
			events: [{ type: "response.completed", response: { id: "resp_1" } }]
		});
		const adapter = makeAdapter({ responsesClient: responses, client: fakeFilesClient() });
		const chunks = await collect(adapter.stream({ model: "ark-code-latest", messages: [userText("hi")] }));
		assert.equal(chunks.at(-1).reason.kind, "error");
		assert.equal(chunks.at(-1).reason.failure.code, "EMPTY_RESPONSE");
	});
	test("SDK 非 2xx 错误 → LlmError（AUTH/RATE_LIMIT/SERVER 映射）", async () => {
		const responses = fakeResponsesClient({ error: arkError(401, "InvalidApiKey", "bad key") });
		const adapter = makeAdapter({ responsesClient: responses, client: fakeFilesClient() });
		await assert.rejects(collect(adapter.stream({ model: "ark-code-latest", messages: [userText("hi")] })), (error) => error.code === "AUTH");
	});
});

describe("图片管线（Files API 优先）", () => {
	beforeEach(() => { calls.readImageRequest = 0; Object.keys(policySeen).forEach((k) => delete policySeen[k]); });
	test("上传成功 → 消息引用 file_id，状态记录 files-ok", async () => {
		const tmp = tempDir();
		const statePath = join(tmp, "files-state.json");
		const mode = new FilesModeController({ store: new FilesStateStore(statePath) });
		const uploadCalls = { value: 0 };
		const responses = fakeResponsesClient({
			events: [
				{ type: "response.output_text.delta", output_index: 0, delta: "ok" },
				{ type: "response.output_item.done", output_index: 0, item: { type: "message", content: [{ type: "output_text", text: "ok" }] } },
				COMPLETED
			]
		});
		const adapter = makeAdapter({ responsesClient: responses, client: fakeFilesClient({ uploadCalls }), mode, tmp });
		const chunks = await collect(adapter.stream({ model: "ark-code-latest", messages: [userImage()] }));
		assert.equal(chunks.at(-1).reason.kind, "stop");
		assert.equal(uploadCalls.value, 1);
		const body = responses.state.bodies[0];
		const content = body.input[0].content;
		const imagePart = content.find((part) => part.type === "input_image");
		assert.ok(imagePart.file_id.startsWith("file-test-"), "files 模式必须引用 file_id");
		assert.equal(imagePart.image_url, undefined);
		assert.ok(content.some((part) => part.type === "input_text" && part.text.includes("request image 64x64px")), "图片前应有文本句柄");
		assert.equal(calls.readImageRequest, 1);
		assert.deepEqual(policySeen, { maxPixels: 640000, maxBytes: 1048576 }, "归一化预算按 §4.4 传递");
		const state = JSON.parse(readFileSync(statePath, "utf8"));
		assert.equal(state.mode, "files");
	});
	test("上传 403 → 自动降级 base64，状态原因正确（files-unavailable）", async () => {
		const tmp = tempDir();
		const statePath = join(tmp, "files-state.json");
		const mode = new FilesModeController({ store: new FilesStateStore(statePath) });
		const responses = fakeResponsesClient({
			events: [
				{ type: "response.output_text.delta", output_index: 0, delta: "ok" },
				{ type: "response.output_item.done", output_index: 0, item: { type: "message", content: [{ type: "output_text", text: "ok" }] } },
				COMPLETED
			]
		});
		const client = fakeFilesClient({ uploadError: () => Object.assign(new Error("denied"), { name: "ApiException", status: 403, data: { error: { code: "AccessDenied", message: "not authorized" } } }) });
		const adapter = makeAdapter({ responsesClient: responses, client, mode, tmp });
		const chunks = await collect(adapter.stream({ model: "ark-code-latest", messages: [userImage()] }));
		assert.equal(chunks.at(-1).reason.kind, "stop", "降级后请求必须成功（零硬失败）");
		const body = responses.state.bodies[0];
		const imagePart = body.input[0].content.find((part) => part.type === "input_image");
		assert.match(imagePart.image_url, /^data:image\/png;base64,/);
		assert.equal(imagePart.file_id, undefined);
		const state = JSON.parse(readFileSync(statePath, "utf8"));
		assert.equal(state.mode, "base64");
		assert.ok(state.reason.includes("403"), `原因应含 HTTP 403，实际: ${state.reason}`);
	});
	test("上传超时 → 降级 base64 且原因标记 timeout", async () => {
		const tmp = tempDir();
		const statePath = join(tmp, "files-state.json");
		const mode = new FilesModeController({ store: new FilesStateStore(statePath) });
		const responses = fakeResponsesClient({
			events: [
				{ type: "response.output_text.delta", output_index: 0, delta: "ok" },
				{ type: "response.output_item.done", output_index: 0, item: { type: "message", content: [{ type: "output_text", text: "ok" }] } },
				COMPLETED
			]
		});
		const client = fakeFilesClient({ uploadError: () => Object.assign(new Error("timeout of 15000ms exceeded"), { code: "ECONNABORTED" }) });
		const adapter = makeAdapter({ responsesClient: responses, client, mode, tmp });
		const chunks = await collect(adapter.stream({ model: "ark-code-latest", messages: [userImage()] }));
		assert.equal(chunks.at(-1).reason.kind, "stop");
		const state = JSON.parse(readFileSync(statePath, "utf8"));
		assert.equal(state.mode, "base64");
		assert.match(state.reason, /timeout/);
	});
	test("服务端拒绝 file_id（错误详情命中正则）→ 失效索引并 base64 重试", async () => {
		const tmp = tempDir();
		const mode = new FilesModeController({ store: new FilesStateStore(join(tmp, "files-state.json")) });
		const responses = fakeResponsesClient({
			events: [
				{ type: "response.output_text.delta", output_index: 0, delta: "ok" },
				{ type: "response.output_item.done", output_index: 0, item: { type: "message", content: [{ type: "output_text", text: "ok" }] } },
				COMPLETED
			],
			error: (call) => call === 1 ? arkError(400, "InvalidParameter", "file file-test-1 expired or deleted") : null
		});
		const deleteCalls = { value: 0 };
		const adapter = makeAdapter({ responsesClient: responses, client: fakeFilesClient({ deleteCalls }), mode, tmp });
		const chunks = await collect(adapter.stream({ model: "ark-code-latest", messages: [userImage()] }));
		assert.equal(chunks.at(-1).reason.kind, "stop");
		assert.equal(responses.state.calls, 2, "必须以 base64 重试一次");
		const first = responses.state.bodies[0];
		const second = responses.state.bodies[1];
		assert.ok(first.input[0].content.some((p) => p.type === "input_image" && p.file_id));
		assert.ok(second.input[0].content.some((p) => p.type === "input_image" && p.image_url.startsWith("data:")));
		assert.equal(deleteCalls.value, 0, "被拒不是删除远端文件的信号（invalidate 只清索引）");
	});
	test("preferFiles=false → 恒 base64，零 files 调用，不写状态", async () => {
		const tmp = tempDir();
		const statePath = join(tmp, "files-state.json");
		const mode = new FilesModeController({ store: new FilesStateStore(statePath) });
		const uploadCalls = { value: 0 };
		const responses = fakeResponsesClient({
			events: [
				{ type: "response.output_text.delta", output_index: 0, delta: "ok" },
				{ type: "response.output_item.done", output_index: 0, item: { type: "message", content: [{ type: "output_text", text: "ok" }] } },
				COMPLETED
			]
		});
		const adapter = makeAdapter({ responsesClient: responses, client: fakeFilesClient({ uploadCalls }), preferFiles: false, mode, tmp });
		const chunks = await collect(adapter.stream({ model: "ark-code-latest", messages: [userImage()] }));
		assert.equal(chunks.at(-1).reason.kind, "stop");
		assert.equal(uploadCalls.value, 0);
		const body = responses.state.bodies[0];
		assert.ok(body.input[0].content.some((p) => p.type === "input_image" && p.image_url.startsWith("data:")));
		assert.equal(existsSync(statePath), false, "preferFiles=false 不得写状态");
	});
	test("tool-result 图片：文本进 function_call_output，图片跟随在之后的 user 消息", async () => {
		const tmp = tempDir();
		const mode = new FilesModeController({ store: new FilesStateStore(join(tmp, "files-state.json")) });
		const responses = fakeResponsesClient({
			events: [
				{ type: "response.output_text.delta", output_index: 0, delta: "ok" },
				{ type: "response.output_item.done", output_index: 0, item: { type: "message", content: [{ type: "output_text", text: "ok" }] } },
				COMPLETED
			]
		});
		const adapter = makeAdapter({ responsesClient: responses, client: fakeFilesClient(), mode, tmp });
		await collect(adapter.stream({
			model: "ark-code-latest",
			messages: [{
				role: "user",
				content: [{ type: "tool-result", toolCallId: "call_9", content: [{ type: "text", text: "screenshot" }, { type: "image", attachment: { attachmentId: ATTACHMENT_ID, bytes: 8, name: "x.png" } }] }]
			}]
		}));
		const input = responses.state.bodies[0].input;
		const output = input.find((item) => item.type === "function_call_output");
		assert.equal(output.call_id, "call_9");
		assert.ok(output.output.includes("screenshot"));
		const later = input.find((item) => item.role === "user" && Array.isArray(item.content) && item.content.some((p) => p.type === "input_image"));
		assert.ok(later, "tool-result 图片应作为其后的 user 消息发送");
		assert.ok(later.content.some((p) => p.type === "input_text" && p.text.includes("Attached image(s)")));
	});
});

describe("降级状态机", () => {
	test("base64 降级后在探测间隔内不再探测，间隔过后重新尝试 files", async () => {
		const tmp = tempDir();
		const store = new FilesStateStore(join(tmp, "files-state.json"));
		let now = 1000000;
		const mode = new FilesModeController({ store, now: () => now });
		await mode.recordFilesUnavailable("files auth HTTP 403");
		assert.deepEqual(await mode.decide(true, 6 * 3600 * 1000), { representation: "base64", probing: false });
		now += 6 * 3600 * 1000 - 1;
		assert.deepEqual(await mode.decide(true, 6 * 3600 * 1000), { representation: "base64", probing: false });
		now += 1;
		assert.deepEqual(await mode.decide(true, 6 * 3600 * 1000), { representation: "file", probing: true });
		await mode.recordFilesOk();
		assert.deepEqual(await mode.decide(true, 6 * 3600 * 1000), { representation: "file", probing: true });
		assert.deepEqual(await mode.decide(false, 6 * 3600 * 1000), { representation: "base64", probing: false });
	});
	test("错误分类：403→auth、404→notfound、ECONNABORTED→timeout、NetworkError→network", () => {
		assert.equal(classifyFilesFailure({ status: 403 }).kind, "auth");
		assert.equal(classifyFilesFailure({ status: 404 }).kind, "notfound");
		assert.equal(classifyFilesFailure({ code: "ECONNABORTED", message: "timeout" }).kind, "timeout");
		assert.equal(classifyFilesFailure({ name: "NetworkError" }).kind, "network");
		assert.equal(classifyFilesFailure({ status: 500 }).kind, "server");
	});
	test("file_id 拒绝正则（deepseek 同构）", () => {
		assert.ok(providerRejectedFileId("InvalidParameter file file-1 expired"));
		assert.ok(providerRejectedFileId("file_id not found"));
		assert.ok(providerRejectedFileId("invalid file_id"));
		assert.ok(!providerRejectedFileId("image too large"));
		assert.ok(providerRejectedNormalizedImage("failed to decode image"));
	});
});

describe("配置与装配", () => {
	test("Config 默认值：模型目录含 ark-code-latest 且声明图片模态", () => {
		const resolved = Config({});
		assert.equal(resolved.apiKeyEnv, "ARK_API_KEY");
		assert.equal(resolved.preferFiles, true);
		const ark = resolved.models.find((m) => m.id === "ark-code-latest");
		assert.deepEqual(ark.inputModalities, ["text", "image"]);
		assert.equal(ark.contextWindow, 1000000);
		assert.equal(ark.maxTokens, 128000);
	});
	test("resolveAdapterOptions 支持由 UI 模型列表保存的缺省图片预算条目", () => {
		const resolved = resolveAdapterOptions({ models: [{ id: "my-model", name: "My Model", contextWindow: 1000000, maxTokens: 128000, inputModalities: ["text", "image"] }] });
		const model = resolved.models.find((m) => m.id === "my-model");
		assert.equal(model.contextWindow, 1000000);
		assert.equal(model.maxTokens, 128000);
		assert.deepEqual(model.inputModalities, ["text", "image"]);
		assert.equal(model.imagePixelBudget, 640000, "图片模型缺省图片预算应自动填充");
		assert.equal(model.imageMaxBytes, 1048576);
	});
	test("resolveAdapterOptions 边界校验", () => {
		assert.throws(() => resolveAdapterOptions({ fileExpirySeconds: 10 }), /fileExpirySeconds/);
		assert.throws(() => resolveAdapterOptions({ imageOffloadByteQuantum: 200, maxRequestFilesBytes: 100 }), /imageOffloadByteQuantum/);
		assert.throws(() => resolveAdapterOptions({ chatBaseURL: "" }), /chatBaseURL/);
	});
	test("apply 冒烟：注册 provider + adapter，设置分区可安装", () => {
		const registered = { adapters: [], configurable: [] };
		const ctx = {
			get: () => undefined,
			logger: { info() {}, warn() {}, error() {} },
			inject(services, cb) { /* 无 settings 服务 → 不安装 */ },
			llm: {
				registerConfigurableProviders(entries) { registered.configurable.push(...entries); return { replace() {} }; },
				registerAdapter(providers, adapter) { registered.adapters.push(...providers); return { replace() {} }; }
			}
		};
		apply(ctx, {});
		assert.deepEqual(registered.adapters, [PROVIDER]);
		assert.equal(registered.configurable[0].provider, PROVIDER);
		assert.equal(registered.configurable[0].displayName, "火山方舟 Coding Plan");
		assert.equal(registered.configurable[0].settingsNs, "dsh-provider-veark");
	});
	test("SDK 导入冒烟：ArkRuntimeClient 可构造（ESM 兼容）", async () => {
		const { ArkRuntimeClient } = await import("@volcengine/ark-runtime");
		const client = new ArkRuntimeClient({ apiKey: "dummy", baseURL: "https://example.invalid/api/v3", timeout: 1000, retryTimes: 0 });
		assert.ok(typeof client.uploadFile === "function");
	});
});
