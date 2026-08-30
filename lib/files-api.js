/**
 * dsh-provider-veark/files-api — 火山方舟 Files API 传输层。
 *
 * 优先调用官方 @volcengine/ark-runtime 的现成方法（实施方案 §5.4）：
 * `uploadFile / retrieveFile / listFiles / deleteFile`；本文件做薄封装：
 * 双端点区分（files 走 filesBaseURL）、响应校验（含 expire_at 透出）、
 * 错误归一化（超时 / 403 / 404 分类，供降级状态机消费）。
 *
 * 测试通过 `createClient` 注入替身；生产默认构造真实 SDK 客户端。
 *
 * @module dsh-provider-veark/files-api
 */
import { ArkRuntimeClient } from "@volcengine/ark-runtime";
import { LlmError } from "@deepseek-ai/dsh-llm";

/** 方舟 Files API 上传大小上限（文件路径上传 ≤512MB，实施方案 §2.3）。 */
export const MAX_FILE_UPLOAD_BYTES = 512 * 1024 * 1024;

/** Files API 操作失败，保留 HTTP status 供恢复策略使用（deepseek:330 同构）。 */
export var VeArkFilesError = class extends LlmError {
	/** 供分类用的 provider 详情串。 */
	detail;
	constructor(message, status, detail) {
		super(message, status === 401 || status === 403 ? "AUTH" : status === 429 ? "RATE_LIMIT" : status >= 500 ? "SERVER" : "FILES_API", status === void 0 ? void 0 : { status });
		this.name = "VeArkFilesError";
		this.detail = detail ?? "";
	}
};

/** 上传失败是否属于 provider 存储配额/文件数配额（可触发一次清理重试）。 */
export function isFilesQuotaError(error) {
	return error instanceof VeArkFilesError && /(?:quota|storage|stored files|file count|too many files|exceed.{0,24}limit)/iu.test(error.detail);
}

/**
 * 把任意 Files 操作失败归一为短分类事实（不携带原始响应体，铁律 4）。
 * SDK 错误形状：HttpRequestError { name: "Exception"|"ApiException"|"NetworkError", status?, data? }
 * 与 axios 超时（code=ECONNABORTED）。
 */
export function classifyFilesFailure(error) {
	const status = typeof error?.status === "number" ? error.status : void 0;
	const code = typeof error?.code === "string" ? error.code : void 0;
	const detail = errorDetailString(error);
	if (code === "ECONNABORTED" || /timeout(?:ed)?\b|timed?\s*out/iu.test(detail) === true && status === void 0) return { kind: "timeout", status: void 0, code };
	if (status === 401 || status === 403) return { kind: "auth", status, code };
	if (status === 404) return { kind: "notfound", status, code };
	if (status === 429) return { kind: "rate_limit", status, code };
	if (status !== void 0 && status >= 500) return { kind: "server", status, code };
	if (error?.name === "NetworkError" || status === void 0) return { kind: "network", status: void 0, code };
	return { kind: "files_api", status, code };
}

/** 状态文件用的短原因串。 */
export function filesFailureReason(error) {
	const fact = classifyFilesFailure(error);
	const parts = ["files " + fact.kind];
	if (fact.status !== void 0) parts.push("HTTP " + fact.status);
	if (fact.code !== void 0) parts.push(fact.code);
	return parts.join(" ");
}

/** 提取 SDK/axios 错误里可分类的文本（仅取 code/message 短字段）。 */
function errorDetailString(error) {
	const data = error?.data;
	let text = "";
	if (typeof data === "string") text = data;
	else if (data && typeof data === "object") {
		const err = data.error && typeof data.error === "object" ? data.error : data;
		text = [err?.code, err?.type, err?.message].filter((field) => typeof field === "string").join(" ");
	}
	if (!text && typeof error?.message === "string") text = error.message;
	return text.slice(0, 400);
}

function invalidResponse(operation) {
	return new LlmError(`Ark Files API returned an invalid ${operation} response.`, "INVALID_RESPONSE");
}

/** 校验并归一 FileMeta（SDK FileMeta：{id, object, purpose, filename, bytes?, created_at, expire_at, status}）。 */
export function parseFileMeta(value, operation) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalidResponse(operation);
	const wire = value;
	if (typeof wire.id !== "string" || wire.id.length === 0 || wire.object !== "file" || typeof wire.filename !== "string" || wire.filename.length === 0 || wire.purpose !== "user_data" || !Number.isSafeInteger(wire.created_at) || wire.created_at < 0) throw invalidResponse(operation);
	const bytes = wire.bytes === void 0 || wire.bytes === null ? 0 : wire.bytes;
	if (!Number.isSafeInteger(bytes) || bytes < 0) throw invalidResponse(operation);
	const rawExpiry = wire.expire_at ?? wire.expires_at;
	if (rawExpiry !== void 0 && (!Number.isSafeInteger(rawExpiry) || rawExpiry < 0)) throw invalidResponse(operation);
	return {
		id: wire.id,
		bytes,
		createdAt: wire.created_at,
		filename: wire.filename,
		purpose: "user_data",
		status: typeof wire.status === "string" ? wire.status : void 0,
		...rawExpiry === void 0 ? {} : { expireAt: rawExpiry }
	};
}

/** 默认的 SDK 客户端工厂（生产路径）。 */
function defaultCreateClient({ baseURL, apiKey, timeoutMs }) {
	return new ArkRuntimeClient({ apiKey, baseURL, timeout: timeoutMs, retryTimes: 0 });
}

/** 状态为 processing 时的最长等待（图片通常即时 active，仅防御视频化预处理）。 */
const PROCESSING_POLL_MS = 10000;
const PROCESSING_POLL_INTERVAL_MS = 500;

/** Ark Files API 直连客户端（每次操作按连接快照构造，保持无状态）。 */
export class VeArkFilesClient {
	#options;
	#clientFactory;
	/**
	 * @param options - filesBaseURL、apiKey、timeoutMs，以及可注入的 createClient / fetch 替身。
	 */
	constructor(options) {
		this.#options = options;
		this.#clientFactory = options.createClient ?? defaultCreateClient;
	}
	#client() {
		return this.#clientFactory({
			baseURL: this.#options.baseURL.replace(/\/+$/u, ""),
			apiKey: this.#options.apiKey,
			timeoutMs: this.#options.timeoutMs
		});
	}
	/** 统一错误翻译：SDK/axios 错误 → VeArkFilesError / TRANSPORT。 */
	#translate(error, operation) {
		if (error instanceof LlmError) return error;
		const status = typeof error?.status === "number" ? error.status : void 0;
		const detail = errorDetailString(error);
		if (status !== void 0) return new VeArkFilesError(`Ark Files API error during ${operation} (HTTP ${status})`, status, detail);
		if (error?.code === "ECONNABORTED" || /timeout(?:ed)?\b|timed?\s*out/iu.test(detail)) return new LlmError(`Ark Files API ${operation} timed out`, "TIMEOUT", { cause: error });
		return new LlmError(`Ark Files API request failed during ${operation}`, "TRANSPORT", { cause: error });
	}
	/**
	 * 上传一张请求图（purpose=user_data，multipart 由 SDK 负责）。
	 * 不发送 expire_at（方舟默认保留策略；过期信息从响应 expire_at 读取）。
	 */
	async upload({ data, mediaType, filename, signal }) {
		if (data.byteLength > MAX_FILE_UPLOAD_BYTES) throw new LlmError("Ark Files API upload exceeds 512 MiB.", "INVALID_REQUEST");
		const file = new File([Uint8Array.from(data)], filename, { type: mediaType });
		let meta;
		try {
			meta = parseFileMeta(await this.#client().uploadFile({ file, purpose: "user_data" }, { signal }), "upload");
		} catch (error) {
			throw this.#translate(error, "upload");
		}
		// status=processing 时轮询直至 active（防御性；图片上传通常即时可用）。
		if (meta.status === "processing") {
			const deadline = Date.now() + PROCESSING_POLL_MS;
			while (meta.status === "processing" && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, PROCESSING_POLL_INTERVAL_MS));
				signal?.throwIfAborted();
				try {
					meta = parseFileMeta(await this.#client().retrieveFile(meta.id, { signal }), "retrieve");
				} catch (error) {
					throw this.#translate(error, "retrieve");
				}
			}
		}
		return meta;
	}
	async retrieve(fileId, signal) {
		try {
			return parseFileMeta(await this.#client().retrieveFile(fileId, { signal }), "retrieve");
		} catch (error) {
			throw this.#translate(error, "retrieve");
		}
	}
	async list({ purpose = "user_data", after, limit, order, signal } = {}) {
		try {
			const page = await this.#client().listFiles({ purpose, ...(after === void 0 ? {} : { after }), ...(limit === void 0 ? {} : { limit }), ...(order === void 0 ? {} : { order }) }, { signal });
			if (page === null || typeof page !== "object" || Array.isArray(page) || !Array.isArray(page.data)) throw invalidResponse("list");
			return { data: page.data.map((item) => parseFileMeta(item, "list")), hasMore: page.has_more === true };
		} catch (error) {
			throw this.#translate(error, "list");
		}
	}
	async delete(fileId, signal) {
		try {
			const value = await this.#client().deleteFile(fileId, { signal });
			if (value === null || typeof value !== "object" || value.deleted !== true) throw invalidResponse("delete");
			return value;
		} catch (error) {
			throw this.#translate(error, "delete");
		}
	}
}
