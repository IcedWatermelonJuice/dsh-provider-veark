/**
 * dsh-provider-veark/adapter — VeArkAdapter：火山方舟 Coding Plan 的
 * Responses API（POST {chatBaseURL}/responses，SSE 流式）适配器。
 *
 * 契约实现以 dsh-llm-deepseek 的 DeepSeekAdapter 为模板（deepseek:1332-1571）：
 * - providerInfo / providerRetryPolicy / listModels / resolveModel / prepareCall / stream；
 * - 图片：Files API 优先（input_image + file_id），上传失败或服务端拒绝 file_id
 *   时自动降级 base64 data URL（铁律 3：图片消息零硬失败）；
 * - 文本链路：与 pi-ai 路由同端点、同模型、同 wire 形状（openai-responses）。
 *
 * @module dsh-provider-veark/adapter
 */
import {
	CallId,
	CONTEXT_WINDOW_EXCEEDED_CODE,
	EMPTY_RESPONSE_CODE,
	ProviderRequestId,
	QUOTA_EXCEEDED_CODE,
	ReasoningEffortId,
	LlmAdapter,
	LlmError,
	attributionHeaders,
	contentHasImage,
	isContextWindowExceededError,
	isQuotaExceededError,
	offloadRequestImagesWithPolicy
} from "@deepseek-ai/dsh-llm";
import { ArkRuntimeClient } from "@volcengine/ark-runtime";
import { deadline, idleWatchdog, timeoutOf } from "@deepseek-ai/dsh-timeout";
import { filesFailureReason } from "./files-api.js";
import {
	FileResolutionFailure,
	imageWireParts,
	prepareRequestImages
} from "./pipeline.js";
import { resolveRequestImagePolicy } from "./policy.js";

/** 默认流空闲看门狗间隔（deepseek 同值）。 */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 3e5;
/** 默认上下文窗口（ark-code-latest 目录值，实施方案 §4.1）。 */
export const DEFAULT_CONTEXT_WINDOW = 1e6;
/** 默认单请求输出上限。 */
export const DEFAULT_MAX_TOKENS = 128000;
/** files 模式下累计 file 引用图字节预算（deepseek 同值）。 */
export const DEFAULT_MAX_REQUEST_FILES_BYTES = 128 * 1024 * 1024;
/** base64 降级后的累计内联图字节预算（deepseek 同值）。 */
export const DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024;
/** 单请求图片数量上限。 */
export const DEFAULT_MAX_IMAGES_PER_REQUEST = 600;
/** raw 字节移除步长。 */
export const DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM = 64 * 1024 * 1024;
/** base64 字节移除步长。 */
export const DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM = 10 * 1024 * 1024;
/** 数量移除步长。 */
export const DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM = 20;

const STREAM_IDLE_TIMEOUT_CODE = "LLM_STREAM_IDLE_TIMEOUT";
const FILES_API_TIMEOUT_CODE = "VEARK_FILES_API_TIMEOUT";
/** OpenAI Responses 协议的输出 token 下限（pi-ai 同值）。 */
const MIN_OUTPUT_TOKENS = 16;
/** tool-result 图片在 wire 上跟随的说明文本（deepseek 同值）。 */
const TOOL_RESULT_IMAGE_TEXT = "Attached image(s) from tool result:";

/**
 * 默认 Responses 客户端工厂：直接使用官方 @volcengine/ark-runtime 的
 * `createResponsesStream()`。timeout=0 表示不设 HTTP 层总超时，由 DSH 的
 * 流空闲看门狗（streamIdleTimeoutMs）负责终止。
 */
function defaultCreateResponsesClient(connection, apiKey) {
	return new ArkRuntimeClient({
		apiKey,
		baseURL: connection.chatBaseURL,
		timeout: 0,
		retryTimes: 0
	});
}

/** 默认模型目录（ark-code-latest，实施方案 §4.1）。 */
export const DEFAULT_MODELS = [
	{
		id: "ark-code-latest",
		name: "Ark Code Latest",
		contextWindow: DEFAULT_CONTEXT_WINDOW,
		maxTokens: DEFAULT_MAX_TOKENS,
		inputModalities: ["text", "image"],
		imagePixelBudget: 64e4,
		imageMaxBytes: 1024 * 1024
	}
];

/** Ark Responses API 支持的思考等级（@volcengine/ark-runtime ReasoningEffort）。 */
const REASONING_EFFORTS = [
	{ id: ReasoningEffortId("minimal"), name: "Minimal" },
	{ id: ReasoningEffortId("low"), name: "Low" },
	{ id: ReasoningEffortId("medium"), name: "Medium" },
	{ id: ReasoningEffortId("high"), name: "High" }
];
const DEFAULT_REASONING_EFFORT = ReasoningEffortId("medium");

function flattenText(blocks) {
	return blocks.filter((block) => block.type === "text").map((block) => block.text).join("");
}

/** 角色检查：图片内容只能出现在 user 消息（deepseek:50 同构）。 */
function assertSupportedImageRoles(messages) {
	for (const message of messages) if (message.role !== "user" && contentHasImage(message.content)) throw new LlmError(`The Ark adapter cannot represent image content in a ${message.role} message.`, "UNSUPPORTED_CONTENT");
}

/** Responses API 的 user 内容始终用数组形式（pi-ai 现网形状）。 */
async function userContentItems(blocks, requestImages, representation, resolveFileId, messageIndex, nextImage) {
	const parts = [];
	for (const block of blocks) {
		if (block.type === "text") {
			if (block.text.length > 0) parts.push({ type: "input_text", text: block.text });
			continue;
		}
		if (block.type === "image") {
			nextImage.value += 1;
			const version = requestImages.get(block.attachment.attachmentId);
			if (version === void 0) throw new LlmError(`veark request image ${block.attachment.attachmentId} was not prepared.`, "INVALID_REQUEST");
			const fileId = representation === "file" ? await resolveFileId(version, { message: messageIndex, image: nextImage.value }) : void 0;
			parts.push(...imageWireParts(version, representation, fileId));
		}
	}
	return parts;
}

/** assistant 消息回放：message item + function_call items（reasoning 不回放）。 */
function assistantItems(message, messageIndex) {
	const text = flattenText(message.content);
	const items = [];
	if (text.length > 0) items.push({
		type: "message",
		role: "assistant",
		content: [{ type: "output_text", text, annotations: [] }],
		status: "completed",
		id: `msg_veark_${messageIndex}`
	});
	for (const block of message.content) if (block.type === "tool-call") items.push({
		type: "function_call",
		call_id: block.id,
		name: block.name,
		arguments: typeof block.arguments === "string" ? block.arguments : JSON.stringify(block.arguments ?? {})
	});
	return items;
}

/** 组装 Responses `input` 项（图片项经 files/base64 管线产出）。 */
async function buildInputItems(options, representation, requestImages, resolveFileId) {
	const items = [];
	if (options.system !== void 0 && options.system.length > 0) items.push({ role: "system", content: options.system });
	let pendingToolImages = [];
	const flushToolImages = () => {
		if (pendingToolImages.length === 0) return;
		items.push({ role: "user", content: [{ type: "input_text", text: TOOL_RESULT_IMAGE_TEXT }, ...pendingToolImages] });
		pendingToolImages = [];
	};
	for (const [messageIndex, message] of options.messages.entries()) {
		const nextImage = { value: 0 };
		if (message.role === "system") {
			flushToolImages();
			const text = flattenText(message.content);
			if (text.length > 0) items.push({ role: "system", content: text });
			continue;
		}
		if (message.role === "assistant") {
			flushToolImages();
			items.push(...assistantItems(message, messageIndex));
			continue;
		}
		const regular = message.content.filter((block) => block.type !== "tool-result");
		const toolResults = message.content.filter((block) => block.type === "tool-result");
		const content = await userContentItems(regular, requestImages, representation, resolveFileId, messageIndex + 1, nextImage);
		if (content.length > 0 || toolResults.length === 0) {
			flushToolImages();
			items.push({ role: "user", content });
		}
		for (const result of toolResults) {
			const parts = await userContentItems(result.content, requestImages, representation, resolveFileId, messageIndex + 1, nextImage);
			const imageParts = parts.filter((part) => part.type === "input_image");
			const text = parts.filter((part) => part.type === "input_text").map((part) => part.text).join("");
			items.push({
				type: "function_call_output",
				call_id: result.toolCallId,
				output: text || "(no output)"
			});
			pendingToolImages.push(...imageParts);
		}
	}
	flushToolImages();
	return items;
}

/** prompt_cache_key 收敛为 OpenAI 兼容字符集（pi-ai clampOpenAIPromptCacheKey 同效果）。 */
function promptCacheKey(sessionId) {
	if (sessionId === void 0) return void 0;
	const cleaned = String(sessionId).replace(/[^a-zA-Z0-9_-]/gu, "_").slice(0, 64).replace(/_+$/u, "");
	return cleaned.length > 0 ? cleaned : void 0;
}

/** 请求体（pi-ai openai-responses 现网参数集）。 */
function buildRequestBody(options, input) {
	const tools = options.tools?.map((tool) => ({
		type: "function",
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters
	}));
	const cacheKey = promptCacheKey(options.sessionId);
	return {
		model: options.model,
		input,
		stream: true,
		store: false,
		...(cacheKey === void 0 ? {} : { prompt_cache_key: cacheKey }),
		...(options.maxTokens === void 0 ? {} : { max_output_tokens: Math.max(MIN_OUTPUT_TOKENS, options.maxTokens) }),
		...(options.temperature === void 0 ? {} : { temperature: options.temperature }),
		...(options.reasoningEffort === void 0 ? {} : { reasoning: { effort: options.reasoningEffort } }),
		...(tools !== void 0 && tools.length > 0 ? { tools } : {})
	};
}

function mapResponsesUsage(usage) {
	const inputDetails = usage?.input_tokens_details;
	const cacheRead = inputDetails?.cached_tokens ?? 0;
	const cacheWrite = inputDetails?.cache_write_tokens ?? 0;
	const reasoning = usage?.output_tokens_details?.reasoning_tokens ?? 0;
	return {
		inputTokens: Math.max(0, (usage?.input_tokens ?? 0) - cacheRead - cacheWrite),
		outputTokens: usage?.output_tokens ?? 0,
		...(cacheRead > 0 ? { cacheReadTokens: cacheRead } : {}),
		...(reasoning > 0 ? { reasoningTokens: reasoning } : {})
	};
}

/** 把 Responses 事件流翻译为 harness StreamChunk（deepseek translate 的 Responses 对应物）。 */
async function* translateResponses(events, onActivity) {
	const slots = /* @__PURE__ */ new Map();
	const order = [];
	let nextIndex = 0;
	let pendingUsage;
	let finish;
	let sawTerminal = false;
	const openSlot = (outputIndex, kind, extra) => {
		const slot = {
			outputIndex,
			kind,
			index: nextIndex++,
			text: "",
			toolCallId: "",
			name: void 0,
			arguments: "",
			opened: false,
			...extra
		};
		slots.set(outputIndex, slot);
		order.push(slot);
		return slot;
	};
	const startChunk = (slot) => {
		if (slot.opened) return null;
		slot.opened = true;
		return { type: "block-start", index: slot.index, blockType: slot.kind };
	};
	const closeSlot = function* (slot, block) {
		const start = startChunk(slot);
		if (start !== null) yield start;
		yield { type: "block-end", index: slot.index, block };
	};
	const slotKind = (outputIndex, kind) => {
		const slot = slots.get(outputIndex);
		return slot?.kind === kind ? slot : void 0;
	};
	for await (const event of events) {
		if (onActivity) onActivity();
		const type = typeof event?.type === "string" && event.type.length > 0 ? event.type : "";
		if (type === "response.output_item.added") {
			const item = event.item;
			if (item?.type === "function_call") {
				const slot = openSlot(event.output_index, "tool-call", { toolCallId: item.call_id ?? item.id ?? "", name: item.name ?? "" });
				const start = startChunk(slot);
				if (start !== null) yield start;
			}
			continue;
		}
		if (type === "response.output_text.delta" || type === "response.refusal.delta") {
			const delta = typeof event.delta === "string" ? event.delta : "";
			if (delta.length === 0) continue;
			const slot = slotKind(event.output_index, "text") ?? openSlot(event.output_index, "text");
			const start = startChunk(slot);
			if (start !== null) yield start;
			slot.text += delta;
			yield { type: "text-delta", index: slot.index, text: delta };
			continue;
		}
		if (type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") {
			const delta = typeof event.delta === "string" ? event.delta : "";
			if (delta.length === 0) continue;
			const slot = slotKind(event.output_index, "reasoning") ?? openSlot(event.output_index, "reasoning");
			const start = startChunk(slot);
			if (start !== null) yield start;
			slot.text += delta;
			yield { type: "reasoning-delta", index: slot.index, text: delta };
			continue;
		}
		if (type === "response.reasoning_summary_part.done") {
			const slot = slotKind(event.output_index, "reasoning");
			if (slot !== void 0 && slot.opened) {
				slot.text += "\n\n";
				yield { type: "reasoning-delta", index: slot.index, text: "\n\n" };
			}
			continue;
		}
		if (type === "response.function_call_arguments.delta") {
			const slot = slotKind(event.output_index, "tool-call");
			if (slot === void 0) continue;
			const delta = typeof event.delta === "string" ? event.delta : "";
			slot.arguments += delta;
			if (delta.length > 0) yield {
				type: "tool-call-delta",
				index: slot.index,
				id: CallId(slot.toolCallId),
				...(slot.name !== void 0 && slot.name.length > 0 ? { name: slot.name } : {}),
				argumentsDelta: delta
			};
			continue;
		}
		if (type === "response.function_call_arguments.done") {
			const slot = slotKind(event.output_index, "tool-call");
			if (slot === void 0 || typeof event.arguments !== "string") continue;
			if (event.arguments.startsWith(slot.arguments)) {
				const delta = event.arguments.slice(slot.arguments.length);
				if (delta.length > 0) yield {
					type: "tool-call-delta",
					index: slot.index,
					id: CallId(slot.toolCallId),
					...(slot.name !== void 0 && slot.name.length > 0 ? { name: slot.name } : {}),
					argumentsDelta: delta
				};
			}
			slot.arguments = event.arguments;
			continue;
		}
		if (type === "response.output_item.done") {
			const item = event.item;
			const kind = item?.type === "reasoning" ? "reasoning" : item?.type === "function_call" ? "tool-call" : item?.type === "message" ? "text" : void 0;
			if (kind === void 0) continue;
			let slot = slots.get(event.output_index);
			if (slot === void 0) {
				if (kind === "text") {
					const text = (item.content ?? []).map((part) => part.text ?? part.refusal ?? "").join("");
					if (text.length === 0) continue;
					slot = openSlot(event.output_index, "text");
				} else if (kind === "tool-call") slot = openSlot(event.output_index, "tool-call", { toolCallId: item.call_id ?? item.id ?? "", name: item.name ?? "" });
				else slot = openSlot(event.output_index, "reasoning");
			}
			if (kind !== slot.kind) continue;
			if (kind === "text") {
				const text = (item.content ?? []).map((part) => part.type === "output_text" ? part.text : part.refusal ?? "").join("");
				if (text.length > 0) slot.text = text;
				yield* closeSlot(slot, { type: "text", text: slot.text });
			} else if (kind === "reasoning") {
				const summary = (item.summary ?? []).map((part) => part.text ?? "").join("\n\n");
				const content = (item.content ?? []).map((part) => part.text ?? "").join("\n\n");
				const text = summary || content || slot.text;
				if (slot.text.length > 0 || text.length > 0) yield* closeSlot(slot, { type: "reasoning", text });
			} else {
				if (typeof item.arguments === "string" && item.arguments.length > 0 && !slot.opened) {
					slot.arguments = item.arguments;
					const start = startChunk(slot);
					if (start !== null) yield start;
					yield {
						type: "tool-call-delta",
						index: slot.index,
						id: CallId(slot.toolCallId),
						...(slot.name !== void 0 && slot.name.length > 0 ? { name: slot.name } : {}),
						argumentsDelta: slot.arguments
					};
				} else if (typeof item.arguments === "string" && item.arguments.length > 0) slot.arguments = item.arguments;
				yield* closeSlot(slot, { type: "tool-call", id: CallId(slot.toolCallId), name: slot.name ?? "", arguments: slot.arguments });
			}
			slots.delete(event.output_index);
			continue;
		}
		if (type === "response.completed" || type === "response.incomplete") {
			sawTerminal = true;
			if (event.response?.usage) pendingUsage = mapResponsesUsage(event.response.usage);
			finish = type === "response.incomplete" ? { kind: "max-tokens" } : { kind: "stop" };
			continue;
		}
		if (type === "response.failed") {
			const error = event.response?.error;
			const details = event.response?.incomplete_details;
			const message = error ? `${error.code || "unknown"}: ${error.message || "no message"}` : details?.reason ? `incomplete: ${details.reason}` : "Ark Responses stream failed without error details";
			throw new LlmError(message, "SERVER");
		}
		if (type === "error") {
			throw new LlmError(`Ark Responses stream error ${event.code ?? ""}: ${event.message ?? "unknown"}`.replace(/\s+\s+/gu, " ").trim(), "SERVER");
		}
	}
	if (!sawTerminal) throw new LlmError("Ark Responses stream ended before a terminal response event", "STREAM_CLOSED");
	for (const slot of order.filter((candidate) => slots.has(candidate.outputIndex))) {
		if (slot.kind === "tool-call") yield* closeSlot(slot, { type: "tool-call", id: CallId(slot.toolCallId), name: slot.name ?? "", arguments: slot.arguments });
		else if (slot.text.length > 0 || slot.opened) yield* closeSlot(slot, slot.kind === "reasoning" ? { type: "reasoning", text: slot.text } : { type: "text", text: slot.text });
	}
	if (pendingUsage) yield { type: "usage", usage: pendingUsage };
	const reason = finish ?? { kind: "stop" };
	const hasToolCalls = order.some((slot) => slot.kind === "tool-call");
	const mapped = reason.kind === "stop" && hasToolCalls ? { kind: "tool-calls" } : reason;
	yield {
		type: "finish",
		reason: mapped.kind === "stop" && order.length === 0 ? {
			kind: "error",
			failure: { message: "model returned a completed response with no content", code: EMPTY_RESPONSE_CODE }
		} : mapped
	};
}

/** 从 SDK 错误里取 HTTP 状态（ArkAPIError/ArkRequestError 均带 httpStatusCode；0 视为无状态）。 */
function arkErrorStatus(error) {
	const status = typeof error?.httpStatusCode === "number" ? error.httpStatusCode : typeof error?.status === "number" ? error.status : void 0;
	return typeof status === "number" && status > 0 ? status : void 0;
}

/** 从 SDK 错误里取可用于分类的 provider 详情串。 */
function arkErrorDetail(error) {
	return [error?.code, error?.type, error?.message].filter((field) => typeof field === "string").join(" ");
}

/** 把非 2xx 状态映射为稳定 LlmError code（deepseek:1308 同构）。 */
function httpErrorCode(status, error) {
	if (status === 401 || status === 403) return "AUTH";
	if (status === 413) return "INVALID_REQUEST";
	const detail = [error?.code, error?.type, error?.message].filter(Boolean).join(" ");
	if (isQuotaExceededError(detail)) return QUOTA_EXCEEDED_CODE;
	if (status === 429) return "RATE_LIMIT";
	if (status === 400) {
		if (isContextWindowExceededError(detail)) return CONTEXT_WINDOW_EXCEEDED_CODE;
		return "INVALID_REQUEST";
	}
	if (status >= 500) return "SERVER";
	return `HTTP_${status}`;
}

/** 服务端拒绝 file_id 的详情识别（deepseek:1248 同构）。 */
export function providerRejectedFileId(detail) {
	const file = /\bfile(?:[_ -]?(?:id|api|not[_ -]?found|deleted|expired))?/iu.test(detail);
	const missing = /(?:expired|not[_ -]?found|deleted|do(?:es)? not exist|not created under (?:this|your) account|invalid)/iu.test(detail);
	const invalidId = /(?:invalid.{0,20}file[_ -]?(?:id|api)|file[_ -]?(?:id|api).{0,20}invalid)/iu.test(detail);
	return file && (missing || invalidId);
}

/** 服务端拒绝已归一图片的详情识别（deepseek:1245 同构）。 */
export function providerRejectedNormalizedImage(detail) {
	return /(?:unsupported|invalid|cannot read|failed to (?:decode|process)).{0,40}image/iu.test(detail) || /image.{0,40}(?:unsupported|invalid|cannot be decoded)/iu.test(detail);
}

function detailNamesFileId(detail, fileId) {
	let index = detail.indexOf(fileId);
	while (index >= 0) {
		const before = detail[index - 1];
		const after = detail[index + fileId.length];
		if ((before === void 0 || !/[\p{L}\p{N}_-]/u.test(before)) && (after === void 0 || !/[\p{L}\p{N}_-]/u.test(after))) return true;
		index = detail.indexOf(fileId, index + 1);
	}
	return false;
}

function staleMappings(files, detail) {
	const unique = [...new Map(files.map((file) => [`${file.version.variantId}\0${file.fileId}`, file])).values()];
	const exact = unique.filter((file) => detailNamesFileId(detail, file.fileId));
	return exact.length > 0 ? exact : unique;
}

function modelInfo(provider, model) {
	return {
		provider,
		id: model.id,
		name: model.name ?? model.id,
		...(model.description === void 0 ? {} : { description: model.description }),
		inputModalities: model.inputModalities ?? ["text"]
	};
}

/**
 * VeArkAdapter — 一个实例服务注册给它的全部 provider 路由。
 * 连接事实按请求从设置快照解析（prepareCall 绑定当代快照）。
 */
export var VeArkAdapter = class extends LlmAdapter {
	config;
	files;
	constructor(config) {
		super();
		this.config = config;
		this.files = config.files;
	}
	providerInfo(provider) {
		return { id: provider, name: "火山方舟 Coding Plan" };
	}
	providerRetryPolicy(_provider) {
		return this.config.options().retryPolicy;
	}
	listModels(provider) {
		return Promise.resolve(this.config.options().models.map((model) => modelInfo(provider, model)));
	}
	resolveModel(provider, model, _signal) {
		return Promise.resolve(this.modelInfoFor(this.config.options(), provider, model));
	}
	modelInfoFor(connection, provider, model) {
		const configured = connection.models.find((entry) => entry.id === model);
		const contextWindow = configured?.contextWindow ?? connection.defaultContextWindow;
		return {
			...(configured === void 0 ? {
				provider,
				id: model,
				name: model,
				inputModalities: ["text"]
			} : modelInfo(provider, configured)),
			context: { contextWindow },
			defaultMaxTokens: configured?.maxTokens ?? connection.maxTokens,
			reasoning: {
				efforts: REASONING_EFFORTS,
				defaultEffort: DEFAULT_REASONING_EFFORT
			}
		};
	}
	prepareCall(provider, model, _signal) {
		const connection = this.config.options();
		return Promise.resolve({
			model: this.modelInfoFor(connection, provider, model),
			stream: (options) => this.streamWithConnection(options, connection)
		});
	}
	stream(options) {
		return this.streamWithConnection(options, this.config.options());
	}
	async *streamWithConnection(options, connection) {
		const hasImages = options.messages.some((message) => contentHasImage(message.content));
		let attachments;
		if (hasImages) {
			if (connection.models.find((entry) => entry.id === options.model)?.inputModalities?.includes("image") !== true) throw new LlmError(`Ark model "${options.model}" does not accept image input.`, "UNSUPPORTED_CONTENT");
			attachments = this.config.resolveAttachments?.();
			if (attachments === void 0) throw new LlmError("veark image conversion requires the durable attachment service.", "UNSUPPORTED_CONTENT");
		}
		const apiKey = await this.config.resolveApiKey(connection);
		const consumer = new AbortController();
		const watchdog = idleWatchdog(options.signal === void 0 ? consumer.signal : AbortSignal.any([options.signal, consumer.signal]), connection.streamIdleTimeoutMs, STREAM_IDLE_TIMEOUT_CODE);
		try {
			const iterator = this.request(options, watchdog.signal, connection, apiKey, attachments, () => {
				watchdog.pulse();
			})[Symbol.asyncIterator]();
			let exhausted = false;
			try {
				while (true) {
					const result = await watchdog.next(iterator);
					if (result.done) {
						exhausted = true;
						return;
					}
					yield result.value;
				}
			} catch (error) {
				if (timeoutOf(watchdog.signal, STREAM_IDLE_TIMEOUT_CODE) !== void 0) throw new LlmError(`Ark stream idle timeout after ${connection.streamIdleTimeoutMs}ms`, "TIMEOUT", { cause: error });
				if (options.signal?.aborted) throw new LlmError("Ark request aborted by caller", "ABORTED", { cause: error });
				if (error instanceof LlmError) throw error;
				throw new LlmError(`Ark API stream from ${connection.chatBaseURL} failed`, "TRANSPORT", { cause: error });
			} finally {
				consumer.abort("veark stream consumer stopped");
				if (!exhausted && iterator.return !== void 0) try {
					await iterator.return();
				} catch {}
			}
		} finally {
			watchdog[Symbol.dispose]();
		}
	}
	async *request(options, signal, connection, apiKey, attachments, onActivity) {
		const filesApiKey = await this.config.resolveFilesApiKey(connection);
		const fileConnection = { baseURL: connection.filesBaseURL, apiKey: filesApiKey, timeoutMs: connection.filesApiTimeoutMs };
		const model = connection.models.find((entry) => entry.id === options.model);
		const policy = model === void 0 ? void 0 : resolveRequestImagePolicy(model);
		const hasImages = options.messages.some((message) => contentHasImage(message.content));
		const requestMessages = policy === void 0 ? options.messages : offloadRequestImagesWithPolicy(options.messages, {
			representation: "raw",
			maxBytes: connection.maxRequestFilesBytes,
			maxImages: connection.maxImagesPerRequest,
			byteQuantum: connection.imageOffloadByteQuantum,
			countQuantum: connection.imageOffloadCountQuantum,
			byteLength: (ref) => Math.min(ref.bytes, policy.maxBytes)
		});
		const requestOptions = requestMessages === options.messages ? options : { ...options, messages: [...requestMessages] };
		const requestImages = attachments === void 0 || model === void 0 || !hasImages ? /* @__PURE__ */ new Map() : await prepareRequestImages(requestOptions, attachments, model, signal);
		const decision = hasImages ? await this.config.mode.decide(connection.preferFiles, connection.filesProbeIntervalMs) : { representation: "base64", probing: false };
		let representation = decision.representation;
		let fileAttempt = 0;
		while (true) {
			const usedFiles = [];
			const resolveFileId = async (version, location) => {
				const filesDeadline = deadline(signal, connection.filesApiTimeoutMs, FILES_API_TIMEOUT_CODE);
				try {
					let resolved;
					try {
						resolved = await this.files.ensureUploaded(version, fileConnection, connection.filePolicy, filesDeadline.signal);
					} catch (error) {
						if (signal.aborted) throw error;
						throw new FileResolutionFailure(error);
					}
					onActivity();
					usedFiles.push({ version, fileId: resolved.record.fileId, location });
					return resolved.record.fileId;
				} finally {
					filesDeadline[Symbol.dispose]();
				}
			};
			let input;
			try {
				// base64 模式应用内联预算 offload（铁律 3：base64 超预算 → 移除最旧图片并注明）。
				const inlineMessages = representation === "base64" && policy !== void 0 ? offloadRequestImagesWithPolicy(requestOptions.messages, {
					representation: "base64",
					maxBytes: connection.maxInlineRequestImageBytes,
					maxImages: connection.maxImagesPerRequest,
					byteQuantum: connection.inlineImageOffloadByteQuantum,
					countQuantum: connection.imageOffloadCountQuantum,
					byteLength: (ref) => {
						const version = requestImages.get(ref.attachmentId);
						if (version === void 0) throw new LlmError(`veark request image ${ref.attachmentId} was not prepared.`, "INVALID_REQUEST");
						return version.bytes;
					}
				}) : requestOptions.messages;
				const serializeOptions = inlineMessages === requestOptions.messages ? requestOptions : { ...requestOptions, messages: [...inlineMessages] };
				input = await buildInputItems(serializeOptions, representation, requestImages, hasImages && attachments !== void 0 ? resolveFileId : void 0);
			} catch (error) {
				if (!(error instanceof FileResolutionFailure)) throw error;
				await this.config.mode.recordFilesUnavailable(filesFailureReason(error.cause ?? error));
				representation = "base64";
				continue;
			}
			const requestBody = buildRequestBody(requestOptions, input);
			const responsesClient = (this.config.createResponsesClient ?? defaultCreateResponsesClient)(connection, apiKey);
			let stream;
			try {
				stream = await responsesClient.createResponsesStream(requestBody, {
					signal,
					customHeaders: attributionHeaders()
				});
			} catch (error) {
				if (signal.aborted) throw error;
				const status = arkErrorStatus(error);
				const detail = arkErrorDetail(error);
				if (usedFiles.length > 0 && providerRejectedFileId(detail)) {
					await Promise.all(staleMappings(usedFiles, detail).map((file) => this.files.invalidate(file.version, file.fileId, fileConnection)));
					if (fileAttempt === 0) {
						fileAttempt += 1;
						await this.config.mode.recordFilesUnavailable(`provider rejected file_id reference (HTTP ${status})`);
						representation = "base64";
						continue;
					}
				}
				let message = error?.message || `Ark API error (HTTP ${status ?? "unknown"})`;
				if (status === 400 && usedFiles.length > 0 && providerRejectedNormalizedImage(detail)) message = `${message} — the provider rejected harness-normalized image bytes; PNG, JPEG, WebP, and GIF remain supported input formats.`;
				if (status === void 0) throw new LlmError(`Ark API request to ${connection.chatBaseURL} failed`, "TRANSPORT", { cause: error });
				throw new LlmError(message, httpErrorCode(status, error), {
					cause: error,
					status,
					...(error?.requestId ? { requestId: ProviderRequestId(error.requestId) } : {})
				});
			}
			try {
				yield* translateResponses(stream, onActivity);
			} catch (error) {
				if (signal.aborted) throw new LlmError("Ark request aborted by caller", "ABORTED", { cause: error });
				if (error instanceof LlmError) throw error;
				const status = arkErrorStatus(error);
				if (status === void 0) throw new LlmError(`Ark API stream from ${connection.chatBaseURL} failed`, "TRANSPORT", { cause: error });
				throw new LlmError(error?.message || `Ark API stream error (HTTP ${status})`, httpErrorCode(status, error), {
					cause: error,
					status,
					...(error?.requestId ? { requestId: ProviderRequestId(error.requestId) } : {})
				});
			}
			if (representation === "file" && usedFiles.length > 0) await this.config.mode.recordFilesOk();
			return;
		}
	}
};
