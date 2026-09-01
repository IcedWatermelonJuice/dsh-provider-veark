# dsh-provider-veark · 火山方舟 Coding Plan Provider for DeepSeek Harness

<p align="center">
  中文 | <a href="README_EN.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/IcedWatermelonJuice/dsh-provider-veark/releases"><img src="https://img.shields.io/github/v/release/IcedWatermelonJuice/dsh-provider-veark?style=flat-square" alt="Version"></a>
  &nbsp;
  <a href="https://www.npmjs.com/package/@deepseek-ai/dsh"><img src="https://img.shields.io/badge/DSH-0.1.2--alpha.1-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH"></a>
  &nbsp;
  <a href="https://www.npmjs.com/package/@volcengine/ark-runtime"><img src="https://img.shields.io/badge/SDK-%40volcengine%2Fark--runtime-red?style=flat-square&amp;labelColor=454a54" alt="Volcengine Ark Runtime SDK"></a>
  &nbsp;
  <img src="https://img.shields.io/badge/node-%E2%89%A522-339933?style=flat-square" alt="Node">
  &nbsp;
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>把火山方舟 Coding Plan 装进 DeepSeek Harness：文本、图片与 PDF 文档理解，密钥粘贴即用</strong><br>
</p>

<div align="center">

[为什么做这个插件](#为什么做这个插件) · [安装](#安装) · [配置](#配置) · [卸载](#卸载) · [Endpoint 与计费](#endpoint-与计费) · [已知边界](#已知边界) · [开发](#开发)

</div>

---
## 为什么做这个插件

事情要从火山方舟 Coding Plan 打骨折说起：**基础 Lite 原价 ¥40 现在只要 ¥9.9，高阶 Pro 原价 ¥200 现在只要 ¥49.9**——这个价格不薅简直对不起钱包。可惜 DSH 自带的 pi-ai 路由虽然也能接火山方舟，却用不了 Files API：贴图只能一轮一轮地把整张图片 base64 塞进上下文，多轮对话又慢又费。

于是就有了这个插件：走火山官方 Responses API + Coding 网关；图片优先上传到方舟 Files API（上传一次，多轮只传 `file_id`），失败自动降级 base64；PDF 则通过插件私有 sidecar 安全接入 Coding Responses 原生 `input_file`，不改 Harness 核心，也不使用 TOS。

**9.9！真的TM太香了！**

> 折扣信息为 2026-08 活动价，以火山方舟官网为准。

## 安装

以下命令以 `web` profile 为例（profile 名不同请替换，如 `headless`）。三种方式任选其一，安装后**重启 DSH** 生效。

> **首次安装报错 `ERR_PNPM_IGNORED_BUILDS`？** pnpm 11+ 默认禁止依赖执行构建脚本（涉及 `protobufjs`），先手动放行一次构建，再重新执行安装命令即可：
>
> ```bash
> dsh plugin --profile web approve-builds protobufjs
> ```
>
> 放行后重新跑一遍下方安装命令，只需处理这一次。

### 方式一：npm 源（推荐）

```bash
dsh plugin --profile web add @icedcola/dsh-provider-veark
```

### 方式二：GitHub 源

```bash
dsh plugin --profile web add github:IcedWatermelonJuice/dsh-provider-veark
```

### 方式三：本地 link（开发调试）

```bash
dsh plugin --profile web add /path_to_dsh-provider-veark
```

> 本地安装是 **link 方式**：直接引用源码目录，改动即时生效；但安装期间**不要删除或移动**该目录，否则 bundle 解析失效。

## 配置

1. 打开 DSH 网页 → **设置 → 插件 →「火山方舟 Coding Plan」**，展开卡片。
2. 粘贴**密钥**（火山方舟 API Key）→ **保存**。密钥写入 DSH 凭据服务，不回显、不落 settings.yaml。
3. 完成。模型选择中出现「火山方舟 Coding Plan」（默认 `ark-code-latest`），文本、图片和 PDF 文档理解即可使用。

PDF 使用方法：先选择声明了 `pdf` 输入能力的模型（默认 `ark-code-latest`）。工作区内文档可直接在问题中输入 `@docs/文件.pdf`，带空格路径使用 `@"docs/my paper.pdf"`；工作区外文档点击 Composer 左侧的 **PDF** 按钮，插件会立即暂存不可变快照并向草稿追加 `@.dsh-pdf/<uuid>/<文件名>`。`/pdf` 仅保留为迁移提示。按钮仅在本插件的 `volcengine` provider 且当前模型声明 `pdf` 时显示；自定义模型默认只有 `text`，请仅在实际 endpoint 支持文档理解时手动勾选 `pdf`。

卡片内可折叠调整：图片是否走云端文件服务、接口地址、图片清晰度与大小上限、PDF 本地保留天数、超时与重试、模型列表等；全部字段留空即恢复默认。

<details>
<summary>settings.yaml 高级字段（可选）</summary>

也可直接编辑 `%DSH_HOME%\settings.yaml` 的 `dsh-provider-veark:` 段（保存即热生效，可整段省略 = 全默认）：

```yaml
dsh-provider-veark:
  preferFiles: true
  chatBaseURL: https://ark.cn-beijing.volces.com/api/coding/v3   # coding 网关，勿改
  filesBaseURL: https://ark.cn-beijing.volces.com/api/v3         # 标准域被 403 时切到 …/api/coding/v3
  apiKeyEnv: ARK_API_KEY
  # models:
  #   - id: ark-code-latest
  #     name: Ark Code Latest
  #     contextWindow: 1000000
  #     maxTokens: 128000
  #     inputModalities: ["text", "image", "pdf"]
  #     imagePixelBudget: 640000
  #     imageMaxBytes: 1048576
  # requestImagePixelBudget: 640000
  # requestImageMaxBytes: 1048576
  # fileExpirySeconds: 604800
  # filesApiTimeoutMs: 15000
  # filesProbeIntervalMs: 21600000
  # pdfRetentionDays: 0       # 0 = 不自动删除；1–3650 = 后续上传时清理超期 sidecar
```

密钥也可不填卡片，改为启动前设置环境变量 `ARK_API_KEY`（或自定义 `apiKeyEnv` 指定的引用名）。

</details>

## 卸载

```bash
dsh plugin --profile web remove @icedcola/dsh-provider-veark
```

然后重启 DSH。插件不修改任何宿主源码；卸载后可再手动删除 `%DSH_HOME%\dsh-provider-veark\`（图片状态）和 `%DSH_HOME%\provider-veark\`（PDF sidecar）。删除 PDF sidecar 后，旧会话中的 PDF token 将无法再次展开。

## Endpoint 与计费

| 请求 | URL | 计费 |
|---|---|---|
| 模型对话 | `…/api/coding/v3/responses` | Coding Plan 套餐 |
| 图片上传/删除 | `…/api/v3/files`（默认） | 存储 API，不计模型 token |
| PDF 文档理解 | PDF base64 `input_file` 随模型对话发送 | Coding Plan 套餐；不调用 Files/TOS |

> 实测（2026-08，coding key）：coding 网关 `/api/coding/v3/files` 不可用；标准域 `/api/v3/files` 可用。感觉官方日后是想将coding的files api也顺带迁移过去。

## 已知边界

- 单个 PDF 和每次请求内累计 PDF 原始大小上限均为 45 MiB，为方舟 50 MB 文件限制与 64 MB 整体请求限制预留编码开销。
- PDF 按钮产生的 sidecar 默认保存在 `%DSH_HOME%\provider-veark\pdfs\`：已经使用的快照默认永久保留，未被消息使用的暂存项和不完整孤儿会在 24 小时宽限后清理；可设置 `pdfRetentionDays` 清理已使用快照，但清理后旧会话无法再读取对应 PDF。
- 普通 `@路径.pdf` 只会读取当前会话工作区围栏内的相对路径；绝对路径和越界路径保持普通文本，不会由 adapter 自动读取或外发。工作区文件按每次请求的当前内容读取，按钮 sidecar 则是选择时的不可变快照。
- 仅导出/迁移会话 JSONL 不会携带 PDF sidecar；跨机器恢复时需同时迁移该目录。
- 助手历史中的 reasoning 块不回放（Responses 协议限制）。
- 不支持视频、音频或 TOS 直传。

## 开发

架构、测试、发布与回退手册见 [DEV.md](./DEV.md)。

```bash
pnpm install
pnpm test
```

## License

[MIT](LICENSE)
