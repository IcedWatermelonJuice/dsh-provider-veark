/**
 * dsh-provider-veark — 火山方舟 Coding Plan LLM Provider 插件。
 *
 * 注册独立 provider `volcengine`（displayName「火山方舟 Coding Plan」），
 * 与现有 `volcengine-coding-plan`（dsh-llm-pi-ai）并存（铁律 2，注册重名会抛
 * DUPLICATE_ADAPTER）。连接事实（key/baseURL/模型目录/图片预算/files 策略）
 * 全部按请求从 `dsh-provider-veark:` 设置分区解析，不内联、不重启生效。
 *
 * @module dsh-provider-veark
 */
import z from "@deepseek-ai/schemastery";
import { LlmError, RetryPolicySchema, assertUsableApiKey, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { deepEqualJson, installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";
import {
	DEFAULT_CONTEXT_WINDOW,
	DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM,
	DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM,
	DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM,
	DEFAULT_MAX_IMAGES_PER_REQUEST,
	DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES,
	DEFAULT_MAX_REQUEST_FILES_BYTES,
	DEFAULT_MAX_TOKENS,
	DEFAULT_MODELS,
	DEFAULT_STREAM_IDLE_TIMEOUT_MS,
	VeArkAdapter
} from "./adapter.js";
import { DEFAULT_FILES_API_TIMEOUT_MS, DEFAULT_FILE_EXPIRY_SECONDS, DEFAULT_FILE_QUOTA_CLEANUP_BATCH, DEFAULT_FILE_REFRESH_MARGIN_SECONDS, DEFAULT_FILES_PROBE_INTERVAL_MS, DEFAULT_REQUEST_IMAGE_MAX_BYTES, DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET, FilesModeController } from "./policy.js";
import { VeArkFileStore } from "./pipeline.js";
import { DEFAULT_PDF_RETENTION_DAYS, VeArkPdfService, VeArkPdfStore } from "./pdf-store.js";

const name = "dsh-provider-veark";
const inject = ["llm"];
const NS = settingsNamespace("dsh-provider-veark");
/** 本插件独有的 provider 路由（不与 pi-ai 的 volcengine-coding-plan 重名）。 */
const PROVIDER = "volcengine";
const DEFAULT_API_KEY_ENV = "ARK_API_KEY";
const DEFAULT_CHAT_BASE_URL = "https://ark.cn-beijing.volces.com/api/coding/v3";
const DEFAULT_FILES_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

const MODEL_MODALITIES = ["text", "image"];
const catalogModel = z.object({
	id: z.string().required(),
	name: z.string(),
	description: z.string(),
	contextWindow: z.number().step(1).min(1),
	maxTokens: z.number().step(1).min(1),
	inputModalities: z.array(z.union(MODEL_MODALITIES)).min(1).default(["text"]),
	imagePixelBudget: z.number().step(1).min(1),
	imageMaxBytes: z.number().step(1).min(1),
	imageDetail: z.union(["auto", "low"])
});

/** Provider 设置 schema（schemastery），实施实施方案 §4.4。 */
const Config = z.object({
	apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV),
	filesApiKeyEnv: z.string().role("credential-ref").default(""),
	chatBaseURL: z.string().default(DEFAULT_CHAT_BASE_URL),
	filesBaseURL: z.string().default(DEFAULT_FILES_BASE_URL),
	models: z.array(catalogModel).default(DEFAULT_MODELS),
	preferFiles: z.boolean().default(true),
	requestImagePixelBudget: z.number().step(1).min(1).default(DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET),
	requestImageMaxBytes: z.number().step(1).min(1).default(DEFAULT_REQUEST_IMAGE_MAX_BYTES),
	fileExpirySeconds: z.number().step(1).min(3600).max(2592e3).default(DEFAULT_FILE_EXPIRY_SECONDS),
	filesApiTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_FILES_API_TIMEOUT_MS),
	filesProbeIntervalMs: z.number().step(1).min(60000).max(MAX_TIMER_DELAY_MS).default(DEFAULT_FILES_PROBE_INTERVAL_MS),
	pdfRetentionDays: z.number().step(1).min(0).max(3650).default(DEFAULT_PDF_RETENTION_DAYS),
	streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
	maxRequestFilesBytes: z.number().step(1).min(1).default(DEFAULT_MAX_REQUEST_FILES_BYTES),
	maxInlineRequestImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES),
	maxImagesPerRequest: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGES_PER_REQUEST),
	imageOffloadByteQuantum: z.number().step(1).min(1).default(DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM),
	inlineImageOffloadByteQuantum: z.number().step(1).min(1).default(DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM),
	imageOffloadCountQuantum: z.number().step(1).min(1).default(DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM),
	retryPolicy: RetryPolicySchema
});

/** 校验并填充模型目录（schemastery 会丢未知键，这里再判关键字段）。 */
function resolveModels(models, defaults) {
	const seen = /* @__PURE__ */ new Set();
	return (models ?? DEFAULT_MODELS).map((model) => {
		if (model.id.length === 0) throw new Error("dsh-provider-veark: catalog model ids must be non-empty");
		if (model.contextWindow !== void 0 && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) throw new Error(`dsh-provider-veark: catalog model "${model.id}" contextWindow must be a positive integer`);
		if (model.maxTokens !== void 0 && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) throw new Error(`dsh-provider-veark: catalog model "${model.id}" maxTokens must be a positive integer`);
		const inputModalities = model.inputModalities ?? ["text"];
		if (inputModalities.length === 0) throw new Error(`dsh-provider-veark: catalog model "${model.id}" inputModalities must not be empty`);
		if (inputModalities.some((modality) => !MODEL_MODALITIES.includes(modality))) throw new Error(`dsh-provider-veark: catalog model "${model.id}" inputModalities must contain only "text" and "image"`);
		if (new Set(inputModalities).size !== inputModalities.length) throw new Error(`dsh-provider-veark: catalog model "${model.id}" inputModalities must not contain duplicates`);
		const hasImage = inputModalities.includes("image");
		if (!hasImage && (model.imagePixelBudget !== void 0 || model.imageMaxBytes !== void 0 || model.imageDetail !== void 0)) throw new Error(`dsh-provider-veark: text-only catalog model "${model.id}" cannot declare image request limits`);
		if (model.imagePixelBudget !== void 0 && (!Number.isSafeInteger(model.imagePixelBudget) || model.imagePixelBudget <= 0)) throw new Error(`dsh-provider-veark: catalog model "${model.id}" imagePixelBudget must be a positive safe integer`);
		if (model.imageMaxBytes !== void 0 && (!Number.isSafeInteger(model.imageMaxBytes) || model.imageMaxBytes <= 0)) throw new Error(`dsh-provider-veark: catalog model "${model.id}" imageMaxBytes must be a positive safe integer`);
		if (seen.has(model.id)) throw new Error(`dsh-provider-veark: duplicate catalog model "${model.id}"`);
		seen.add(model.id);
		return {
			id: model.id,
			...(model.name !== void 0 && model.name.length > 0 ? { name: model.name } : {}),
			...(model.description === void 0 ? {} : { description: model.description }),
			...(model.contextWindow === void 0 ? {} : { contextWindow: model.contextWindow }),
			...(model.maxTokens === void 0 ? {} : { maxTokens: model.maxTokens }),
			inputModalities: [...inputModalities],
			...(hasImage ? {
				imagePixelBudget: model.imagePixelBudget ?? defaults.requestImagePixelBudget,
				imageMaxBytes: model.imageMaxBytes ?? defaults.requestImageMaxBytes,
				...(model.imageDetail === void 0 ? {} : { imageDetail: model.imageDetail })
			} : {})
		};
	});
}

/**
 * 显式校验步骤：程序化构造可绕过 schemastery，所有默认与边界在此重判
 * （加载时 fail loud；每个设置快照在首次使用时重验）。保持 last-good 语义由 apply 控制。
 */
function resolveAdapterOptions(config) {
	const requestImagePixelBudget = config.requestImagePixelBudget ?? DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET;
	if (!Number.isSafeInteger(requestImagePixelBudget) || requestImagePixelBudget <= 0) throw new Error("dsh-provider-veark: requestImagePixelBudget must be a positive safe integer");
	const requestImageMaxBytes = config.requestImageMaxBytes ?? DEFAULT_REQUEST_IMAGE_MAX_BYTES;
	if (!Number.isSafeInteger(requestImageMaxBytes) || requestImageMaxBytes <= 0) throw new Error("dsh-provider-veark: requestImageMaxBytes must be a positive safe integer");
	const streamIdleTimeoutMs = config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;
	if (!Number.isFinite(streamIdleTimeoutMs) || streamIdleTimeoutMs <= 0 || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) throw new Error(`dsh-provider-veark: streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
	const maxRequestFilesBytes = config.maxRequestFilesBytes ?? DEFAULT_MAX_REQUEST_FILES_BYTES;
	if (!Number.isSafeInteger(maxRequestFilesBytes) || maxRequestFilesBytes <= 0) throw new Error("dsh-provider-veark: maxRequestFilesBytes must be a positive safe integer");
	const maxInlineRequestImageBytes = config.maxInlineRequestImageBytes ?? DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES;
	if (!Number.isSafeInteger(maxInlineRequestImageBytes) || maxInlineRequestImageBytes <= 0) throw new Error("dsh-provider-veark: maxInlineRequestImageBytes must be a positive safe integer");
	const maxImagesPerRequest = config.maxImagesPerRequest ?? DEFAULT_MAX_IMAGES_PER_REQUEST;
	if (!Number.isSafeInteger(maxImagesPerRequest) || maxImagesPerRequest <= 0) throw new Error("dsh-provider-veark: maxImagesPerRequest must be a positive safe integer");
	const imageOffloadByteQuantum = config.imageOffloadByteQuantum ?? DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM;
	if (!Number.isSafeInteger(imageOffloadByteQuantum) || imageOffloadByteQuantum <= 0) throw new Error("dsh-provider-veark: imageOffloadByteQuantum must be a positive safe integer");
	if (imageOffloadByteQuantum > maxRequestFilesBytes) throw new Error("dsh-provider-veark: imageOffloadByteQuantum must not exceed maxRequestFilesBytes");
	const inlineImageOffloadByteQuantum = config.inlineImageOffloadByteQuantum ?? DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM;
	if (!Number.isSafeInteger(inlineImageOffloadByteQuantum) || inlineImageOffloadByteQuantum <= 0) throw new Error("dsh-provider-veark: inlineImageOffloadByteQuantum must be a positive safe integer");
	if (inlineImageOffloadByteQuantum > maxInlineRequestImageBytes) throw new Error("dsh-provider-veark: inlineImageOffloadByteQuantum must not exceed maxInlineRequestImageBytes");
	const imageOffloadCountQuantum = config.imageOffloadCountQuantum ?? DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM;
	if (!Number.isSafeInteger(imageOffloadCountQuantum) || imageOffloadCountQuantum <= 0) throw new Error("dsh-provider-veark: imageOffloadCountQuantum must be a positive safe integer");
	if (imageOffloadCountQuantum > maxImagesPerRequest) throw new Error("dsh-provider-veark: imageOffloadCountQuantum must not exceed maxImagesPerRequest");
	const filesApiTimeoutMs = config.filesApiTimeoutMs ?? DEFAULT_FILES_API_TIMEOUT_MS;
	if (!Number.isFinite(filesApiTimeoutMs) || filesApiTimeoutMs <= 0 || filesApiTimeoutMs > MAX_TIMER_DELAY_MS) throw new Error(`dsh-provider-veark: filesApiTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
	const fileExpirySeconds = config.fileExpirySeconds ?? DEFAULT_FILE_EXPIRY_SECONDS;
	if (!Number.isSafeInteger(fileExpirySeconds) || fileExpirySeconds < 3600 || fileExpirySeconds > 2592e3) throw new Error("dsh-provider-veark: fileExpirySeconds must be an integer from 3600 through 2592000");
	const fileRefreshMarginSeconds = config.fileRefreshMarginSeconds ?? DEFAULT_FILE_REFRESH_MARGIN_SECONDS;
	if (!Number.isSafeInteger(fileRefreshMarginSeconds) || fileRefreshMarginSeconds < 0 || fileRefreshMarginSeconds >= fileExpirySeconds) throw new Error("dsh-provider-veark: fileRefreshMarginSeconds must be a non-negative integer below fileExpirySeconds");
	const fileQuotaCleanupBatch = config.fileQuotaCleanupBatch ?? DEFAULT_FILE_QUOTA_CLEANUP_BATCH;
	if (!Number.isSafeInteger(fileQuotaCleanupBatch) || fileQuotaCleanupBatch < 1 || fileQuotaCleanupBatch > 1000) throw new Error("dsh-provider-veark: fileQuotaCleanupBatch must be an integer from 1 through 1000");
	const filesProbeIntervalMs = config.filesProbeIntervalMs ?? DEFAULT_FILES_PROBE_INTERVAL_MS;
	if (!Number.isSafeInteger(filesProbeIntervalMs) || filesProbeIntervalMs < 60000 || filesProbeIntervalMs > MAX_TIMER_DELAY_MS) throw new Error(`dsh-provider-veark: filesProbeIntervalMs must be an integer from 60000 through ${MAX_TIMER_DELAY_MS}`);
	const pdfRetentionDays = config.pdfRetentionDays ?? DEFAULT_PDF_RETENTION_DAYS;
	if (!Number.isSafeInteger(pdfRetentionDays) || pdfRetentionDays < 0 || pdfRetentionDays > 3650) throw new Error("dsh-provider-veark: pdfRetentionDays must be an integer from 0 through 3650");
	const chatBaseURL = config.chatBaseURL ?? DEFAULT_CHAT_BASE_URL;
	if (typeof chatBaseURL !== "string" || chatBaseURL.length === 0) throw new Error("dsh-provider-veark: chatBaseURL must be a non-empty string");
	const filesBaseURL = config.filesBaseURL ?? DEFAULT_FILES_BASE_URL;
	if (typeof filesBaseURL !== "string" || filesBaseURL.length === 0) throw new Error("dsh-provider-veark: filesBaseURL must be a non-empty string");
	return {
		apiKeyEnv: credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV),
		filesApiKeyEnv: typeof config.filesApiKeyEnv === "string" && config.filesApiKeyEnv.length > 0 ? credentialRef(config.filesApiKeyEnv) : "",
		chatBaseURL,
		filesBaseURL,
		maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
		defaultContextWindow: config.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
		models: resolveModels(config.models, { requestImagePixelBudget, requestImageMaxBytes }),
		streamIdleTimeoutMs,
		maxRequestFilesBytes,
		maxInlineRequestImageBytes,
		maxImagesPerRequest,
		imageOffloadByteQuantum,
		inlineImageOffloadByteQuantum,
		imageOffloadCountQuantum,
		filesApiTimeoutMs,
		filePolicy: {
			expiresAfterSeconds: fileExpirySeconds,
			refreshMarginSeconds: fileRefreshMarginSeconds,
			quotaCleanupBatch: fileQuotaCleanupBatch
		},
		preferFiles: config.preferFiles !== false,
		filesProbeIntervalMs,
		pdfRetentionDays,
		retryPolicy: resolveRetryPolicy(config.retryPolicy, "dsh-provider-veark: retryPolicy")
	};
}

function apply(ctx, config) {
	let current = () => config ?? {};
	let lastRaw;
	let lastGood;
	const options = () => {
		const raw = current();
		if (raw === lastRaw && lastGood !== void 0) return lastGood;
		try {
			const next = resolveAdapterOptions(raw);
			lastRaw = raw;
			lastGood = next;
			return next;
		} catch (error) {
			if (lastGood === void 0) throw error;
			lastRaw = raw;
			ctx.logger.error?.("dsh-provider-veark: keeping the last good configuration after an invalid settings section");
			ctx.logger.error?.(error);
			return lastGood;
		}
	};
	options();
	const resolveKey = async (ref, kind) => {
		const credentials = ctx.get("credentials");
		if (credentials !== void 0) {
			const hit = await credentials.resolve(ref);
			if (hit !== void 0) return assertUsableApiKey(hit.value, name, ref);
		}
		const ambient = launchEnvironmentOf(ctx).get(ref);
		if (ambient !== void 0 && ambient.value.length > 0) return assertUsableApiKey(ambient.value, name, ref);
		throw new LlmError(`${name}: no API key for provider route "${PROVIDER}" (${kind}); store ${ref} through the credentials service (the web Models page writes it), or export ${ref} in the launching environment`, "MISSING_CREDENTIAL");
	};
	const resolveApiKey = (connection) => resolveKey(connection.apiKeyEnv, "chat");
	const resolveFilesApiKey = (connection) => connection.filesApiKeyEnv ? resolveKey(connection.filesApiKeyEnv, "files") : resolveApiKey(connection);
	const log = {
		info: (message) => ctx.logger.info?.(message),
		warn: (message) => ctx.logger.warn?.(message)
	};
	const mode = new FilesModeController({ log });
	const files = new VeArkFileStore();
	const pdfs = new VeArkPdfStore(void 0, void 0, { retentionDays: () => options().pdfRetentionDays, log });
	// Programmatic adapter fixtures may use a structural context without Cordis reflection.
	if (ctx.reflect?.provide !== void 0) new VeArkPdfService(ctx, pdfs);
	const adapter = new VeArkAdapter({
		options,
		resolveApiKey,
		resolveFilesApiKey,
		resolveAttachments: () => ctx.get("attachments"),
		files,
		resolvePdf: (sessionId, token) => pdfs.resolve(sessionId, token),
		mode
	});
	ctx.llm.registerConfigurableProviders([{
		provider: PROVIDER,
		displayName: "火山方舟 Coding Plan",
		settingsNs: NS,
		settingsPath: []
	}]);
	const registration = ctx.llm.registerAdapter([PROVIDER], adapter);
	let registeredPolicy = options().retryPolicy;
	const ensureRegistrationFacts = () => {
		const policy = options().retryPolicy;
		if (deepEqualJson(policy, registeredPolicy)) return;
		registration.replace([PROVIDER]);
		registeredPolicy = policy;
	};
	installSettingsSection(ctx, NS, Config, config ?? {}, {
		setSource: (source) => {
			current = source;
		},
		onChange: ensureRegistrationFacts
	});
}

export { Config, PROVIDER, VeArkAdapter, apply, inject, name, resolveAdapterOptions };
