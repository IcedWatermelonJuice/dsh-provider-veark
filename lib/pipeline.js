/**
 * dsh-provider-veark/pipeline — 图片管线。
 *
 * collectImageRefs → attachments.readImageRequest(ref, policy)（归一化由附件服务完成），
 * 再经 FileStore 产出每图的 wire 内容块：files 模式 `{type:"input_image", file_id}`、
 * base64 模式 `{type:"input_image", image_url:"data:...;base64,..."}`。
 * 上传去重（并发合并 promise）、本地索引复用、配额回收均照搬
 * dsh-llm-deepseek 的 ensureUploaded / 序列化循环（deepseek:1484-1530、703-877）。
 *
 * @module dsh-provider-veark/pipeline
 */
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { LlmError, requestImageHandleText } from "@deepseek-ai/dsh-llm";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { isFilesQuotaError } from "./files-api.js";

/** chat 引用 file_id 的单图字节上限（照搬 deepseek 的防御值）。 */
export const MAX_CHAT_IMAGE_BYTES = 32 * 1024 * 1024;
/** 本插件上传文件的命名前缀（配额回收只删自有文件）。 */
export const OWNED_FILE_PREFIX = "veark-";

/** 收集请求历史里的全部图片引用（含嵌套 tool-result），保持首次出现顺序。 */
export function collectImageRefs(content, refs) {
	for (const block of content) if (block.type === "image") refs.set(block.attachment.attachmentId, block.attachment);
	else if (block.type === "tool-result") collectImageRefs(block.content, refs);
}

/** 把全部图片引用解析为请求版本（readImageRequest 的并发包装）。 */
export async function prepareRequestImages(options, attachments, model, signal) {
	const refs = /* @__PURE__ */ new Map();
	for (const message of options.messages) collectImageRefs(message.content, refs);
	const policy = resolvePipelinePolicy(model);
	const orderedRefs = [...refs.values()];
	const projected = await Promise.all(orderedRefs.map((ref) => attachments.readImageRequest(ref, policy, signal)));
	return new Map(orderedRefs.map((ref, index) => [ref.attachmentId, projected[index]]));
}

function resolvePipelinePolicy(model) {
	return {
		maxPixels: model.imagePixelBudget,
		maxBytes: model.imageMaxBytes
	};
}

/** 非密钥命名空间：baseURL+key 的 SHA-256（不持久化、不打日志 key）。 */
export function veArkFileScope(baseURL, apiKey) {
	return createHash("sha256").update(baseURL.replace(/\/+$/u, "")).update("\0").update(apiKey).digest("hex");
}

/** 标记一次可降级重试的 file_id 解析失败（deepseek:1211 同构）。 */
export var FileResolutionFailure = class extends Error {
	constructor(cause) {
		super("Ark Files API could not resolve a request image.", { cause });
		this.name = "FileResolutionFailure";
	}
};

function absent(error) {
	return error?.code === "ENOENT";
}
function parseRecord(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new InvalidUploadIndexError("veark: upload index contains a non-object record");
	const record = value;
	if (typeof record.scope !== "string" || !/^[0-9a-f]{64}$/u.test(record.scope) || typeof record.attachmentId !== "string" || record.attachmentId.length === 0 || typeof record.variantId !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(record.variantId) || typeof record.fileId !== "string" || record.fileId.length === 0 || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || !Number.isSafeInteger(record.createdAt) || record.createdAt < 0 || !Number.isSafeInteger(record.expiresAt) || record.expiresAt < 0) throw new InvalidUploadIndexError("veark: upload index contains an invalid record");
	return { scope: record.scope, attachmentId: record.attachmentId, variantId: record.variantId, fileId: record.fileId, bytes: record.bytes, createdAt: record.createdAt, expiresAt: record.expiresAt };
}
function parseIndex(text) {
	let value;
	try {
		value = JSON.parse(text);
	} catch (error) {
		throw new InvalidUploadIndexError("veark: upload index is not valid JSON", { cause: error });
	}
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new InvalidUploadIndexError("veark: upload index is not an object");
	const index = value;
	if (index.formatVersion !== 1 || !Array.isArray(index.records)) throw new InvalidUploadIndexError("veark: unsupported upload index format");
	const records = index.records.map(parseRecord);
	const keys = /* @__PURE__ */ new Set();
	for (const record of records) {
		const key = `${record.scope}\0${record.variantId}`;
		if (keys.has(key)) throw new InvalidUploadIndexError("veark: upload index contains duplicate mappings");
		keys.add(key);
	}
	return { formatVersion: 1, records };
}
var InvalidUploadIndexError = class extends Error {};
function reusable(record, now, refreshMarginMs) {
	return record.expiresAt - now > refreshMarginMs;
}

/** 本机 DSH home 内共享的 attachment→file_id 原子索引（deepseek:539 同构）。 */
export class VeArkUploadIndex {
	path;
	constructor(path = join(resolveDshHome(), "dsh-provider-veark", "files-index-v1.json")) {
		this.path = path;
	}
	async load() {
		try {
			return parseIndex(await readFile(this.path, "utf8"));
		} catch (error) {
			if (absent(error) || error instanceof InvalidUploadIndexError) return { formatVersion: 1, records: [] };
			throw error;
		}
	}
	async save(index) {
		await mkdir(dirname(this.path), { recursive: true, mode: 448 });
		// 注意：不带锁 —— 锁由调用方（get/commit/remove/clear）持有，嵌套取锁会死锁。
		await writeFileAtomic(this.path, JSON.stringify(index, void 0, 2) + "\n", { mode: 384, dirMode: 448 });
	}
	async get(scope, variantId, now, refreshMarginMs) {
		const record = (await this.load()).records.find((candidate) => candidate.scope === scope && candidate.variantId === variantId);
		return record !== void 0 && reusable(record, now, refreshMarginMs) ? record : void 0;
	}
	async commit(candidate, now, refreshMarginMs) {
		await mkdir(dirname(this.path), { recursive: true, mode: 448 });
		return withFileLock(this.path, async () => {
			const index = await this.load();
			const existing = index.records.find((record) => record.scope === candidate.scope && record.variantId === candidate.variantId && reusable(record, now, refreshMarginMs));
			if (existing !== void 0) return { record: existing, accepted: false };
			const records = index.records.filter((record) => reusable(record, now, refreshMarginMs) && !(record.scope === candidate.scope && record.variantId === candidate.variantId));
			records.push(candidate);
			await this.save({ formatVersion: 1, records });
			return { record: candidate, accepted: true };
		});
	}
	async remove(scope, variantId, fileId) {
		await mkdir(dirname(this.path), { recursive: true, mode: 448 });
		await withFileLock(this.path, async () => {
			const index = await this.load();
			const records = index.records.filter((record) => !(record.scope === scope && record.variantId === variantId && record.fileId === fileId));
			if (records.length !== index.records.length) await this.save({ formatVersion: 1, records });
		});
	}
	async clear(scope) {
		await mkdir(dirname(this.path), { recursive: true, mode: 448 });
		await withFileLock(this.path, async () => {
			const index = await this.load();
			const records = index.records.filter((record) => record.scope !== scope);
			if (records.length !== index.records.length) await this.save({ formatVersion: 1, records });
		});
	}
}

function extension(mediaType) {
	switch (mediaType) {
		case "image/png": return "png";
		case "image/jpeg": return "jpeg";
		case "image/webp": return "webp";
		case "image/gif": return "gif";
		default: return "bin";
	}
}
function ownedFilename(version) {
	return `${OWNED_FILE_PREFIX}${String(version.attachment.attachmentId).slice(7, 23)}-${String(version.variantId).slice(7, 15)}.${extension(version.mediaType)}`;
}

/** file_id 的用户级持久复用（并发共享同一上传；deepseek:703 同构）。 */
export class VeArkFileStore {
	index;
	now;
	createClient;
	inflight = /* @__PURE__ */ new Map();
	constructor({ index, now = Date.now, createClient } = {}) {
		this.index = index ?? new VeArkUploadIndex();
		this.now = now;
		this.createClient = createClient;
	}
	client(connection) {
		if (this.createClient === void 0) throw new LlmError("veark: file store has no client factory", "INVALID_REQUEST");
		return this.createClient({ baseURL: connection.baseURL, apiKey: connection.apiKey, timeoutMs: connection.timeoutMs });
	}
	ensureUploaded(version, connection, policy, signal) {
		signal?.throwIfAborted();
		const key = `${veArkFileScope(connection.baseURL, connection.apiKey)}\0${version.variantId}`;
		let active = this.inflight.get(key);
		if (active?.controller.signal.aborted) {
			this.inflight.delete(key);
			active = void 0;
		}
		if (active !== void 0) return waitForUpload(active, signal);
		const controller = new AbortController();
		const shared = { controller, settled: false, waiters: 0, promise: void 0 };
		shared.promise = this.ensureUploadedOnce(version, connection, policy, controller.signal).then((value) => {
			shared.settled = true;
			return value;
		}, (error) => {
			shared.settled = true;
			throw error instanceof Error ? error : new Error("veark: file upload failed with a non-Error reason.", { cause: error });
		});
		this.inflight.set(key, shared);
		shared.promise.finally(() => {
			if (this.inflight.get(key) === shared) this.inflight.delete(key);
		}).catch(() => {});
		return waitForUpload(shared, signal);
	}
	async ensureUploadedOnce(version, connection, policy, signal) {
		if (version.bytes > MAX_CHAT_IMAGE_BYTES) throw new LlmError(`Ark chat image exceeds the ${Math.round(MAX_CHAT_IMAGE_BYTES / 1048576)} MiB per-image limit.`, "INVALID_REQUEST");
		const scope = veArkFileScope(connection.baseURL, connection.apiKey);
		const now = this.now();
		const marginMs = policy.refreshMarginSeconds * 1000;
		const cached = await this.index.get(scope, version.variantId, now, marginMs);
		if (cached !== void 0) return { record: cached, uploaded: false };
		const client = this.client(connection);
		const upload = async () => {
			const remote = await client.upload({
				data: version.data,
				mediaType: version.mediaType,
				filename: ownedFilename(version),
				signal
			});
			// 服务端给 expire_at 就按它刷新；没给按假定寿命（fileExpirySeconds）。
			const expiresAt = remote.expireAt !== void 0 ? remote.expireAt * 1000 : now + policy.expiresAfterSeconds * 1000;
			return {
				scope,
				attachmentId: version.attachment.attachmentId,
				variantId: version.variantId,
				fileId: remote.id,
				bytes: remote.bytes,
				createdAt: remote.createdAt * 1000,
				expiresAt
			};
		};
		let candidate;
		try {
			candidate = await upload();
		} catch (error) {
			if (!isFilesQuotaError(error)) throw error;
			if (await this.reclaimOldestOwned(connection, policy.quotaCleanupBatch, signal) === 0) throw error;
			candidate = await upload();
		}
		const committed = await this.index.commit(candidate, this.now(), marginMs);
		if (!committed.accepted) try {
			await client.delete(candidate.fileId, signal);
		} catch {}
		return { record: committed.record, uploaded: committed.accepted };
	}
	async invalidate(version, fileId, connection) {
		await this.index.remove(veArkFileScope(connection.baseURL, connection.apiKey), version.variantId, fileId);
	}
	/** 删除最旧的自有文件（文件名前缀识别），用于配额回收（deepseek:839 同构）。 */
	async reclaimOldestOwned(connection, count, signal) {
		const client = this.client(connection);
		let after;
		const owned = [];
		while (owned.length < count) {
			const page = await client.list({ ...(after === void 0 ? {} : { after }), limit: 1000, order: "asc", ...(signal === void 0 ? {} : { signal }) });
			for (const file of page.data) {
				if (!file.filename.startsWith(OWNED_FILE_PREFIX)) continue;
				owned.push(file.id);
				if (owned.length === count) break;
			}
			if (!page.hasMore || page.lastId === void 0 || page.lastId === after) break;
			after = page.lastId;
		}
		for (const fileId of owned) await client.delete(fileId, signal);
		return owned.length;
	}
}

function waitForUpload(operation, signal) {
	signal?.throwIfAborted();
	operation.waiters += 1;
	let released = false;
	const release = (cancelledReason) => {
		if (released) return;
		released = true;
		operation.waiters -= 1;
		if (cancelledReason !== void 0 && operation.waiters === 0 && !operation.settled) operation.controller.abort(cancelledReason);
	};
	if (signal === void 0) return operation.promise.finally(() => {
		release();
	});
	return new Promise((resolve, reject) => {
		const abort = () => {
			const reason = signal.reason instanceof Error ? signal.reason : new Error("veark: file upload cancelled with a non-Error reason.", { cause: signal.reason });
			release(reason);
			reject(reason);
		};
		signal.addEventListener("abort", abort, { once: true });
		operation.promise.then((value) => {
			signal.removeEventListener("abort", abort);
			release();
			resolve(value);
		}, (error) => {
			signal.removeEventListener("abort", abort);
			release();
			reject(error);
		});
	});
}

/** 单图的 Responses wire 内容块：前置文本句柄 + image 部分。 */
export function imageWireParts(version, representation, fileId) {
	const handle = { type: "input_text", text: requestImageHandleText(version) };
	if (representation === "file") {
		if (fileId === void 0) throw new LlmError(`veark: request image ${version.attachment.attachmentId} was not uploaded.`, "INVALID_REQUEST");
		return [handle, { type: "input_image", detail: "auto", file_id: fileId }];
	}
	return [handle, { type: "input_image", detail: "auto", image_url: `data:${version.mediaType};base64,${Buffer.from(version.data).toString("base64")}` }];
}
