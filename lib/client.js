window.__ModuleLoader__.load({
	id: "dsh-provider-veark",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		var reactMod = require("react");
		var React = reactMod && typeof reactMod.createElement === "function" ? reactMod : reactMod && reactMod.default ? reactMod.default : null;
		var h = React.createElement;
		var useState = React.useState;
		var runtime = require("@deepseek-ai/dsh-client-runtime/client");
		var createSnapshotStore = runtime.createSnapshotStore;
		/** 内置 PluginCard 的样式表与类名（与 dsh-client-ui-settings-plugins 同源），第三方卡片外观一致的复刻层。 */
		var CARD_CSS = ".YyYd_a_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}.YyYd_a_card:hover{border-color:var(--dsw-alias-label-dimmed)}.YyYd_a_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}.YyYd_a_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}.YyYd_a_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.YyYd_a_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.YyYd_a_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}.YyYd_a_description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}.YyYd_a_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}.YyYd_a_chevronOpen{transform:rotate(180deg)}.YyYd_a_body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}.YyYd_a_readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}.YyYd_a_pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.YyYd_a_footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}.YyYd_a_failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}.YyYd_a_discard,.YyYd_a_save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}.YyYd_a_discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}.YyYd_a_discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.YyYd_a_save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.YyYd_a_discard:disabled,.YyYd_a_save:disabled{opacity:.4;cursor:default}.YyYd_a_discard:focus-visible,.YyYd_a_save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}";
		var CARD = { card: "YyYd_a_card", cardOpen: "YyYd_a_cardOpen", header: "YyYd_a_header", headText: "YyYd_a_headText", name: "YyYd_a_name", description: "YyYd_a_description", chevron: "YyYd_a_chevron", chevronOpen: "YyYd_a_chevronOpen", body: "YyYd_a_body", readOnly: "YyYd_a_readOnly", pending: "YyYd_a_pending", footer: "YyYd_a_footer", failed: "YyYd_a_failed", save: "YyYd_a_save", discard: "YyYd_a_discard" };
		if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="dsh-provider-veark/plugin-card"]') === null) {
			var styleTag = document.createElement("style");
			styleTag.dataset.plugin = "dsh-provider-veark";
			styleTag.dataset.pluginCss = "dsh-provider-veark/plugin-card";
			styleTag.textContent = CARD_CSS;
			document.head.appendChild(styleTag);
		}
		function cx() { var out = []; for (var i = 0; i < arguments.length; i++) if (typeof arguments[i] === "string" && arguments[i] !== "") out.push(arguments[i]); return out.join(" "); }
		var CHEVRON = h("svg", { width: 14, height: 14, viewBox: "0 0 14 14", fill: "currentColor", "aria-hidden": "true" }, h("path", { d: "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z" }));
		//#region src/client/index.ts
		/**
		 * dsh-provider-veark — client 侧：设置 → 插件 页的配置卡片。
		 *
		 * 挂载：settings.plugin.item（keyed 槽位，key = 本插件 settings 命名空间
		 * `dsh-provider-veark`）。表单语义对齐 dsh-client-ui-settings-plugins 的
		 * CardForm：字段显示生效值（用户层 > 组合层 > schema 默认）与是否被覆盖；
		 * 空文本 = 清除覆盖；保存逐字段 set/unset 写回 settings.yaml（热生效）。
		 *
		 * v0.1.3：常用项直出（Files 开关 + 密钥名），其余按「接口地址 / 图片处理 /
		 * 超时与重试」三组 <details> 折叠；另有模型列表小节；全部文案自然语言化。
		 */
		var NS = "dsh-provider-veark";
		var inject = ["slots", "locale", "settingsScope", "connection", "remote"];
		function textField(field) {
			return {
				field: field,
				kind: "text",
				format: function (value) { return typeof value === "string" ? value : ""; },
				parse: function (text) {
					var trimmed = text.trim();
					if (trimmed === "") return { clear: true };
					return { set: trimmed };
				}
			};
		}
		function numberField(field) {
			return {
				field: field,
				kind: "number",
				format: function (value) { return typeof value === "number" ? String(value) : ""; },
				parse: function (text) {
					var trimmed = text.trim();
					if (trimmed === "") return { clear: true };
					var parsed = Number(trimmed);
					return Number.isFinite(parsed) ? { set: parsed } : null;
				}
			};
		}
		function boolField(field) {
			return {
				field: field,
				kind: "bool",
				format: function (value) { return value === true; },
				parse: function (checked) { return { set: checked === true }; }
			};
		}
		var SPECS = [
			boolField("preferFiles"),
			textField("apiKeyEnv"),
			textField("chatBaseURL"),
			textField("filesBaseURL"),
			textField("filesApiKeyEnv"),
			numberField("requestImagePixelBudget"),
			numberField("requestImageMaxBytes"),
			numberField("fileExpirySeconds"),
			numberField("filesApiTimeoutMs"),
			numberField("filesProbeIntervalMs")
		];
		/** 折叠分组：summary 文案 + 收纳的字段（字段定义仍在 SPECS）。 */
		var GROUPS = [
			{ key: "groupEndpoints", fields: ["chatBaseURL", "filesBaseURL", "filesApiKeyEnv"] },
			{ key: "groupImage", fields: ["requestImagePixelBudget", "requestImageMaxBytes", "fileExpirySeconds"] },
			{ key: "groupAdvanced", fields: ["filesApiTimeoutMs", "filesProbeIntervalMs"] }
		];

	/** 客户端默认模型目录（与 lib/adapter.js DEFAULT_MODELS 对齐）。 */
	var DEFAULT_CLIENT_MODELS = [{
		id: "ark-code-latest",
		name: "Ark Code Latest",
		contextWindow: 1000000,
		maxTokens: 128000,
		inputModalities: ["text", "image"],
		imagePixelBudget: 640000,
		imageMaxBytes: 1048576
	}];

	function cloneModelDraft(model) {
		return Object.assign({}, model, {
			inputModalities: Array.isArray(model.inputModalities) ? model.inputModalities.slice() : ["text"],
			_contextRaw: formatTokens(model.contextWindow),
			_maxRaw: formatTokens(model.maxTokens),
			_contextInvalid: false,
			_maxInvalid: false
		});
	}
	function normalizeModelDraft(model) {
		var out = {};
		for (var key in model) {
			if (key === "_contextRaw" || key === "_maxRaw" || key === "_contextInvalid" || key === "_maxInvalid") continue;
			out[key] = model[key];
		}
		return out;
	}
	function formatTokens(value) {
		if (typeof value !== "number" || !Number.isFinite(value)) return "";
		if (value % 1000000 === 0 && value >= 1000000) return String(value / 1000000) + "M";
		if (value % 1000 === 0 && value >= 1000) return String(value / 1000) + "K";
		return String(value);
	}
	function parseTokens(text) {
		var trimmed = String(text == null ? "" : text).trim().toUpperCase();
		if (trimmed === "") return null;
		var match = /^(\d+)([KM]?)$/.exec(trimmed);
		if (!match) return null;
		var n = Number(match[1]);
		if (!Number.isSafeInteger(n)) return null;
		if (match[2] === "K") n *= 1000;
		if (match[2] === "M") n *= 1000000;
		return n;
	}
	function modelInvalid(model) {
		return !model || typeof model.id !== "string" || model.id.trim() === "" || typeof model.name !== "string" || model.name.trim() === "" || model._contextInvalid === true || model._maxInvalid === true;
	}

		/** 暂存式表单：读 scope 快照、暂存编辑、保存时逐字段 set/unset。 */
		var Form = class {
			scope;
			specs;
			staged = new Map();
			stagedModels = null;
			listeners = new Set();
			saving = false;
			failed = false;
			constructor(scope, secrets = []) {
				this.scope = scope;
				this.specs = new Map(SPECS.map(function (spec) { return [spec.field, spec]; }));
				this.secretSpecs = new Map(secrets.map(function (spec) { return [spec.field, spec]; }));
				scope.subscribe(function () { this.publish(); }.bind(this));
			}
			bind(project) {
				var self = this;
				var store = createSnapshotStore(project());
				this.listeners.add(function () { store.set(project()); });
				return store;
			}
			publish() {
				for (var listener of this.listeners) listener();
			}
			spec(field) {
				var spec = this.specs.get(field);
				if (spec === void 0) throw new Error("veark card has no field " + field);
				return spec;
			}
			snapshotOf() { return this.scope.getSnapshot(); }
			sectionValue(field) { return this.snapshotOf().value ? this.snapshotOf().value[field] : void 0; }
			baseValue(field) { return this.snapshotOf().base ? this.snapshotOf().base[field] : void 0; }
			userLayer() { return this.snapshotOf().user; }
			stored(field) {
				var user = this.userLayer();
				return user !== void 0 && Object.hasOwn(user, field);
			}
			modelsValue() {
				var value = this.sectionValue("models");
				return Array.isArray(value) && value.length > 0 ? value : DEFAULT_CLIENT_MODELS;
			}
			models() {
				if (this.stagedModels !== null) return this.stagedModels;
				return this.modelsValue().map(cloneModelDraft);
			}
			modelsDirty() {
				if (this.stagedModels === null) return false;
				var current = JSON.stringify(this.modelsValue());
				var next = JSON.stringify(this.stagedModels.map(normalizeModelDraft));
				return current !== next;
			}
			modelsInvalid() {
				var models = this.models();
				var seen = /* @__PURE__ */ new Set();
				for (var model of models) {
					if (modelInvalid(model)) return true;
					if (seen.has(model.id.trim())) return true;
					seen.add(model.id.trim());
				}
				return false;
			}
			editModels(next) {
				this.stagedModels = next;
				this.failed = false;
				this.publish();
			}
			addModel() {
				var draft = cloneModelDraft({
					id: "",
					name: "",
					contextWindow: void 0,
					maxTokens: void 0,
					inputModalities: ["text"]
				});
				draft._contextInvalid = true;
				draft._maxInvalid = true;
				this.editModels(this.models().concat([draft]));
			}
			removeModel(index) {
				var current = this.models();
				if (current[index] && current[index].id === "ark-code-latest") return;
				var next = current.slice();
				next.splice(index, 1);
				this.editModels(next);
			}
			field(field) {
				var staged = this.staged.get(field);
				if (this.secretSpecs.has(field)) return { text: staged ? staged.text : "", overridden: false, invalid: false };
				var spec = this.spec(field);
				if (spec.kind === "bool") {
					if (staged === void 0) return { checked: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false };
					if (staged.clear) return { checked: spec.format(this.baseValue(field)), overridden: false, invalid: false };
					return { checked: staged.checked === true, overridden: true, invalid: false };
				}
				if (staged === void 0) return { text: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false };
				if (staged.clear) return { text: "", overridden: false, invalid: false };
				var write = spec.parse(staged.text);
				return { text: staged.text, overridden: write !== null && write.set !== void 0, invalid: write === null };
			}
			shell() {
				var snapshot = this.scope.getSnapshot();
				var plan = this.plan();
				return {
					available: snapshot.status === "ready",
					writable: snapshot.writable,
					dirty: plan.length > 0,
					invalid: plan.some(function (item) { return item.run === void 0; }),
					saving: this.saving,
					failed: this.failed
				};
			}
			plan() {
				var self = this;
				var plan = [];
				for (const entry of this.staged) {
					const field = entry[0];
					const staged = entry[1];
					const secret = this.secretSpecs.get(field);
					if (secret !== void 0) {
						const secretValue = staged.text.trim();
						if (secretValue !== "") plan.push({ field: field, run: function () { return secret.write(secretValue); } });
						continue;
					}
					const spec = this.spec(field);
					const runUnset = function () { return self.unset(field); };
					if (spec.kind === "bool") {
						if (staged.clear) {
							if (self.stored(field)) plan.push({ field: field, run: runUnset });
							continue;
						}
						if (staged.checked !== spec.format(self.sectionValue(field))) {
							const value = staged.checked === true;
							plan.push({ field: field, run: function () { return self.set(field, value); } });
						}
						continue;
					}
					if (staged.clear) {
						if (self.stored(field)) plan.push({ field: field, run: runUnset });
						continue;
					}
					if (staged.text === spec.format(self.sectionValue(field))) continue;
					var write = spec.parse(staged.text);
					if (write === null) plan.push({ field: field, run: void 0 });
					else if (write.clear) plan.push({ field: field, run: runUnset });
					else {
						const value = write.set;
						plan.push({ field: field, run: function () { return self.set(field, value); } });
					}
				}
				if (this.modelsDirty()) {
					plan.push({
						field: "models",
						run: this.modelsInvalid() ? void 0 : function () { return self.set("models", self.stagedModels.map(normalizeModelDraft)); }
					});
				}
				return plan;
			}
			async set(field, value) {
				await this.scope.set(field, value);
				var user = this.userLayer();
				return user !== void 0 && JSON.stringify(user[field]) === JSON.stringify(value);
			}
			async unset(field) {
				await this.scope.unset(field);
				return !this.stored(field);
			}
			async save() {
				var self = this;
				var plan = this.plan();
				var writes = plan.filter(function (item) { return item.run !== void 0; }).map(function (item) { return item.run; });
				if (plan.length === 0 || this.saving || writes.length !== plan.length) return;
				this.saving = true;
				this.failed = false;
				this.publish();
				var landed = true;
				for (var write of writes) landed = await write() && landed;
				if (landed) {
					this.staged.clear();
					this.stagedModels = null;
				}
				this.saving = false;
				this.failed = !landed;
				this.publish();
			}
			actions() {
				var self = this;
				return {
					edit: function (field, text) { self.staged.set(field, { text: text, clear: false }); self.failed = false; self.publish(); },
					editBool: function (field, checked) { self.staged.set(field, { checked: checked }); self.failed = false; self.publish(); },
					resetField: function (field) {
						var spec = self.spec(field);
						if (spec.kind === "bool") self.staged.set(field, { clear: true });
						else self.staged.set(field, { text: spec.format(self.baseValue(field)), clear: true });
						self.failed = false;
						self.publish();
					},
					save: function () { return self.save(); },
					editModels: function (next) { return self.editModels(next); },
					addModel: function () { return self.addModel(); },
					removeModel: function (index) { return self.removeModel(index); },
					discard: function () {
						if (self.staged.size === 0 && self.stagedModels === null && !self.failed) return;
						self.staged.clear();
						self.stagedModels = null;
						self.failed = false;
						self.publish();
					}
				};
			}
		};
		var zh = {
			title: "火山方舟 Coding Plan",
			description: "通过火山方舟 Coding Plan 对话；图片自动走云端文件服务，失败自动回退内联发送。",
			groupEndpoints: "接口地址",
			groupEndpointsHint: "一般保持默认即可",
			groupImage: "图片处理",
			groupImageHint: "发送前的自动缩放与压缩",
			groupAdvanced: "超时与重试",
			groupAdvancedHint: "上传不可用时的兜底节奏",
			modelList: "模型列表",
			modelListHint: "每个模型一个块；默认 ark-code-latest 不可删除。",
			modelId: "模型 ID",
			modelName: "模型名称",
			modelContext: "上下文窗口",
			modelMaxTokens: "最大输出",
			modelCapabilities: "模型能力",
			addModel: "新增模型",
			deleteModel: "删除",
			invalidModel: "请完整填写模型 ID、模型名称、上下文窗口和最大输出，且 ID 不能重复。",
			preferFiles: "图片走云端文件服务",
			preferFilesHint: "开启（推荐）：图片先上传到方舟，对话里只传文件引用，多轮对话更快更省流量；关闭：每次请求都内联整张图片，兼容性最好但更慢。",
			apiKeyEnv: "密钥名称",
			apiKeyEnvHint: "凭据服务里保存的密钥名，默认 ARK_API_KEY（火山官方 SDK 与 ark-cli 的约定名）；也可以在启动环境里导出同名变量。可改成任意自定义名称。",
			keyValue: "密钥值",
			keyValueHint: "写入凭据服务的密钥本体：不会出现在 settings.yaml，保存后也不回显。留空表示保持当前密钥。",
			keySet: "已配置",
			keyUnset: "未配置",
			chatBaseURL: "对话接口地址",
			chatBaseURLHint: "保持默认的 coding 网关（…/api/coding/v3）才会按 Coding Plan 套餐计费；改错可能变成按量付费。留空恢复默认。",
			filesBaseURL: "图片上传接口地址",
			filesBaseURLHint: "默认标准域（…/api/v3）。若上传报 403/无权限，改成与对话相同的 coding 网关地址即可。留空恢复默认。",
			filesApiKeyEnv: "图片上传专用密钥名",
			filesApiKeyEnvHint: "一般留空（与上方密钥共用）。仅当上传接口要求单独的密钥时才填。",
			requestImagePixelBudget: "图片清晰度上限（总像素）",
			requestImagePixelBudgetHint: "发送前图片会自动缩放到不超过这个总像素数（宽×高）。默认 640000 ≈ 800×800；想要更清晰可调大，比如 4194304（2048×2048）。",
			requestImageMaxBytes: "单张图片大小上限（字节）",
			requestImageMaxBytesHint: "图片编码后超过这个大小会继续压缩。默认 1048576（1 MiB）。",
			fileExpirySeconds: "云端图片保留时长（秒）",
			fileExpirySecondsHint: "上传的图片在方舟侧的估计保留时长，到期会自动重新上传。默认 604800（7 天）。",
			filesApiTimeoutMs: "上传超时（毫秒）",
			filesApiTimeoutMsHint: "图片上传最长等待时间，超时会自动改用 base64 发送。默认 15000（15 秒）。",
			filesProbeIntervalMs: "上传失败重试间隔（毫秒）",
			filesProbeIntervalMsHint: "上传不可用期间会用 base64 兜底，并每隔这个时长重试上传。默认 21600000（6 小时）。",
			numberHint: "留空表示使用默认值。",
			overridden: "已自定义",
			reset: "恢复默认",
			invalidNumber: "请填数字；留空表示使用默认值。",
			save: "保存",
			saving: "保存中…",
			discard: "放弃修改",
			unavailable: "设置服务不可用。",
			readOnly: "当前环境只读。",
			saveFailed: "保存未完全落盘，请检查后重试。",
			modelsHint: "模型目录、分片步长等更多高级字段：编辑 settings.yaml 的 dsh-provider-veark 段，保存即热生效。",
			expand: "展开",
			collapse: "收起",
			unsaved: "未保存"
		};
		var en = {
			title: "Volcengine Ark Coding Plan",
			description: "Chat via the Volcengine Ark Coding Plan; images go through the cloud file service with automatic inline fallback.",
			groupEndpoints: "Endpoints",
			groupEndpointsHint: "Defaults are fine for most setups",
			groupImage: "Image handling",
			groupImageHint: "Automatic downscaling and compression before sending",
			groupAdvanced: "Timeouts & retries",
			groupAdvancedHint: "Fallback rhythm while uploads are unavailable",
			modelList: "Model list",
			modelListHint: "One block per model; the default ark-code-latest cannot be removed.",
			modelId: "Model ID",
			modelName: "Model name",
			modelContext: "Context window",
			modelMaxTokens: "Max output",
			modelCapabilities: "Capabilities",
			addModel: "Add model",
			deleteModel: "Delete",
			invalidModel: "Fill in model ID, model name, context window and max output for every model, and keep IDs unique.",
			preferFiles: "Use cloud file service for images",
			preferFilesHint: "On (recommended): images upload to Ark once and chats reference the file — faster multi-turn and less traffic. Off: every request inlines the full image — most compatible but slower.",
			apiKeyEnv: "Credential name",
			apiKeyEnvHint: "The key's name in the credential service; defaults to ARK_API_KEY (the official Ark SDK / ark-cli convention). Exporting the same variable in the launch environment also works. Any custom name is fine.",
			keyValue: "Key value",
			keyValueHint: "Writes the credential literal to the credential service: never stored in settings.yaml and never echoed back. Empty keeps the current key.",
			keySet: "Configured",
			keyUnset: "Not configured",
			chatBaseURL: "Chat endpoint",
			chatBaseURLHint: "Keep the default coding gateway (…/api/coding/v3) to stay on Coding Plan billing; a wrong value may fall into pay-per-token. Empty restores the default.",
			filesBaseURL: "Image upload endpoint",
			filesBaseURLHint: "Defaults to the standard domain (…/api/v3). If uploads get 403/no-permission, use the same coding gateway as chat. Empty restores the default.",
			filesApiKeyEnv: "Upload-only credential name",
			filesApiKeyEnvHint: "Usually empty (shares the key above). Only needed when the upload endpoint requires its own credential.",
			requestImagePixelBudget: "Image clarity cap (total pixels)",
			requestImagePixelBudgetHint: "Images are downscaled to fit within this total pixel count (width × height) before sending. Default 640000 ≈ 800×800; raise for sharper images, e.g. 4194304 (2048×2048).",
			requestImageMaxBytes: "Per-image size cap (bytes)",
			requestImageMaxBytesHint: "Images are recompressed when the encoded size exceeds this. Default 1048576 (1 MiB).",
			fileExpirySeconds: "Cloud image retention (seconds)",
			fileExpirySecondsHint: "Estimated retention of uploaded images on Ark; expired images re-upload automatically. Default 604800 (7 days).",
			filesApiTimeoutMs: "Upload timeout (ms)",
			filesApiTimeoutMsHint: "Max wait for an upload; on timeout the request falls back to inline base64. Default 15000 (15 s).",
			filesProbeIntervalMs: "Retry interval after failures (ms)",
			filesProbeIntervalMsHint: "While uploads are unavailable the plugin falls back to base64 and re-probes at this interval. Default 21600000 (6 h).",
			numberHint: "Empty means the default value.",
			overridden: "customized",
			reset: "reset",
			invalidNumber: "Enter a number; empty means default.",
			save: "Save",
			saving: "Saving…",
			discard: "Discard",
			unavailable: "Settings service unavailable.",
			readOnly: "Read-only environment.",
			saveFailed: "Save did not fully land; review and retry.",
			modelsHint: "More advanced knobs (per-model catalog, offload sizes, etc.) live in the dsh-provider-veark section of settings.yaml (hot-reloaded).",
			expand: "Expand",
			collapse: "Collapse",
			unsaved: "Unsaved"
		};
		function labelStyle() {
			return { display: "block", fontSize: 12, color: "var(--dsw-alias-label-secondary, #666)", marginBottom: 4 };
		}
		function inputStyle(invalid) {
			return { width: "100%", boxSizing: "border-box", fontSize: 13, padding: "6px 8px", borderRadius: 6, border: "1px solid " + (invalid ? "var(--dsw-alias-state-danger-primary, #d33)" : "var(--dsw-alias-border-l2, #ccc)"), background: "transparent", color: "inherit" };
		}
		function buttonStyle(primary) {
			return { fontSize: 13, padding: "6px 14px", borderRadius: 6, cursor: "pointer", border: "1px solid " + (primary ? "var(--dsw-alias-state-business-primary, #4d6bfe)" : "var(--dsw-alias-border-l2, #ccc)"), background: primary ? "var(--dsw-alias-state-business-primary, #4d6bfe)" : "transparent", color: primary ? "#fff" : "inherit" };
		}
		function summaryStyle() {
			return { cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--dsw-alias-label-primary, #333)", userSelect: "none", padding: "4px 0", listStyle: "revert" };
		}
		/** 单字段行：label + 控件 + 覆盖标记/恢复默认 + 提示。 */
		function FieldRow(props) {
			var spec = props.spec;
			var state = props.state;
			var t = props.t;
			var disabled = props.disabled;
			var kids = [];
			if (spec.kind === "bool") {
				kids.push(h("label", { key: "ctl", style: { display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, cursor: disabled ? "default" : "pointer" } }, [
					h("input", { key: "box", type: "checkbox", checked: state.checked === true, disabled: disabled, style: { marginTop: 2 }, onChange: function (e) { props.onEditBool(e.target.checked); } }),
					h("span", { key: "text" }, [
						h("span", { key: "label", style: { display: "block" } }, t(spec.labelKey) + (state.overridden ? " · " + t("overridden") : "")),
						h("span", { key: "hint", style: { display: "block", fontSize: 11, color: "var(--dsw-alias-label-tertiary, #999)", marginTop: 2 } }, t(spec.hintKey))
					])
				]));
			} else {
				kids.push(h("span", { key: "label", style: labelStyle() }, t(spec.labelKey) + (state.overridden ? " · " + t("overridden") : "")));
				kids.push(h("input", { key: "ctl", type: "text", value: state.text, disabled: disabled, style: inputStyle(state.invalid), onChange: function (e) { props.onEdit(e.target.value); } }));
				kids.push(h("div", { key: "meta", style: { display: "flex", gap: 10, alignItems: "baseline", marginTop: 3 } }, [
					h("span", { key: "hint", style: { fontSize: 11, color: "var(--dsw-alias-label-tertiary, #999)", flex: "1" } }, t(spec.hintKey)),
					state.invalid ? h("span", { key: "invalid", style: { fontSize: 11, color: "var(--dsw-alias-state-danger-primary, #d33)" } }, t("invalidNumber")) : null,
					state.overridden ? h("button", { key: "reset", type: "button", onClick: props.onReset, disabled: disabled, style: { fontSize: 11, cursor: "pointer", background: "none", border: "none", color: "var(--dsw-alias-label-tertiary, #999)", textDecoration: "underline", padding: 0 } }, t("reset")) : null
				]));
			}
			return h("div", { style: { marginBottom: 12 } }, kids);
		}
		/** 折叠分组行：<details> 原生收展。 */
		function GroupSection(props) {
			var group = props.group;
			var t = props.t;
			return h("details", { style: { borderTop: "1px solid var(--dsw-alias-border-l2, #e5e5e5)", paddingTop: 8, marginTop: 4 } }, [
				h("summary", { key: "s", style: summaryStyle() }, [
					t(group.key),
					h("span", { key: "hint", style: { fontWeight: 400, fontSize: 11, color: "var(--dsw-alias-label-tertiary, #999)", marginLeft: 8 } }, t(group.key + "Hint"))
				]),
				h("div", { key: "body", style: { paddingTop: 8 } }, group.fields.map(function (field) {
					return h(FieldRow, {
						key: field,
						spec: { field: field, kind: props.specs[field].kind, labelKey: field, hintKey: field + "Hint" },
						state: props.fields[field],
						disabled: props.disabled,
						t: t,
						onEdit: function (text) { props.edit(field, text); },
						onReset: function () { props.resetField(field); }
					});
				}))
			]);
		}
		/** 模型块：五个字段（ID/名称/上下文/最大输出/能力）+ 删除按钮。 */
		function ModelBlock(props) {
			var model = props.model;
			var index = props.index;
			var t = props.t;
			var disabled = props.disabled;
			var canDelete = model.id !== "ark-code-latest";
			var kids = [];
			kids.push(h("div", { key: "head", style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 } }, [
				h("span", { key: "title", style: { fontSize: 13, fontWeight: 600 } }, model.name || model.id || "#" + (index + 1)),
				canDelete ? h("button", { key: "del", type: "button", disabled: disabled, onClick: function () { props.onRemove(index); }, style: { fontSize: 12, cursor: disabled ? "default" : "pointer", background: "none", border: "none", color: "var(--dsw-alias-state-danger-primary, #d33)", padding: 0 } }, t("deleteModel")) : null
			]));
			kids.push(h("span", { key: "idLabel", style: labelStyle() }, t("modelId")));
			kids.push(h("input", { key: "id", type: "text", value: model.id || "", disabled: disabled, style: inputStyle(false), onChange: function (e) { props.onChange(index, { id: e.target.value }); } }));
			kids.push(h("span", { key: "nameLabel", style: Object.assign({ marginTop: 8 }, labelStyle()) }, t("modelName")));
			kids.push(h("input", { key: "name", type: "text", value: model.name || "", disabled: disabled, style: inputStyle(false), onChange: function (e) { props.onChange(index, { name: e.target.value }); } }));
			kids.push(h("span", { key: "ctxLabel", style: Object.assign({ marginTop: 8 }, labelStyle()) }, t("modelContext")));
			kids.push(h("input", { key: "ctx", type: "text", value: model._contextRaw || "", disabled: disabled, placeholder: "1M / 1000000", style: inputStyle(model._contextInvalid === true), onChange: function (e) { var raw = e.target.value; var parsed = parseTokens(raw); props.onChange(index, { _contextRaw: raw, _contextInvalid: parsed === null, contextWindow: parsed === null ? model.contextWindow : parsed }); } }));
			kids.push(h("span", { key: "maxLabel", style: Object.assign({ marginTop: 8 }, labelStyle()) }, t("modelMaxTokens")));
			kids.push(h("input", { key: "max", type: "text", value: model._maxRaw || "", disabled: disabled, placeholder: "128K / 128000", style: inputStyle(model._maxInvalid === true), onChange: function (e) { var raw = e.target.value; var parsed = parseTokens(raw); props.onChange(index, { _maxRaw: raw, _maxInvalid: parsed === null, maxTokens: parsed === null ? model.maxTokens : parsed }); } }));
			kids.push(h("span", { key: "capLabel", style: Object.assign({ marginTop: 8 }, labelStyle()) }, t("modelCapabilities")));
			kids.push(h("div", { key: "caps", style: { display: "flex", gap: 12, marginBottom: 4 } }, ["text", "image"].map(function (mod) {
				var checked = (model.inputModalities || []).indexOf(mod) !== -1;
				return h("label", { key: mod, style: { display: "flex", alignItems: "center", gap: 4, fontSize: 13, cursor: disabled ? "default" : "pointer" } }, [
					h("input", { key: "box", type: "checkbox", checked: checked, disabled: disabled, onChange: function (e) { var next = (model.inputModalities || []).slice(); if (e.target.checked) { if (next.indexOf(mod) === -1) next.push(mod); } else { next = next.filter(function (x) { return x !== mod; }); } if (next.length === 0) next = ["text"]; props.onChange(index, { inputModalities: next }); } }),
					h("span", { key: "text" }, mod)
				]);
			})));
			return h("div", { key: "block" + index, style: { border: "1px solid var(--dsw-alias-border-l2, #e5e5e5)", borderRadius: 8, padding: 10, marginBottom: 10 } }, kids);
		}
		/** 模型列表小节：多个模型块 + 新增按钮，可折叠。 */
		function ModelListSection(props) {
			var t = props.t;
			var models = props.models;
			var disabled = props.disabled;
			var invalid = props.invalid;
			return h("details", { key: "models", style: { borderTop: "1px solid var(--dsw-alias-border-l2, #e5e5e5)", paddingTop: 8, marginTop: 4 } }, [
				h("summary", { key: "s", style: summaryStyle() }, [
					t("modelList"),
					h("span", { key: "hint", style: { fontWeight: 400, fontSize: 11, color: "var(--dsw-alias-label-tertiary, #999)", marginLeft: 8 } }, t("modelListHint"))
				]),
				h("div", { key: "body", style: { paddingTop: 8 } }, [
					models.map(function (model, index) {
						return h(ModelBlock, { key: "model-" + index, model: model, index: index, t: t, disabled: disabled, onChange: props.onChange, onRemove: props.onRemove });
					}),
					invalid ? h("p", { key: "invalid", style: { fontSize: 11, color: "var(--dsw-alias-state-danger-primary, #d33)", margin: "0 0 8px" } }, t("invalidModel")) : null,
					h("button", { key: "add", type: "button", disabled: disabled, onClick: props.onAdd, style: buttonStyle(false) }, t("addModel"))
				])
			]);
		}
		function VeArkCard(props) {
			var openState = useState(false);
			var open = openState[0];
			var setOpen = openState[1];
			var state = props.useVearkCard(function (snapshot) { return snapshot; });
			var t = props.t;
			if (!state.available) return null;
			var disabled = !state.writable || state.saving;
			var title = t("title");
			var header = h("button", {
				key: "head",
				type: "button",
				className: CARD.header,
				"aria-expanded": open,
				"aria-label": (open ? t("collapse") : t("expand")) + ": " + title,
				onClick: function () { setOpen(!open); }
			}, [
				h("span", { key: "text", className: CARD.headText }, [
					h("span", { key: "name", className: CARD.name }, title),
					h("span", { key: "desc", className: CARD.description }, t("description"))
				]),
				state.dirty ? h("span", { key: "pending", className: CARD.pending }, t("unsaved")) : null,
				h("span", { key: "chev", className: cx(CARD.chevron, open && CARD.chevronOpen), "aria-hidden": "true" }, CHEVRON)
			]);
			var body = h("div", { key: "body", className: CARD.body }, [
				!state.writable ? h("p", { key: "ro", role: "status", className: CARD.readOnly }, t("readOnly")) : null,
				h("div", { key: "direct", style: { marginTop: 12, marginBottom: 6 } }, [
					h(FieldRow, { key: "preferFiles", spec: { field: "preferFiles", kind: "bool", labelKey: "preferFiles", hintKey: "preferFilesHint" }, state: state.fields.preferFiles, disabled: disabled, t: t, onEditBool: function (checked) { props.editBool("preferFiles", checked); } }),
					h(FieldRow, { key: "apiKeyEnv", spec: { field: "apiKeyEnv", kind: "text", labelKey: "apiKeyEnv", hintKey: "apiKeyEnvHint" }, state: state.fields.apiKeyEnv, disabled: disabled, t: t, onEdit: function (text) { props.edit("apiKeyEnv", text); }, onReset: function () { props.resetField("apiKeyEnv"); } }),
					h("div", { key: "keyValue", style: { marginBottom: 12 } }, [
						h("span", { key: "label", style: labelStyle() }, t("keyValue") + " · " + (state.keyConfigured ? t("keySet") : t("keyUnset")) + "（" + state.keyRef + "）"),
						h("input", { key: "ctl", type: "password", autoComplete: "new-password", value: state.keyValue.text, disabled: disabled || !state.keyWritable, placeholder: state.keyConfigured ? "留空表示保持当前密钥" : "粘贴密钥后点保存", style: inputStyle(false), onChange: function (e) { props.edit("keyValue", e.target.value); } }),
						h("div", { key: "meta", style: { fontSize: 11, color: "var(--dsw-alias-label-tertiary, #999)", marginTop: 3 } }, t("keyValueHint"))
					])
				]),
				h(ModelListSection, {
					key: "modelList",
					models: state.models,
					invalid: state.modelsInvalid,
					disabled: disabled,
					t: t,
					onChange: function (index, patch) {
						var next = state.models.slice();
						next[index] = Object.assign({}, next[index], patch);
						props.editModels(next);
					},
					onAdd: function () { props.addModel(); },
					onRemove: function (index) { props.removeModel(index); }
				}),
				h("div", { key: "groups" }, GROUPS.map(function (group) {
					return h(GroupSection, {
						key: group.key,
						group: group,
						specs: props.specsOf(),
						fields: state.fields,
						disabled: disabled,
						t: t,
						edit: props.edit,
						resetField: props.resetField
					});
				})),
				h("p", { key: "modelsHint", style: { fontSize: 11, color: "var(--dsw-alias-label-tertiary, #999)", margin: "10px 0" } }, t("modelsHint")),
				h("div", { key: "foot", className: CARD.footer }, [
					state.failed ? h("p", { key: "failed", role: "status", className: CARD.failed }, t("saveFailed")) : null,
					h("button", { key: "save", type: "button", className: CARD.save, disabled: disabled || !state.dirty || state.invalid, onClick: props.save }, state.saving ? t("saving") : t("save")),
					h("button", { key: "discard", type: "button", className: CARD.discard, disabled: disabled || !state.dirty, onClick: props.discard }, t("discard"))
				])
			]);
			return h("li", { className: cx(CARD.card, open && CARD.cardOpen) }, [header, open ? body : null]);
		}
		/** 卡片控制器：把 bound settings scope 桥接为暂存表单 + 组件注入面。 */
		var VeArkCardController = class {
			scope;
			api;
			form;
			store;
			credential = { ref: "", configured: false, writable: true };
			constructor(scope, api) {
				this.scope = scope;
				this.api = api;
				this.form = new Form(scope, [{ field: "keyValue", write: function (text) { return this.writeKey(text); }.bind(this) }]);
				this.store = this.form.bind(function () { return this.projection(); }.bind(this));
				scope.subscribe(function () { this.readCredential(); }.bind(this));
				this.readCredential();
			}
			/** 凭据引用：settings 段命名的名字，缺省回落 ARK_API_KEY。 */
			refOf() {
				var snapshot = this.scope.getSnapshot();
				var declared = snapshot.value ? snapshot.value.apiKeyEnv : void 0;
				return declared !== void 0 && declared.length > 0 ? declared : "ARK_API_KEY";
			}
			async readCredential() {
				var self = this;
				var ref = this.refOf();
				if (ref !== this.credential.ref) {
					this.credential = { ref: ref, configured: false, writable: true };
					this.store.set(this.projection());
				}
				if (!this.api) return;
				var response;
				try {
					response = await this.api.credentials.describe({ refs: [ref] });
				} catch (failure) { return; }
				if (!response.result.ok || ref !== this.refOf()) return;
				var view = response.result.value.credentials[ref];
				var next = { ref: ref, configured: view ? view.configured === true : false, writable: view ? view.writable !== false : true };
				if (next.configured === this.credential.configured && next.writable === this.credential.writable) return;
				this.credential = next;
				this.store.set(this.projection());
			}
			refreshCredential(ref) {
				if (ref !== this.credential.ref) return;
				this.readCredential();
			}
			async writeKey(value) {
				if (!this.api) return false;
				try {
					await this.api.credentials.set({ ref: this.refOf(), value: value });
				} catch (failure) {}
				await this.readCredential();
				return this.credential.configured;
			}
			projection() {
				var fields = {};
				for (var spec of SPECS) fields[spec.field] = this.form.field(spec.field);
				var keyValue = this.form.field("keyValue");
				fields.keyValue = keyValue;
				return Object.assign({}, this.form.shell(), {
					fields: fields,
					keyValue: keyValue,
					keyRef: this.credential.ref,
					keyConfigured: this.credential.configured,
					keyWritable: this.credential.writable,
					models: this.form.models(),
					modelsInvalid: this.form.modelsInvalid()
				});
			}
			/** 供组件按字段名取 kind（分组渲染用）。 */
			specsOf() {
				var map = {};
				for (var spec of SPECS) map[spec.field] = spec;
				return map;
			}
			inject() {
				var self = this;
				return Object.assign({ hooks: { vearkCard: this.store }, specsOf: function () { return self.specsOf(); } }, this.form.actions());
			}
		};
		function apply(ctx) {
			var t = ctx.locale.bind(NS);
			ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, "veark card: locale dictionary");
			var scope = ctx.settingsScope.bind({ namespace: NS });
			var connection = ctx.get("connection");
			var api = connection !== void 0 ? connection.api : void 0;
			var controller = new VeArkCardController(scope, api);
			ctx.effect(function () { return ctx.remote.$on("credentials/reference-updated", function (ref) { controller.refreshCredential(ref); }); }, "veark card: credential invalidations");
			ctx.slots.inject("settings.plugin.item", function* () {
				yield ctx.slots.register({
					name: "settings.plugin.item",
					key: NS,
					locale: NS,
					inject: function () { return controller.inject(); }
				}, VeArkCard);
			});
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
