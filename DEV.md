# DEV.md — 开发与交付说明

面向插件开发/维护者。用户文档见 [README.md](./README.md) / [README.en.md](./README.en.md)。

## 路线图：这个插件是怎么工作的

一句话：**对话与流式解析全权交给火山官方 SDK，插件自己只做“DSH 契约 ←→ 火山协议”的翻译层、图片管线、PDF 私有 sidecar 和降级状态机**。

```
用户消息（DSH 会话）
   │
   ▼
lib/index.js ── 安装时向宿主 llm 服务注册 provider `volcengine` + adapter + 设置分区
   │
   ▼
lib/adapter.js ── 把 DSH 消息（含图片块、工具调用）翻译成 Responses API 请求
   │                  │
   │                  ├─ 文本/流式：@volcengine/ark-runtime 的 createResponsesStream()
   │                  │   （官方 SDK 负责 SSE 解析、[DONE]、重试=0，事件再翻回 DSH StreamChunk）
   │                  │
   │                  └─ 图片：lib/pipeline.js
   │                        ├─ 收集请求里的全部图片引用（含嵌套 tool-result）
   │                        ├─ files 模式：lib/files-api.js（官方 SDK uploadFile）上传
   │                        │   → {type:"input_image", file_id}（去重 + 本地索引复用）
   │                        └─ base64 模式：{type:"input_image", image_url:"data:..."}
   │
   ├─ PDF：工作区 @相对路径（realpath 围栏）或 client 私有 Remote → UUID sidecar
   │        → 仅 volcengine adapter 扫描普通 user text、校验后展开为 base64 input_file
   │
   ▼
lib/policy.js ── 压缩预算（像素/字节）、Files 可用性状态机、状态持久化
   │              （上传失败 → 标记原因 → 降级 base64 → 按间隔重探）
   ▼
宿主 DSH（agent-loop 消费 adapter 流，密钥走凭据服务/环境变量解析）
```

### 自己写的模块（`lib/`）

| 模块 | 职责 |
|---|---|
| `index.js` | 装配：provider/adapter 注册、schemastery 设置分区、凭据解析链（凭据服务 → 环境变量） |
| `adapter.js` | DSH 消息 ↔ Responses wire 的翻译、DSH StreamChunk 事件翻译、超时看门狗、请求级重试 |
| `pipeline.js` | 图片管线：引用收集、上传去重（并发合并 promise）、`veark-` 前缀索引复用、配额回收 |
| `files-api.js` | Ark Files 传输层的错误分类（auth/notfound/timeout/network）、配额错误识别 |
| `policy.js` | 图片压缩预算（总像素/单图字节/low-detail）、FilesModeController 状态机、原子持久化 |
| `pdf-store.js` | provider 私有 PDF sidecar、session/SHA-256 校验、未使用暂存/可选保留期/孤立文件清理、`vearkPdf.stage` Remote |
| `typert.host.js` / `typert.remote-client.js` | PDF Remote 的 Host/Client 严格 Typert manifest |
| `client.js` | 设置卡片 + 仅对 `volcengine` 中显式声明 `pdf` 的模型可见的 PDF Composer 控件与 `/pdf` 输入源 |

### 走的现有 SDK / 宿主服务（自己不写）

| 依赖 | 用在哪 |
|---|---|
| `@volcengine/ark-runtime`（火山官方 SDK） | **对话流式**（`createResponsesStream()`，SSE/`[DONE]`/usage 全由它解析）与 **Files 传输**（`uploadFile`/`retrieveFile`/`listFiles`/`deleteFile`） |
| `@deepseek-ai/dsh-llm` | LlmAdapter 契约、LlmError、重试策略、图片句柄文本 |
| `@deepseek-ai/dsh-settings` | 设置分区安装、命名空间、热生效 |
| `@deepseek-ai/dsh-credentials` | 密钥存取（卡片"密钥值"控件写的就是它） |
| `@deepseek-ai/dsh-atomic-write` / `dsh-home-paths` / `dsh-launch-environment` / `dsh-timeout` | 原子写 + 文件锁、DSH_HOME 解析、启动环境变量回落、超时原语 |
| `@deepseek-ai/schemastery` | 设置 schema（provider 卡片与 settings.yaml 同源） |

### 关键设计取舍

- **SDK 管 wire，插件管语义**：SDK 只保证把 Responses 流接回来；DSH 要的是 StreamChunk、finish 语义、工具调用块——这层翻译（含 reasoning、tool-call、usage 映射）是 adapter 的核心工作量。
- **图片消息零硬失败**：files 上传被拒/超时/索引失效都收敛到 base64 重试，状态机只决定"下次先试哪条路"，不让用户消息死于图片。
- **双端点分离**：对话钉死 coding 网关（计费），files 域可切（可用性），互不牵连。
- **PDF 不扩展 Harness 通用消息 schema**：普通 user text 中的工作区 `@相对路径.pdf` 经 realpath 围栏读取；按钮经插件私有 Remote 暂存并写入 `@.dsh-pdf/<uuid>/<name>` 不可变引用。仅本 adapter 展开为 Coding Responses `input_file`。标准 `/api/v3/files` 返回的 PDF `file_id` 已实测不被 coding endpoint 接受。
- **cwd 安全降级**：per-session cwd 只读自 `$DSH_HOME/storages/session_projcache.json` 的 `identity.cwd`；该内部存储不可用或格式变化时，普通工作区 `@PDF` 原样放行，绝不降级到进程 cwd。绝对路径和越过工作区围栏的路径也原样放行。
- **PDF 能力采用模型目录显式许可**：默认 `ark-code-latest` 声明 `text/image/pdf`；自定义模型默认 `text`。客户端按当前选择隐藏或拦截 PDF，adapter 再于 sidecar 读取和网络请求前按同一声明兜底拒绝，不能仅凭 provider 名推断能力。

## 目录结构

```
lib/index.js      入口：注册 volcengine provider、adapter、设置分区（schemastery）
lib/adapter.js    Responses wire + @volcengine/ark-runtime SDK 流式 + 事件翻译 + 降级重试
lib/pipeline.js   图片管线：上传去重、file_id 索引、配额清理
lib/files-api.js  Ark Files 传输层（uploadFile / retrieveFile / listFiles / deleteFile）
lib/policy.js     图片预算、Files 可用性状态机、持久化
lib/pdf-store.js  PDF sidecar、Remote service、完整性与保留期清理
lib/typert.*.js   PDF Remote 的双端严格 manifest
lib/client.js     设置卡片 + PDF Composer 控件（无构建 bundle）
test/fixtures/    Ark PDF 端到端烟雾测试文档
test/             node:test 套件（unit / client-card / render / render-smoke）
cordis.patch.yml  bundle patch：向宿主合成树 insert 本插件（HOST-PLANE，与 dsh-llm-deepseek 同层）
```

## 测试

```bash
pnpm test   # node --test test/unit.test.mjs test/client-card.test.mjs test/render.test.mjs
```

- 全套 52 项：单元（文本、图片、PDF marker/工作区 `@`/虚拟 UUID 引用/围栏/sidecar/能力门控/清理/丢失/请求预算、降级状态机、配置装配）+ 客户端 PDF/设置流程 + 真实 React 渲染（18.3.1）+ 收起态冒烟。
- `.dsh-test` 真机 profile 已验证：`/pdf` 迁移提示、按钮 UUID 虚拟引用、非 volcengine 按钮隐藏、会话日志无 base64/新 marker、Ark 返回 `ARK_PDF_SMOKE`，以及 Harness 重启后的 sidecar 恢复。此前工作区相对与带空格引用因 session cwd 下文件不存在，只覆盖了失败原文放行；现已用两个独立 turn-1 会话、两个唯一标记及发送前 cwd/存在性/SHA-256 重新验证，分别从 `@workspace-at-real.pdf` 和 `@"workspace quoted real.pdf"` 得到仅存在于真实 PDF 中的 `AT_REAL_91C7X`、`QUOTED_4F2AXY`。
- `render-smoke.test.mjs` 已纳入 `pnpm test`。
- 沙箱/受限环境若 `node --test` 子进程隔离 spawn EPERM，可加 `--experimental-test-isolation=none` 在进程内执行。

## 发布（GitHub）

1. 修正 `package.json` 的 `repository.url` 占位符（`OWNER`）与 README 的安装命令（`<user>`）。
2. `pnpm publish` / npm 发布（scope 包首次发布需 `npm publish --access public`），或直接以 git 仓库作为安装源（`dsh.plugin.add` 支持 `github:<user>/<repo>`）。
3. `package.json` 的 `files` 白名单只带 `lib/`、`cordis.patch.yml`、README 与本文件。

## 运行状态（DSH_HOME/dsh-provider-veark/）

- `files-state.json`：`{mode, reason, checkedAt}` —— Files 可用性状态机（files-ok / files-unavailable(原因) / base64-only）。
- `files-index-v1.json`：附件 → file_id 索引（去重上传 + 7 天刷新 + 配额清理，只删本插件 `veark-` 前缀文件）。
- `../provider-veark/pdfs/<uuid>.{pdf,json}`：PDF sidecar 与 session/摘要/`usedAt` 元数据；已使用快照默认永久保留，未使用暂存和不完整孤儿按 24 小时宽限清理，`pdfRetentionDays` 可启用节流清理。
- 状态变化写入 DSH 日志（`dsh-provider-veark:` 前缀）。

## 回退 / 禁用（最坏情况恢复手册）

插件不修改任何宿主源码与 settings.yaml；足迹包括 profile 依赖/链接、`DSH_HOME/dsh-provider-veark/` 图片状态，以及 `DSH_HOME/provider-veark/pdfs/` PDF sidecar。

0. **诊断**（不启动即可看合成树）：`dsh --profile web --dump-config`
1. **软禁用**（可逆）：编辑 `profiles\web\cordis.patch.yml`，写入 `- id: dsh-provider-veark` + `disabled: true`；恢复即删。
2. **摘除层**：从 `profiles\web\package.json` 的 `dsh.profile.bundles` 删除 `"@icedcola/dsh-provider-veark"`。
3. **彻底卸载**：`dsh plugin --profile web remove @icedcola/dsh-provider-veark`（store 报错时加 `--store-dir D:\ProgramData\pnpm-store`）。
4. **可选清理**：删除 `DSH_HOME\dsh-provider-veark\` 和 `DSH_HOME\provider-veark\`；后者删除后历史 PDF token 不可恢复。
5. **警告**：`link:` 安装期间不要删除/移动工作区目录，否则 bundle 解析失效；要"拷贝式"安装先卸载再以目录重新 add。

## 设计要点与主要偏差（v0.1.0 起累计）

完整阶段验证记录见 git 历史中的 DELIVERY.md（v0.1.8）。要点：

- **manifest 形状**：`"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}` + `- insert:`（以 `@deepseek-ai/dsh` CLI 源码与社区实包为准，非 `"bundle": true`）。
- **inject = ["llm"]**；attachments 经 `ctx.get()` 可选解析，缺附件服务时仅图片功能报 UNSUPPORTED_CONTENT，插件整体仍可加载。
- **凭据解析链**：凭据服务未命中 → 回退启动环境变量 → MISSING_CREDENTIAL；默认引用 `ARK_API_KEY`（火山官方生态约定）。
- **chat 流式**：经 `@volcengine/ark-runtime` 的 `createResponsesStream()`；适配器只做 Responses 事件 → DSH StreamChunk 翻译。
- **上传不发送 `expire_at`**（避免 400 风险）；响应的 `expire_at`/`expires_at` 均兼容读取；`fileExpirySeconds` 语义为"响应缺字段时的假定寿命"。
- **服务端拒绝 file_id 后**：失效索引并直接切 base64 重试（比原样重传 file 更符合"网关不支持 file_id 块则重传无意义"）。
- **助手 reasoning 块不回放**：Responses 的 reasoning item 需服务端 id/encrypted_content，dsh 内容块未持久化（协议差异，非遗漏）。
- **双端点分离**：对话走 coding 网关；图片上传域独立可配。实测（2026-08）标准域 files 端点对 coding key 可用（默认配置即用）、coding 网关 files 不可用；官方日后调整无需改代码，切换 `filesBaseURL` 即可。
- **PDF 路径实测（2026-09）**：`/api/coding/v3/files` 为 404，标准 Files PDF `file_id` 被 coding Responses 以 400 拒绝；base64 `input_file` 可用。隔离 Harness 已完成真实 Composer → Gateway → sidecar → adapter → Ark 回复，并验证重启恢复。
- **web「设置 → 模型」页本渠道编辑卡无可填项**：宿主硬编码 layoutOf 仅认 llm-deepseek/llm-pi-ai 家族，第三方命名空间一律如此；由本插件 client half 的 `settings.plugin.item` 卡片补足。
- **`link:` 开发安装下**，插件解析到工作区自己的 @deepseek-ai/* 副本；宿主对 LlmError 仅两处 instanceof，最坏影响是 turn 级错误 code 显示 UNKNOWN，功能性路由走 `.code` duck-typing 不受影响（"route on code, never on the prototype chain"）。
- **密钥安全**：原因串仅含分类事实（kind/HTTP status/code），凭据经 assertUsableApiKey 且不进消息/日志/导出。
