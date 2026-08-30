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
  <strong>把火山方舟 Coding Plan 装进 DeepSeek Harness：文本 + 图片对话，图片走 Files API，密钥粘贴即用</strong><br>
</p>

<div align="center">

[为什么做这个插件](#为什么做这个插件) · [安装](#安装) · [配置](#配置) · [卸载](#卸载) · [Endpoint 与计费](#endpoint-与计费) · [已知边界](#已知边界) · [开发](#开发)

</div>

---
## 为什么做这个插件

事情要从火山方舟 Coding Plan 打骨折说起：**基础 Lite 原价 ¥40 现在只要 ¥9.9，高阶 Pro 原价 ¥200 现在只要 ¥49.9**——这个价格不薅简直对不起钱包。可惜 DSH 自带的 pi-ai 路由虽然也能接火山方舟，却用不了 Files API：贴图只能一轮一轮地把整张图片 base64 塞进上下文，多轮对话又慢又费。

于是就有了这个插件：走火山官方 Responses API + Coding 网关，图片优先上传到方舟 Files API（上传一次，多轮只传 `file_id`），失败自动降级 base64，图片消息零硬失败。

**9.9！真的TM太香了！**

> 折扣信息为 2026-08 活动价，以火山方舟官网为准。

## 安装

```bash
dsh plugin add github:IcedWatermelonJuice/dsh-provider-veark
# 或本地目录
dsh plugin add /path_to_dsh-provider-veark
```

安装后**重启 DSH** 生效。

## 配置

1. 打开 DSH 网页 → **设置 → 插件 →「火山方舟 Coding Plan」**，展开卡片。
2. 粘贴**密钥**（火山方舟 API Key）→ **保存**。密钥写入 DSH 凭据服务，不回显、不落 settings.yaml。
3. 完成。模型选择中出现「火山方舟 Coding Plan」（默认 `ark-code-latest`，支持文本 + 图片），贴图对话即可使用。

卡片内可折叠调整：图片是否走云端文件服务、接口地址、图片清晰度与大小上限、超时与重试、模型列表等；全部字段留空即恢复默认。

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
  #     inputModalities: ["text", "image"]
  #     imagePixelBudget: 640000
  #     imageMaxBytes: 1048576
  # requestImagePixelBudget: 640000
  # requestImageMaxBytes: 1048576
  # fileExpirySeconds: 604800
  # filesApiTimeoutMs: 15000
  # filesProbeIntervalMs: 21600000
```

密钥也可不填卡片，改为启动前设置环境变量 `ARK_API_KEY`（或自定义 `apiKeyEnv` 指定的引用名）。

</details>

## 卸载

```bash
dsh plugin --profile web remove dsh-provider-veark
```

然后重启 DSH。插件不修改任何宿主文件；卸载后可再手动删除 `%DSH_HOME%\dsh-provider-veark\`（仅本插件的状态文件）。

## Endpoint 与计费

| 请求 | URL | 计费 |
|---|---|---|
| 模型对话 | `…/api/coding/v3/responses` | Coding Plan 套餐 |
| 图片上传/删除 | `…/api/v3/files`（默认） | 存储 API，不计模型 token |

> 实测（2026-08，coding key）：coding 网关 `/api/coding/v3/files` 不可用；标准域 `/api/v3/files` 可用。感觉官方日后是想将coding的files api也顺带迁移过去。

## 已知边界

- 助手历史中的 reasoning 块不回放（Responses 协议限制）。
- 不支持视频、文档、TOS 直传，这属于后面的计划工作。

## 开发

架构、测试、发布与回退手册见 [DEV.md](./DEV.md)。

```bash
pnpm install
pnpm test
```

## License

[MIT](LICENSE)
