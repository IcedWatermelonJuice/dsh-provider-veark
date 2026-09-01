# DSH PDF 统一 `@` 引用入口优化施工方案

> 本文是 `PDF_SUPPORT_PLAN.md` 的增量方案，并取代 `DSH_PDF_SUPPORT_PLAN.md` 中存在冲突的部分。
> 已验证的 Ark 接口事实、provider 私有 sidecar、历史 `[[dsh-provider-veark:pdf:<uuid>]]`
> 兼容链路继续保留。本轮不修改 DeepSeek Harness 核心。

## 1. 目标与核心语义

用户看到的 PDF 引用统一为 `@路径`，但按来源区分两种不会串档的语义：

1. `@relative/path.pdf` 或 `@"relative path.pdf"`：引用**当前会话工作区内的当前文件**；
2. PDF 按钮生成 `@.dsh-pdf/<uuid>/<文件名.pdf>`：引用 provider sidecar 中由
   `(sessionId, uuid)` 唯一确定的**不可变快照**。

不按 `(sessionId, 文件名)` 猜测 sidecar。这样可避免同名文件覆盖历史引用、工作区同名文件
劫持按钮选择结果，以及多次上传同名 PDF 后旧消息静默改指新版。

“当前文件”与“不可变快照”是有意区分的语义：工作区文件在两次模型请求之间被外部修改时，
两次读取内容可以不同；按钮 sidecar 永远保持选择时的字节。这是预期行为，不是缓存错误。

## 2. 语法

- 非引号形式：`@` 后允许工作区路径常用字符，遇空白、引号、反引号、尖括号及常见中英文
  句末标点结束，且引用必须以 `.pdf` 结尾；
- 引号形式：`@"path with spaces.pdf"`，支持 `\\` 和 `\"` 转义；
- 虚拟 sidecar：`@.dsh-pdf/<UUIDv4>/<百分号编码文件名>`；
- 需要 token 左边界，避免把 `alice@report.pdf` 当作引用；
- 含 NUL 或 C0/C1 控制字符的候选不展开。

扫描只作用于 user 消息的普通 text block；tool-result、system、assistant 不扫描普通 `@`。
历史私有 marker 保持原有严格解析行为。

扫描器先识别 `.dsh-pdf/` 保留前缀，再判 UUID 虚拟形态；普通工作区解析显式排除整个
`.dsh-pdf/` 前缀。畸形 UUID 或文件名原样放行，绝不退化为工作区文件查找。

## 3. 判定与失败语义

### 3.1 历史 marker

- 模型没有 `pdf` 能力：`UNSUPPORTED_CONTENT`；
- session、sidecar 或完整性校验失败：明确报错；
- 保证旧会话可继续重放，不改变既有安全语义。

### 3.2 普通工作区 `@PDF`

- 模型没有 `pdf` 能力：原文放行；
- 无 session cwd、路径不存在、越过工作区围栏或校验失败：原文放行；
- 成功时读取当前文件，并展开成 Ark `input_file`。

### 3.3 虚拟 sidecar `@PDF`

- 模型没有 `pdf` 能力：原文放行，以便切换 provider/model；
- 支持 PDF 的 volcengine 模型下，缺失、错 session 或损坏必须明确报错，因为这是用户通过
  按钮显式附加的不可变文档，而不是可选的路径提示。

## 4. 路径安全

- 手打工作区引用只接受相对路径；绝对路径原样放行；
- `resolve(cwd, path)` 和 `realpath()` 后必须仍位于 `realpath(cwd)` 内；
- 不以进程 cwd 代替会话 cwd；无法取得 per-session cwd 时禁用工作区展开；
- 工作区外文件必须经过浏览器文件选择器并进入 UUID sidecar；
- 最终读取的字节统一校验 `.pdf`、1–45 MiB、前 1024 字节 `%PDF-` magic。

会话 cwd 暂从 `$DSH_HOME/storages/session_projcache.json` 的 `identity.cwd` 只读解析；该内部
存储不可用或格式变化时安全降级为不展开工作区 `@`，不使用进程 cwd。

## 5. Sidecar 生命周期

- stage 创建 UUID 配对，元数据增加 `usedAt: null`；
- 首次由 adapter 成功解析时在跨进程文件锁内幂等写入 `usedAt`，已有值不得覆盖；
- `usedAt` 是 best-effort GC 标记：原子写入或锁失败只记录警告，不得让已经校验成功的 PDF 解析失败；
- 未使用的完整配对超过 24 小时按暂存垃圾回收；
- 已使用配对继续遵循 `pdfRetentionDays`，默认 0 永久保留以支持历史会话；
- `.pdf`/`.json` 不完整配对继续按 24 小时孤儿宽限清理。

## 6. 请求预算

- 所有 marker、工作区引用和虚拟引用计入同一 PDF 原始字节预算；
- 同一请求内按不可变 token 或规范化真实路径缓存解析，避免重复磁盘读取；
- 构造完整请求体后再检查 UTF-8 JSON 字节数，默认不超过 63 MiB，为 HTTP/SDK 留余量；
- 超限明确返回 `INVALID_REQUEST`，不静默丢弃用户已明确附加的 PDF。

## 7. 客户端

- PDF 按钮保留 provider + 模型能力门控；
- 选择后立即 stage，并向当前草稿追加 UUID 虚拟引用；文件名使用 `encodeURIComponent`，
  因而天然支持空格、中文和标点；
- 不再维护 `pending` Map，不再由 `/pdf` claim 代替用户提交；
- `/pdf` 保留为迁移提示：请直接输入 `@文件.pdf` 或点击 PDF 按钮；
- 选择失败或 stage 失败不修改草稿。

## 8. 实施与验收

1. 扩展 `VeArkPdfStore`：不可变虚拟引用解析、`usedAt`、暂存清理和共享字节校验；
2. 扩展 adapter：严格扫描器、两类门控、tool-result 排除、工作区围栏和总请求预算；
3. 在 `apply()` 注入 session cwd 解析器和 sidecar resolver；
4. 改造客户端按钮与 `/pdf` 提示；
5. 更新中英文 README、DEV 和原方案完成状态；
6. 单元、客户端、语法、`git diff --check`、npm 测试全部通过；
7. 隔离 profile 验证工作区内、工作区外、同名文件、带空格文件、模型切换和重启恢复。

### 8.1 指定真机测试 profile

本轮使用用户已创建的纯净 DeepSeek Harness Web profile；其中仅包含基础 Harness Web 环境和
以 `link:` 指向当前插件项目的开发版本。不得替换或修改用户日常 profile。

```powershell
$env:DSH_HOME = "$env:USERPROFILE\.dsh-test"
npx @deepseek-ai/dsh --profile dsh-test --port 13080
```

验收地址为 `http://localhost:13080`。真机测试后检查：

- Host 与 client bundle 均从当前工作区 link 加载；
- `volcengine / ark-code-latest` 显示 PDF 按钮，其他 provider 或无 PDF 能力模型隐藏；
- 按钮选择文件后草稿出现 UUID 虚拟 `@.dsh-pdf/` 引用；
- 工作区相对 `@PDF`、工作区外 sidecar、带空格文件均能被模型理解；
- 会话日志无 base64，新消息不再新增旧 `[[dsh-provider-veark:pdf:...]]` marker；
- 重启同一 profile 后 UUID sidecar 仍可恢复，且不会访问日常 profile 数据。
- 输入 `/pdf` 时出现迁移提示，不再上传或替用户提交消息；
- 会话日志中的新消息只含 `@…` 文本，不含 base64，也不新增旧 `[[dsh-provider-veark:pdf:...]]` marker。

### 8.2 工作区 `@PDF` 的真机取证规则

工作区路径测试不能仅凭模型返回已在同一会话历史中出现过的文本判定成功。每个普通路径和
带空格引号路径用例都必须：

- 在发送前从 `session_projcache.json` 确认目标 session 的 `identity.cwd`，并在该目录内以
  `Test-Path`、`Resolve-Path` 和 SHA-256 证明测试 PDF 确实存在；
- 使用一个从未出现在该会话历史、其他测试 PDF 或提示词中的唯一文档标记；普通路径与
  带空格路径使用不同标记，优先分别在全新会话验证，避免模型从上下文复述；
- 消息只询问“读取文档并返回其中的标记”，不能把预期标记写进提示词；
- 验收时同时核对模型回复、该 turn 的 token 用量和会话 JSONL。回复正确但文件不存在、
  路径不属于会话 cwd，或标记已存在于历史时，一律只算原文放行/上下文复述测试；
- 记录 session id、cwd、相对引用、文件 SHA-256 和对应 turn，保证第三方可以复查。

## 9. 明确不做

- 不拦截 PDF 之外的 `@` 文件；
- 不允许普通 `@` 绕过工作区围栏读取绝对路径；
- 不用文件名解析 sidecar；
- 不修改 Harness 的附件 schema、文件引用插件或会话协议；
- 不调用 TOS 或不存在的 `/api/coding/v3/files`。

## 10. 施工结果（2026-09-01）

- Step 1–4 已完成，Harness 核心零修改；
- 自动化测试 52/52 通过，`git diff --check` 干净；
- `.dsh-test` 真机中，按钮 UUID sidecar 已得到真实 Ark 回复 `ARK_PDF_SMOKE`；此前普通
  工作区相对 `@PDF` 和带空格引号 `@PDF` 的两轮因 session cwd 为 `D:\Downloads` 且文件
  不存在，只验证了“解析失败后原文放行”，不能作为路径展开证据；
- 工作区路径已按 §8.2 重新验收：两个独立新会话的 cwd 都是 `D:\Downloads`。
  `session-8c4bcdac-afd5-47a8-a6c1-e98a4b477f7b` 读取
  `@workspace-at-real.pdf`（SHA-256
  `761C432EEF7801A329C9A74CB78FD3F58D408F6F028AD7B13C8DB2979EEB77FD`），只返回
  `AT_REAL_91C7X`；`session-e96cd10a-9307-4ebf-9f0d-6d760c29236b` 读取
  `@"workspace quoted real.pdf"`（SHA-256
  `E1986217BEA756554D16DDA1B6F1A31B5325EFAD6BBCB20A2D3D18F202156257`），只返回
  `QUOTED_4F2AXY`。两轮均为 turn 1、cache read 0、input 15669 tokens，预期标记未写入
  提示词或任何会话历史；
- `/pdf` 已显示迁移提示；切换 DeepSeek provider 后 PDF 按钮隐藏，切回 Ark 后恢复；
- 解压检查 session JSONL：新 user message 只有 `@…` 文本，无 base64、无新增旧 marker；
- sidecar 首次请求后 `usedAt` 写入，Harness 重启后同一 UUID 再次成功解析；
- 两份 437-byte 工作区测试文件暂保留在 `D:\Downloads`，同源 fixture 保留在
  `test/fixtures/`；测试 profile 的 sidecar 和压缩会话日志也保留用于复核。解压两条新会话
  JSONL 后，user message 只含上述 `@...` 文本，无 base64、无新旧私有 marker。
- Composer PDF 控件已移动到“+”右侧、“Workspace Write”左侧；按钮复用宿主选择器背景、
  28px 尺寸、圆形圆角、hover 色，并提供与宿主一致的无障碍 tooltip；按钮内容使用继承
  当前主题颜色的 Iconfont PDF SVG，不显示“PDF”文字，忙碌态切换为 SVG spinner。
