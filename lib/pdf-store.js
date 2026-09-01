/** Provider-private durable PDF sidecar and Remote upload service. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

export const PDF_MEDIA_TYPE = "application/pdf";
/** Leaves JSON/base64 overhead below Ark's 64 MiB whole-request ceiling. */
export const DEFAULT_MAX_PDF_BYTES = 45 * 1024 * 1024;
export const DEFAULT_PDF_RETENTION_DAYS = 0;
export const DEFAULT_PDF_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_PDF_ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
export const PDF_TOKEN_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
export const PDF_MARKER_RE = new RegExp(`\\[\\[dsh-provider-veark:pdf:(${PDF_TOKEN_PATTERN})\\]\\]`, "giu");

function safePdfName(value) {
	const name = basename(String(value ?? "document.pdf").replaceAll("\\", "/")).trim();
	if (name.length === 0 || name.length > 255 || !name.toLowerCase().endsWith(".pdf")) throw new Error("dsh-provider-veark: PDF filename must end in .pdf and contain at most 255 characters");
	return name;
}

function decodePdf(data, maxBytes) {
	if (typeof data !== "string" || data.length === 0) throw new Error("dsh-provider-veark: PDF upload data is empty");
	const bytes = Buffer.from(data, "base64");
	if (bytes.length === 0 || bytes.length > maxBytes) throw new Error(`dsh-provider-veark: PDF must contain 1 through ${maxBytes} bytes`);
	const head = bytes.subarray(0, Math.min(bytes.length, 1024)).toString("latin1");
	if (!head.includes("%PDF-")) throw new Error("dsh-provider-veark: uploaded bytes are not a PDF document");
	const canonical = bytes.toString("base64").replace(/=+$/u, "");
	if (canonical !== data.replace(/\s+/gu, "").replace(/=+$/u, "")) throw new Error("dsh-provider-veark: PDF upload is not canonical base64");
	return bytes;
}

/** Durable files live outside the Harness attachment subsystem and are bound to one session id. */
export class VeArkPdfStore {
	constructor(root = dshHomePath("provider-veark", "pdfs"), maxBytes = DEFAULT_MAX_PDF_BYTES, options = {}) {
		this.root = root;
		this.maxBytes = maxBytes;
		this.retentionDays = options.retentionDays ?? DEFAULT_PDF_RETENTION_DAYS;
		this.cleanupIntervalMs = options.cleanupIntervalMs ?? DEFAULT_PDF_CLEANUP_INTERVAL_MS;
		this.orphanGraceMs = options.orphanGraceMs ?? DEFAULT_PDF_ORPHAN_GRACE_MS;
		this.now = options.now ?? Date.now;
		this.log = options.log;
		this.lastCleanupAt = Number.NEGATIVE_INFINITY;
	}

	retentionMs() {
		const days = typeof this.retentionDays === "function" ? this.retentionDays() : this.retentionDays;
		if (!Number.isSafeInteger(days) || days < 0 || days > 3650) throw new Error("dsh-provider-veark: pdfRetentionDays must be an integer from 0 through 3650");
		return days === 0 ? 0 : days * 24 * 60 * 60 * 1000;
	}

	async cleanup({ force = false } = {}) {
		const now = this.now();
		if (!force && now - this.lastCleanupAt < this.cleanupIntervalMs) return Object.freeze({ expired: 0, orphans: 0 });
		this.lastCleanupAt = now;
		await mkdir(this.root, { recursive: true });
		const entries = await readdir(this.root, { withFileTypes: true });
		const pairs = new Map();
		const filePattern = new RegExp(`^(${PDF_TOKEN_PATTERN})\\.(pdf|json)$`, "u");
		for (const entry of entries) {
			if (!entry.isFile()) continue;
			const match = filePattern.exec(entry.name);
			if (match === null) continue;
			const pair = pairs.get(match[1]) ?? {};
			pair[match[2]] = join(this.root, entry.name);
			pairs.set(match[1], pair);
		}
		const retentionMs = this.retentionMs();
		let expired = 0;
		let orphans = 0;
		for (const [token, pair] of pairs) {
			if (pair.pdf !== void 0 && pair.json !== void 0) {
				if (retentionMs === 0) continue;
				try {
					const metadata = JSON.parse(await readFile(pair.json, "utf8"));
					const createdAt = Date.parse(metadata.createdAt);
					if (metadata.version !== 1 || metadata.token !== token || !Number.isFinite(createdAt) || now - createdAt < retentionMs) continue;
					await Promise.all([rm(pair.pdf, { force: true }), rm(pair.json, { force: true })]);
					expired++;
				} catch (error) {
					this.log?.warn?.(`dsh-provider-veark: skipped unreadable PDF metadata during cleanup: ${error?.message ?? error}`);
				}
				continue;
			}
			const orphanPath = pair.pdf ?? pair.json;
			const info = await stat(orphanPath);
			if (now - info.mtimeMs < this.orphanGraceMs) continue;
			await rm(orphanPath, { force: true });
			orphans++;
		}
		return Object.freeze({ expired, orphans });
	}

	async stage({ sessionId, name, mediaType, data }) {
		if (typeof sessionId !== "string" || sessionId.length === 0) throw new Error("dsh-provider-veark: PDF upload requires a session id");
		if (mediaType !== PDF_MEDIA_TYPE) throw new Error("dsh-provider-veark: only application/pdf is accepted");
		const filename = safePdfName(name);
		const bytes = decodePdf(data, this.maxBytes);
		try {
			await this.cleanup();
		} catch (error) {
			this.log?.warn?.(`dsh-provider-veark: PDF cleanup failed without blocking upload: ${error?.message ?? error}`);
		}
		const token = randomUUID();
		const pdfPath = join(this.root, `${token}.pdf`);
		const metaPath = join(this.root, `${token}.json`);
		const metadata = {
			version: 1,
			token,
			sessionId,
			name: filename,
			mediaType: PDF_MEDIA_TYPE,
			bytes: bytes.length,
			sha256: createHash("sha256").update(bytes).digest("hex"),
			createdAt: new Date(this.now()).toISOString()
		};
		await mkdir(this.root, { recursive: true });
		await writeFile(pdfPath, bytes, { flag: "wx" });
		try {
			await writeFile(metaPath, `${JSON.stringify(metadata)}\n`, { encoding: "utf8", flag: "wx" });
		} catch (error) {
			await rm(pdfPath, { force: true });
			throw error;
		}
		return Object.freeze({ token, name: filename, bytes: bytes.length });
	}

	async resolve(sessionId, token) {
		if (!(new RegExp(`^${PDF_TOKEN_PATTERN}$`, "u")).test(token)) throw new Error("dsh-provider-veark: invalid PDF token");
		const metaPath = join(this.root, `${token}.json`);
		const pdfPath = join(this.root, `${token}.pdf`);
		const metadata = JSON.parse(await readFile(metaPath, "utf8"));
		if (metadata.version !== 1 || metadata.token !== token || metadata.sessionId !== String(sessionId)) throw new Error("dsh-provider-veark: PDF token does not belong to this session");
		const bytes = await readFile(pdfPath);
		if (bytes.length !== metadata.bytes || bytes.length > this.maxBytes) throw new Error("dsh-provider-veark: stored PDF size does not match its metadata");
		if (createHash("sha256").update(bytes).digest("hex") !== metadata.sha256) throw new Error("dsh-provider-veark: stored PDF failed its integrity check");
		return Object.freeze({ name: safePdfName(metadata.name), mediaType: PDF_MEDIA_TYPE, data: bytes });
	}
}

function decorateRemote(target, method, exportName) {
	const initializers = [];
	Remote(exportName)(target[method], {
		kind: "method",
		name: method,
		static: false,
		private: false,
		access: { has: (value) => method in value, get: (value) => value[method] },
		addInitializer: (initializer) => initializers.push(initializer)
	});
	return initializers;
}

/** Browser-to-Host upload seam owned entirely by this provider plugin. */
export class VeArkPdfService extends TypertRemoteService {
	constructor(ctx, store) {
		super(ctx, "vearkPdf");
		this.store = store;
		for (const initializer of VEARK_PDF_REMOTE_INITIALIZERS) initializer.call(this);
	}

	stage(request) {
		return this.store.stage(request);
	}
}

const VEARK_PDF_REMOTE_INITIALIZERS = decorateRemote(VeArkPdfService.prototype, "stage", "stage");
