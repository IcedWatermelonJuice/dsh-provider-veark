# DeepSeek Harness 火山方舟 Provider PDF 支持方案

## 1. 目标与边界

目标是在 `@icedcola/dsh-provider-veark` 插件生成的 `volcengine` provider 内支持 PDF，不修改 DeepSeek Harness 核心，也不改变其他 provider 的附件能力。

明确边界：

- 模型请求仍只发送到 `https://ark.cn-beijing.volces.com/api/coding/v3/responses`。
- 方舟 Files API 地址仍是 `https://ark.cn-beijing.volces.com/api/v3/files`，但当前不用于 Coding Responses 的 PDF 引用。
- 不使用火山引擎 TOS 等付费对象存储。
- 不实现视频、音频等其他模态。
- 不向 Harness 的通用 `PromptContentPart`、图片附件服务或会话协议加入 PDF 类型。
- PDF 功能只在当前会话选择 `volcengine` provider 时显示和生效。

## 2. 已验证的接口事实

已经用 PowerShell/HTTP 请求验证：

1. 标准 `/api/v3/files` 可以上传 PDF，返回的文件状态为 active。
2. 把标准 Files API 返回的 PDF `file_id` 交给 `/api/coding/v3/responses`，当前返回 HTTP 400 `InvalidParameter`。
3. `/api/coding/v3/files` 的 GET 和 multipart POST 均返回 HTTP 404；Coding 路径下目前没有独立 Files API。
4. `/api/coding/v3/responses` 接受以下 PDF 内容块，并能正确理解文档：

```json
{
  "type": "input_file",
  "filename": "document.pdf",
  "file_data": "data:application/pdf;base64,..."
}
```

5. 方舟文档限制：base64 PDF 小于 50 MB，整个请求小于 64 MB。实现采用 45 MiB 安全上限，为 JSON 和 base64 请求开销留出余量。

结论：当前 Coding Plan 的可靠 PDF 路径应是 base64 `input_file`，不能依赖 `/api/v3/files` 返回的 `file_id`。

## 3. 设计方案

### 3.1 为什么不能直接扩展 Harness 附件

当前 DeepSeek Harness 浏览器到 Host 的公开 `session.prompt()` 只接受文本和图片；通用附件服务、Composer 状态和 `PromptContentPart` 也都是图片专用。直接提交自定义 PDF 内容块会在 Host 的严格校验处被拒绝。

因此采用“插件私有 sidecar + 普通文本 token + provider adapter 解析”的方式：

```text
浏览器 PDF 按钮
  → 插件私有 Remote 上传
  → $DSH_HOME/provider-veark/pdfs 保存 PDF 和元数据
  → Harness 会话只记录文件名与随机 token
  → 仅 volcengine adapter 解析 token
  → 读取并校验本地 PDF
  → 生成 Ark input_file/base64
  → POST /api/coding/v3/responses
```

这种方式不改 Harness 的消息 schema。切换到其他 provider 时，其他 adapter 不会读取插件 sidecar，也不会收到 PDF 原始数据；它最多看到一行普通的 PDF 附件说明和无意义的 provider 私有 token。

### 3.2 本地存储和安全约束

PDF 存放在：

```text
$DSH_HOME/provider-veark/pdfs/<uuid>.pdf
$DSH_HOME/provider-veark/pdfs/<uuid>.json
```

元数据包含 session id、原文件名、字节数、SHA-256 和创建时间。读取时必须同时满足：

- token 是 UUID v4；
- token 归属于当前 session；
- 文件名以 `.pdf` 结尾；
- MIME 固定为 `application/pdf`；
- 前 1024 字节中存在 `%PDF-`；
- 文件大小不超过 45 MiB；
- 实际大小和 SHA-256 与元数据一致。

浏览器不会向会话日志写入 PDF base64，只写入如下标记：

```text
PDF attachment (document.pdf): [[dsh-provider-veark:pdf:<uuid>]]
用户的问题
```

### 3.3 客户端交互

计划中的交互是：

1. 仅当当前模型 provider 为 `volcengine` 时，在 Composer 左侧显示 `PDF` 按钮。
2. 用户选择 PDF 后，客户端仅在内存中暂存 base64，并把草稿切换为 `/pdf ` 命令。
3. 用户输入问题并提交。
4. 插件私有 `/pdf` 输入源把 PDF 上传到 Host sidecar，再通过标准文本 prompt 写入 token。
5. adapter 在生成模型请求时把 token 替换成 `input_file`；token 本身不会发送给方舟。

## 4. 当前已经完成

当前工作分支：`codex/pdf-support`。没有切换或修改 `main` 分支。

已经完成的代码：

- 新增 `lib/pdf-store.js`：
  - provider 私有 PDF sidecar；
  - session 绑定；
  - 大小、PDF magic、base64、SHA-256 校验；
  - 插件私有 `vearkPdf.stage` Remote 服务。
- 新增 `lib/typert.host.js` 和 `lib/typert.remote-client.js`：
  - Host/Client 严格远程调用契约；
  - Host Typert manifest 已通过 Harness `validateTypertManifest()` 校验。
- 修改 `lib/adapter.js`：
  - 识别 provider 私有 PDF token；
  - 读取 session 绑定的 sidecar；
  - 输出 `input_file + filename + file_data`；
  - token 不会进入方舟请求；
  - 累计 PDF 输入超过 45 MiB 时明确拒绝。
  - 默认 `ark-code-latest` 显式声明 `inputModalities: ["text", "image", "pdf"]`；
  - adapter 在读取 sidecar 或访问 Ark 前按当前模型声明检查 `pdf` 能力，未声明时返回 `UNSUPPORTED_CONTENT`。
- 修改 `lib/index.js`：
  - PDF store/service 和 `volcengine` adapter 绑定；
  - 未修改 Harness 本身。
- 修改 `lib/client.js`：
  - 初步加入 provider 条件化 PDF 按钮；
  - 初步加入 `/pdf` 输入源、文件选择和私有 Remote 上传流程；
  - 真实 Composer 提交发现 Harness 要求精确声明远程命名空间，已把 `remote.vearkPdf` 加入客户端 inject，并增加回归断言。
  - 顶层精确 inject 会与 Remote 自举形成等待环，已改为“先通过顶层 `remote` 挂载 contribution，再用 `ctx.inject(["remote.vearkPdf"], ...)` 注册 PDF 输入功能”的两阶段生命周期；隔离 Harness 已验证能够正常启动。
  - 模型设置 UI 已增加 `pdf` 能力复选框；自定义模型默认不继承 PDF 能力；
  - PDF 按钮、命令候选、Enter claim 和提交均同时检查 provider 与当前模型的 `pdf` 声明。
- 修改 `package.json` 和 `pnpm-lock.yaml`：
  - 声明 Typert host/remote exports；
  - 增加 zod v4 和 Typert protocol 依赖。
- 新增单元测试：
  - PDF marker 转换为 Ark base64 `input_file`；
  - token 不进入 Ark 请求；
  - sidecar session 隔离；
  - PDF magic、大小和完整性校验。
  - PDF sidecar 可选保留期和孤立文件清理。
  - 同一 provider 内未声明 `pdf` 的模型会在解析 sidecar 和请求 Ark 前被拒绝。
- 新增客户端 PDF 流程测试：
  - 私有 Typert Remote contribution 挂载；
  - 浏览器选取 PDF 并生成 `/pdf` 草稿；
  - `/pdf` claim 上传 sidecar token，再调用标准 `session.prompt()`；
  - provider 切换为非 `volcengine`，或切换到同 provider 下未声明 `pdf` 的模型后，不再返回 PDF 候选或 claim。
- 当前测试结果：43 个测试全部通过；新增模型能力声明、客户端门控和 adapter 兜底覆盖。
- 完成临时 DeepSeek Harness profile 装载检查：
  - 使用隔离的 `$DSH_HOME` 和 `pdf-test` profile，本地 link 安装当前分支；
  - `--dump-config` 确认插件只作为独立 `dsh-provider-veark` Host 层插入；
  - Harness Web 服务成功启动，Host 侧 Typert manifest 和插件服务加载时没有报错；
  - 浏览器实际取得的插件 client bundle 包含 PDF Remote、PDF 控件和 Composer 插槽；
  - 真实页面发现 list slot 必须使用 `options.id`，已将错误的 `key` 修正为 `id`；
  - 修正后插件完整应用，设置 → 插件页能够正常显示“火山方舟 Coding Plan”配置卡；
  - 已在隔离 profile 中创建真实工作区和会话，成功选择 `volcengine / ark-code-latest`，Composer 仅在该 provider 下显示 PDF 按钮；
  - 已通过真实文件选择器载入烟雾测试 PDF，客户端正确显示 `PDF ✓` 并生成 `/pdf` 草稿；
  - 第一次真实提交在调用 Gateway 前暴露 `remote.vearkPdf` 精确注入缺失；两阶段注入修复后，真实 Gateway RPC 已成功完成；
  - 真实 `vearkPdf.stage` 已把 437 字节测试 PDF 写入隔离 `$DSH_HOME/provider-veark/pdfs`，元数据中的 session id、字节数和 SHA-256 均正确；
  - 真实输入机确认一次 Enter 即完成 claim、暂存与标准 token prompt，会话日志不含 PDF base64；
  - adapter 随后按预期进入 provider 请求阶段，但隔离 profile 没有 `ARK_API_KEY`，以 `MISSING_CREDENTIAL` 结束；这不是 PDF/Gateway 错误。
  - 隔离 profile 随后以只读路径复用本机 Harness 凭据存储，并在具备网络权限的独立进程中完成真实 Ark 请求；
  - `ark-code-latest` 最终只返回 `ARK_PDF_SMOKE`，证明浏览器 → Gateway → sidecar → adapter → `/api/coding/v3/responses` → PDF 理解响应端到端成功；
  - 最终成功发生在 Harness 重启后的同一会话中，也验证了历史 token 和 sidecar 可以跨进程重启恢复。

## 5. 已知未完成项与非阻塞后续工作

本轮 PDF 核心链路和合并验收标准已经完成，可进入分支审查。以下项目未纳入本轮核心交付；发布 npm 或替换日常 profile 仍由维护者决定。

1. **DeepSeek Harness 真机集成测试**
   - 已在隔离的临时 Harness profile 中完成本地 link 安装、配置合成、Host 启动和客户端插件应用检查；
   - 尚未在用户日常使用的 `web` profile 中替换已发布版本，避免影响现有环境；
   - Typert loader、客户端 Remote contribution、真实文件选择、Gateway RPC、sidecar 持久化、token prompt 和最终 Ark 回复均已验证；
   - 已完成隔离 profile 的完整端到端对话；尚未替换用户日常 `web` profile 中的已发布版本，避免影响现有环境。

2. **客户端真实 DOM 交互和输入机集成测试**
   - 已完成文件选择、私有 Remote、`/pdf` claim、token prompt 和 provider 条件化候选的自动化组件边界测试；
   - 已确认客户端插件能在真实 Harness 页面完整应用，且插件设置卡正常渲染；
   - 已创建临时工作区/会话，并确认 `volcengine` 下 PDF 按钮、选中态和 `/pdf` 草稿正常；
   - 已把同一会话真实切换到 `deepseek-official / deepseek-v4-flash`，PDF Composer 控件立即消失；切回 `volcengine` 成功；
   - 已确认真实输入机中一次 Enter 会进入 claim 并直接执行提交，不需要第二次 Enter；
   - 已明确固定使用 `queue`：PDF 问题按普通用户消息排队，不在运行中的 agent turn 内注入大文件；这是隔离性优先的设计选择。

3. **真实方舟端到端测试**
   - adapter 的 wire 形状已由 mock 测试覆盖；
   - 小型文本 PDF 已通过插件产生的真实请求取得 `ark-code-latest` 正确回复；
   - 尚未验证多页 PDF、中文 PDF 和扫描版 PDF。

4. **生命周期与清理策略**
   - 已增加 `pdfRetentionDays`（0–3650）设置；默认 0 不自动删除，避免破坏历史会话和重启恢复；
   - 设置为正数后，后续 PDF 上传会以 6 小时节流清理超期的完整 sidecar 配对；
   - 已自动清理超过 24 小时宽限期的孤立 `.pdf`/`.json` token 文件，并为两种清理行为增加单元测试；
   - 尚未实现会话删除联动或独立的用户手动清理入口；
   - 会话导出、复制到另一台机器或只迁移 JSONL 时，PDF sidecar 不会自动随行；README/DEV 已明确要求一并迁移目录，自动导出支持留作后续。

5. **长会话和上下文策略**
   - 历史中每个 PDF token 在后续请求中都会重新展开为 base64；
   - 多个 PDF 或很长的会话可能触及 64 MiB 请求上限；
   - 当前只做 45 MiB 累计硬限制，尚未设计“仅保留最近 PDF”“摘要后移除 PDF”或 compaction 集成。

6. **错误展示与国际化**
   - PDF 按钮、候选项、claim 提示、选择校验、provider 限定、暂存失败和默认问题均已纳入插件中英文 locale 字典；
   - Gateway 返回的具体失败信息会优先展示，通用失败再使用本地化兜底文案；
   - Host 侧 sidecar 丢失、session 不匹配和完整性失败仍以明确的 provider 错误进入本轮失败状态，未额外增加弹窗。

7. **代码审查和发布准备**
   - 已完成完整 diff review、JS 语法检查、Typert manifest 校验、`git diff --check` 和 npm 0.2.0 dry-run 打包清单检查；
   - README、README_EN 和 DEV 已补充 PDF 使用、端点事实、sidecar 迁移/清理和开发架构说明；
   - `package.json` 已按新增模态能力从 0.1.11 更新为 0.2.0；
   - 本轮变更在 `codex/pdf-support` 独立提交；没有合并到 main，也没有发布 npm 包。

8. **模型级 PDF 能力门控（后续审查补强）**
   - 已把 `pdf` 加入插件模型目录允许的 `inputModalities`，默认 `ark-code-latest` 声明 `text/image/pdf`；
   - 新增的自定义模型仍默认只有 `text`，不会因属于 `volcengine` provider 自动获得 PDF 权限；
   - 模型配置卡已提供 `pdf` 复选框，供 endpoint 能力经过确认后显式开启；
   - Composer 按钮和 `/pdf` 候选均按当前模型声明启用；切到同 provider 的 `text/image` 模型会立即隐藏；
   - 已选择 PDF 后再切到不支持模型时，`/pdf` 仍由插件认领并返回明确错误，不会退化成普通文本误发；
   - adapter 会在读取 sidecar、解析 base64 或请求 Ark 前再次核验模型声明，防止旧会话重放或绕过客户端；
   - 已增加对应单元与客户端回归测试，完整测试现为 43/43。

## 6. 建议的后续执行顺序

1. ~~先审查当前 diff，重点检查客户端 Remote mount 和 Typert service 生命周期。~~ 已完成。
2. ~~在临时 DSH profile 中安装该分支，不覆盖用户现有插件版本。~~ 已完成。
3. ~~验证 provider 为 `volcengine` 时显示 PDF 按钮，切换其他 provider 时立即隐藏。~~ 已完成。
4. ~~完成一个小型 PDF 的浏览器 → Host sidecar → adapter → 方舟响应端到端测试。~~ 已完成。
5. ~~验证 Harness 重启后同一会话仍能解析历史 PDF token。~~ 已完成。
6. ~~验证切换其他 provider 后不会读取或发送 PDF sidecar。~~ 已通过真实 provider 切换和 adapter 作用域测试。
7. ~~增加 sidecar 清理策略、浏览器测试和端到端测试。~~ 已完成核心覆盖。
8. ~~补充中英文文档，更新版本号。~~ 已完成，版本为 0.2.0。
9. 所有测试通过并人工检查请求 endpoint 后，提交到 `codex/pdf-support`；最后由维护者决定是否合并 main。

## 7. 合并验收标准

只有同时满足以下条件才建议合并：

- Harness 核心代码零修改；
- PDF 控件仅对 `volcengine` provider 可见；
- PDF 控件仅在当前模型目录显式声明 `pdf` 能力时可见；
- adapter 对旧消息重放和绕过客户端的 PDF marker 执行同样的模型能力兜底检查；
- PDF 原始数据不会交给其他 provider；
- 模型请求只访问 `/api/coding/v3/responses`；
- 不调用 TOS；
- 不尝试不存在的 `/api/coding/v3/files`；
- Ark 请求中的 PDF 使用已验证的 base64 `input_file`；
- PDF token 具备 session 隔离和完整性校验；
- 重启恢复、sidecar 丢失、超限和 provider 切换均有可理解的错误行为；
- 单元测试、客户端测试和真实端到端测试全部通过。
