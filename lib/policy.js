/**
 * dsh-provider-veark/policy — 图片请求预算解析、Files 模式降级状态机与持久化。
 *
 * 预算解析与 dsh-llm-deepseek 的 resolveRequestImagePolicy 同构（deepseek:1228-1237）；
 * 状态机实现实施方案 §3.3：files-ok / files-unavailable(reason) / base64-only，
 * 持久化在 `DSH_HOME/dsh-provider-veark/files-state.json`（§4.5）。
 *
 * @module dsh-provider-veark/policy
 */
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";

/** 默认总像素预算，对齐 DeepSeek vision 投影（实施方案 §4.4）。 */
export const DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET = 64e4;
/** 默认单图编码字节预算。 */
export const DEFAULT_REQUEST_IMAGE_MAX_BYTES = 1024 * 1024;
/** provider low-detail 档位的总像素预算。 */
export const DEFAULT_LOW_DETAIL_IMAGE_PIXEL_BUDGET = 512 * 512;
/** 响应缺少 expire_at 时假定的文件有效期（方舟默认保留策略，7 天）。 */
export const DEFAULT_FILE_EXPIRY_SECONDS = 604800;
/** file_id 复用时要求的剩余寿命下限（ proactive refresh window）。 */
export const DEFAULT_FILE_REFRESH_MARGIN_SECONDS = 3600;
/** 配额回收时一次删除的最旧自有文件数上限。 */
export const DEFAULT_FILE_QUOTA_CLEANUP_BATCH = 100;
/** 单次 Files API 操作的默认截止时间。 */
export const DEFAULT_FILES_API_TIMEOUT_MS = 15000;
/** base64 降级后重试 Files 的探测间隔（实施方案 §3.3：默认 6 小时）。 */
export const DEFAULT_FILES_PROBE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * 解析一个模型路由拥有的图片请求预算。
 * @param model - 目录条目（可带 imagePixelBudget / imageMaxBytes / imageDetail）。
 * @returns 像素与编码字节预算。
 */
export function resolveRequestImagePolicy(model) {
	let maxPixels;
	if (model.imagePixelBudget !== void 0) maxPixels = model.imagePixelBudget;
	else if (model.imageDetail === "low") maxPixels = DEFAULT_LOW_DETAIL_IMAGE_PIXEL_BUDGET;
	else maxPixels = DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET;
	return {
		maxPixels,
		maxBytes: model.imageMaxBytes === void 0 ? DEFAULT_REQUEST_IMAGE_MAX_BYTES : model.imageMaxBytes
	};
}

/** 状态文件缺失/损坏时的起点：从未探测过，按 base64 起步（首次带图请求即探测）。 */
const EMPTY_STATE = { mode: "base64", reason: "never probed", checkedAt: 0 };

/** 截断并收敛原因字符串：只保留短分类事实，绝不携带请求体或凭据（铁律 4）。 */
function sanitizeReason(reason) {
	const text = typeof reason === "string" ? reason : String(reason ?? "unknown");
	return text.replace(/\s+/gu, " ").trim().slice(0, 200) || "unknown";
}

/** files-state.json 的原子读写（deepseek files-v3.json 模式）。 */
export class FilesStateStore {
	/** 状态 JSON 的绝对路径。 */
	path;
	constructor(path = join(resolveDshHome(), "dsh-provider-veark", "files-state.json")) {
		this.path = path;
	}
	async load() {
		try {
			const value = JSON.parse(await readFile(this.path, "utf8"));
			if (value === null || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY_STATE };
			const mode = value.mode === "files" ? "files" : "base64";
			return {
				mode,
				reason: typeof value.reason === "string" ? value.reason : "",
				checkedAt: Number.isSafeInteger(value.checkedAt) && value.checkedAt >= 0 ? value.checkedAt : 0
			};
		} catch (error) {
			if (error?.code === "ENOENT") return { ...EMPTY_STATE };
			return { ...EMPTY_STATE };
		}
	}
	async save(state) {
		await mkdir(dirname(this.path), { recursive: true, mode: 448 });
		await withFileLock(this.path, async () => {
			await writeFileAtomic(this.path, JSON.stringify(state, void 0, 2) + "\n", { mode: 384, dirMode: 448 });
		});
	}
}

/**
 * Files 模式判定器：每次带图请求开始时决定走 file_id 还是 base64，
 * 并把探测结果（上传成功/失败）落回状态文件。
 *
 * - preferFiles=false → 恒 base64，零 Files 调用，不写状态（验收标准 §8.7）。
 * - mode=files → 直接走 files（失败会在本轮请求内自动降级并记录）。
 * - mode=base64 且未过探测间隔 → base64，不探测。
 * - mode=base64 且已过间隔 → 本轮重新尝试 files（探测本身即上传）。
 */
export class FilesModeController {
	store;
	now;
	log;
	#cached;
	constructor({ store, now = Date.now, log } = {}) {
		this.store = store ?? new FilesStateStore();
		this.now = now;
		this.log = log;
	}
	async decide(preferFiles, probeIntervalMs) {
		if (!preferFiles) return { representation: "base64", probing: false };
		const state = this.#cached ??= await this.store.load();
		if (state.mode === "files") return { representation: "file", probing: true };
		if (this.now() - state.checkedAt < probeIntervalMs) return { representation: "base64", probing: false };
		return { representation: "file", probing: true };
	}
	async #commit(state) {
		this.#cached = state;
		try {
			await this.store.save(state);
		} catch (error) {
			this.log?.warn?.(`dsh-provider-veark: failed to persist files state: ${error?.message ?? error}`);
		}
	}
	async recordFilesOk() {
		const next = { mode: "files", reason: "", checkedAt: this.now() };
		const prev = this.#cached;
		if (prev?.mode !== "files") this.log?.info?.("dsh-provider-veark: Files API available — image requests will reference file_id (state: files-ok)");
		await this.#commit(next);
	}
	async recordFilesUnavailable(reason) {
		const clean = sanitizeReason(reason);
		const prev = this.#cached;
		if (prev?.mode !== "base64" || prev?.reason !== clean) this.log?.warn?.(`dsh-provider-veark: Files API unavailable (${clean}) — falling back to inline base64; will re-probe after the configured interval (state: files-unavailable)`);
		await this.#commit({ mode: "base64", reason: clean, checkedAt: this.now() });
	}
	/** 当前内存态（诊断用；权威在状态文件）。 */
	snapshot() {
		return this.#cached ? { ...this.#cached } : void 0;
	}
}
