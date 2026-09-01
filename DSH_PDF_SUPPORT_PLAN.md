# DSH PDF 统一 `@` 引用入口施工方案

> 本文是 `PDF_SUPPORT_PLAN.md`（下称"原方案"）的增量施工方案，供 codex 执行。
> 原方案的接口事实（§2）、sidecar 存储与安全约束（§3.2）、已知未完成项（§5）继续有效；
> 本文只覆盖交互层与 adapter 拦截层的重新设计。冲突处以本文为准。

## 0. 背景与一句话目标

原方案发布后的真机测试发现：内置 `@` 文件引用只是把「`@相对路径`」作为**普通文本**放进消息
（`dsh-file-reference` 的设计契约："selected files remain ordinary prompt text"），
模型收到 PDF 引用时只能自行用工具（glob / pdftotext）翻盘读取，体验割裂。

同时实证（隔离 profile 会话日志，`session-e4f647db…` turn 2）：

- `@API-Balance-Monitor-Extension-1.1.0/icons/icon16.png` 到达 adapter 时**原样保留**，
  不被 Harness 改写、不进附件管线（连图片也不例外）；
- 模型把它当普通文本读，自己用相对 cwd 的路径调 `Get-Item` 命中
  `D:\Downloads\…`（会话工作区根）。

因此确立统一语义：**`@` = 工作区相对路径根标记**。PDF 附加的三种来源
（按钮、`/pdf` 命令、手打 `@`）全部收敛为一种文本形态 `@路径.pdf`：

> 客户端只负责帮用户填写正确的 `@` 字符串；volcengine adapter 在生成模型请求时
> 统一扫描 → 解析 → 校验 → 展开为 `input_file`；任何条件不满足则原样放行。

## 1. 设计定稿（实现必须严格遵守，不要重新设计）

### 1.1 语法与判定顺序

1. **扫描**：user 文本块中匹配 `@` + 路径 + `.pdf` 结尾（正则；
   支持 `@a/b/c.pdf`、`@文件.pdf`；引号变体 `@"a b.pdf"` 可选，不阻塞验收）。
2. **能力门控**：命中后检查 `provider === "volcengine"` 且当前模型
   `inputModalities` 含 `"pdf"`（扩展现有 `contentHasPdfMarker` 门控管线，
   使其同时识别 `[[token]]` marker 与 `@` 两种形态）。
   不满足 → **整段放行**（原文本进请求，模型自行决定是否用工具）。
3. **路径解析**（按序尝试，任一成功即停）：
   1. 路径已是**绝对路径**（盘符 `X:\`、`X:/` 或 `/` 开头）→ 直接作为绝对路径；
   2. **相对路径** → `join(会话cwd, path)` 转绝对路径，文件存在 → 用；
   3. **sidecar 兜底** → 按 `(sessionId, 文件名)` 查 `VeArkPdfStore` 最新一条，
      走**完整**完整性校验（session 绑定、字节数、SHA-256、45 MiB、`%PDF-` magic）→ 用；
   4. 全部失败 → **放行原文本**（绝不阻断请求）。
4. `realpath` 归一仅用于规范化（符号链接/分隔符），**不做工作区围栏**。
   理由：`@` 文本只能来自用户输入，用户对自己机器上任意文件有完全处置权；
   绝对路径本来就放行，adapter 相对用户没有任何提权。
5. **安全细节（必须做）**：
   - 拒绝含空字节或控制字符的路径；
   - 解析出的文件必须通过与现有 `decodePdf` 同源的校验
     （1–45 MiB、前 1024 字节含 `%PDF-`、`.pdf` 后缀）；
   - `@` 展开的字节计入现有 45 MiB 单请求累计预算 `pdfBudget`。

### 1.2 扫描范围（与现有 marker 的差异点）

- `@` 扫描**只作用于用户手写文本**：user 角色消息的常规 content 块；
  **必须排除 `tool-result` 块**（工具输出里可能恰好出现 `@xxx.pdf` 字样，
  避免误拦截读盘导致意外的 token 膨胀）。
- 现有 `[[dsh-provider-veark:pdf:<uuid>]]` marker 保持全量扫描不变（UUID 不可猜测）。

### 1.3 客户端交互（新）

- **PDF 按钮**：选文件 → 浏览器端三连校验（.pdf 后缀 / 1–45 MiB / `%PDF-` magic，
  保留现有实现）→ **立即** `vearkPdf.stage` 落 sidecar →
  草稿插入/追加 `@<原文件名>.pdf`。
  - 多次点击 = 多个 `@` 标记；用户删除草稿文本即取消附件
    （sidecar 孤儿由现有 24h 孤儿回收兜底）。
- **`/pdf` 命令**：保留注册但改为**提示别名**——matchEnter 命中后返回一条明确提示
  （"PDF 已支持直接输入 `@文件.pdf`，或点击 PDF 按钮"；中英文 locale），
  不再执行上传/prompt 流程。
- **按钮可见性门控不变**：仍按 `provider + 模型 pdf 声明` 显示/隐藏
  （`modelSupportsPdf`）。
- **删除项**：`pending` Map、`claim()` 的上传+prompt 主体、
  提交前的 provider/model 二次检查（拦截职责全部移交 adapter）。

### 1.4 Host 侧新增

- `VeArkPdfStore` 增加 `resolveByName(sessionId, name)`：
  扫描 root 下 `.json` 元数据，过滤 `sessionId` 匹配 + `name` 精确匹配，
  返回 `createdAt` 最新的一条（含 `.pdf` 字节，校验链与 `resolve()` 一致）。
  注意与现有 `cleanup()` 的孤儿判定共存。
- adapter 注入点：仿照现有 `resolvePdf` 模式，在 `apply(ctx)`（`lib/index.js`）
  注入 `resolveWorkspacePath(sessionId, relativePath) => 绝对路径 | void`。
  - 会话 cwd 来源：从插件 ctx 可得的 workspace/fs 服务解析；
    **拿不到一律返回 void → adapter 放行**。
  - 若 Host 侧无法直接获得 per-session cwd，允许降级为"进程 cwd"
    （测试 profile 场景下与会话 cwd 一致），但须在 DEV.md 记录该限制。

## 2. 施工分解（按依赖顺序）

### Step 1 — `lib/pdf-store.js`

- 新增 `resolveByName(sessionId, name)`（含完整校验链，
  返回形状与 `resolve()` 一致：`{name, mediaType, data}`）。
- 单测：命中最新、session 隔离、同名不同 session、损坏元数据跳过。

### Step 2 — `lib/adapter.js`（核心）

- 新增 `AT_PDF_RE` 正则与 `contentHasAtPdf()`；
- `textAndPdfWireParts` 扩展：marker 分支之外增加 `@` 分支，解析顺序按 §1.1-3；
- `contentHasPdfMarker` → 扩展为同时识别两种形态
  （能力门控与 `UNSUPPORTED_CONTENT` 兜底对 `@` 形态同样生效）；
- tool-result 块排除 `@` 扫描（marker 扫描保持不变）；
- `config` 增加 `resolveWorkspacePath` 可选注入，缺省 undefined = `@` 全放行；
- `@` 展开字节计入现有 `pdfBudget`。
- 单测（全部走 mock `resolveWorkspacePath`/`resolvePdf`）：
  - 绝对路径命中 → `input_file`；
  - 相对路径 + cwd join 命中；
  - 相对路径未命中 → sidecar `resolveByName` 命中；
  - 三级全失败 → 原文本放行（请求成功，无 `input_file`）；
  - `..`/绝对路径混合输入的规范化；
  - 非 pdf 模型 + `@` → `UNSUPPORTED_CONTENT`（与 marker 一致）；
  - tool-result 内 `@xxx.pdf` 不触发；
  - `@` 与 `[[token]]` 同消息混合；
  - 多个 `@` 累计预算超限 → 拒绝。

### Step 3 — `lib/index.js`

- 注入 `resolveWorkspacePath`（§1.4）；`resolveByName` 接线到 adapter config。

### Step 4 — `lib/client.js`

- 按钮 `choose()` 改造（§1.3）：stage 提前、插 `@名.pdf`、清 `pending`；
- `claim()` 降级为提示、`source()` 的 candidates/matchEnter 简化；
- locale 中英新增 `/pdf` 提示文案与按钮相关文案微调（`pdfClaimHint` 语义变化）；
- 客户端测试更新：`/pdf` 现在返回提示而非执行上传；按钮插入的是 `@` 字符串；
  provider/模型门控显隐逻辑保持既有断言。

### Step 5 — 文档同步（见 §3）

### Step 6 — 回归

- `node --test`（现有 43 + 新增）全绿；
- 隔离 profile（`$DSH_HOME=<新目录>`，`--profile dsh-test --port 13080`）真机验证：
  1. 按钮选**工作区内** PDF → 草稿 `@名.pdf` → 提交 → 模型答对内容；
  2. 按钮选**工作区外**（桌面）PDF → 提交 → 经 sidecar 兜底答对；
  3. 手打 `@工作区内相对路径.pdf` → 答对；
  4. 切到未声明 pdf 的模型或非 volcengine →
     `@` 原文进入消息，模型用工具自行处理或说明找不到；
  5. `/pdf` 输入 → 出现新提示文案；
  6. 检查会话日志：无 base64、无 `[[token]]` 新增
     （新消息只应有 `@名.pdf`）。

## 3. 相对原方案（`PDF_SUPPORT_PLAN.md`）的文档更新指引

施工完成后，除新建本文外还需更新原方案：

| 原方案章节 | 操作 |
|---|---|
| §3.3 客户端交互 | **整节改写**为新交互：按钮 = 填 `@` 字符串 + 预上传 sidecar；`/pdf` 为兼容提示；`@` 语法说明与解析顺序 |
| §3.2 存储约束 | 补一段：`resolveByName` 兜底查询及其校验链；sidecar"上传时校验、落盘复用" vs 工作区路径"每请求读盘"的差异 |
| §4 已完成 | 追加"统一 `@` 入口"小节，列出本文 Step 1–4 与测试结果 |
| §5 新增第 9 项 | 「统一 @ 引用入口」：动机（内置 @ 只传文件名导致模型自行翻盘，真机会话实证）、行为矩阵（工作区内/外/绝对路径/放行）、tool-result 排除理由、`/pdf` 弃用提示 |
| §5.2 / §5.5 | 补一句：`@` 工作区路径为每请求重读（无去重缓存），大文件多轮会话的请求膨胀与现有 45 MiB 累计限制的关系 |
| §7 合并验收标准 | **新增三条**：① `@…pdf` 仅在 volcengine + 模型声明 pdf 时被 adapter 展开，否则原样放行且不报错；② `@` 扫描不作用于 tool-result 块；③ `/pdf` 命令仅返回迁移提示，不再执行上传/prompt |
| §7 既有条目 | 全部保留；「PDF 原始数据不会交给其他 provider」条目语义更新为"其他 provider 收到的是 `@文件名.pdf` 纯文本（与内置 @ 行为一致）" |

同时同步 `README.md` / `README_EN.md`（PDF 用法一节改为 `@` 语法优先）与
`DEV.md`（`resolveWorkspacePath` 注入点、cwd 降级限制、`/pdf` 提示别名）。

## 4. 明确不做（本轮边界）

- 不做 `@"带空格路径"` 引号语法（可选后续）；
- 不做 sidecar 去重/同名多副本合并（孤儿回收兜底）；
- 不改 Harness 任何核心包（`dsh-file-reference`、input-trigger、attachment 全部不动）；
- 不做图片/其他扩展名的 `@` 拦截——只认 `.pdf`。

## 5. 验收底线

- 全部新旧测试通过；
- 隔离 profile 六项真机验证（§2 Step 6）通过；
- 三份文档（本文件 + 原方案按 §3 更新 + README/README_EN/DEV）同步完成；
- `git diff --check` 干净；
- 提交继续落在 `codex/pdf-support` 分支（新提交，不 squash 上一条）。
