# dsh-provider-veark · Volcengine Ark Coding Plan Provider for DeepSeek Harness

<p align="center">
  <a href="README.md">中文</a> | English
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
  <strong>Plug the Volcengine Ark Coding Plan into DeepSeek Harness: text + image chat, images via Files API, paste-and-go API key</strong><br>
</p>

<div align="center">

[Install](#install) · [Configuration](#configuration) · [Uninstall](#uninstall) · [Endpoints & Billing](#endpoints--billing) · [Known Limitations](#known-limitations) · [Development](#development)

</div>

---
## Install

The commands below use the `web` profile as an example (replace it with your own profile name, e.g. `headless`). Pick any one of the three ways, then **restart DSH**.

### Option 1: npm registry (recommended)

```bash
dsh plugin --profile web add @icedcola/dsh-provider-veark
```

### Option 2: GitHub source

```bash
dsh plugin --profile web add github:IcedWatermelonJuice/dsh-provider-veark
```

### Option 3: local link (development)

```bash
dsh plugin --profile web add /path_to_dsh-provider-veark
```

> A local install is a **link-style install**: it references the source directory directly, so code changes take effect immediately; do **not** delete or move that directory while installed, or bundle resolution breaks.

## Configuration

1. Open the DSH web UI → **Settings → Plugins → "火山方舟 Coding Plan"**, expand the card.
2. Paste your **API key** (Volcengine Ark API key) → **Save**. The key is stored in the DSH credentials service; it is never echoed back or written to settings.yaml.
3. Done. "火山方舟 Coding Plan" now appears in model selection (default `ark-code-latest`, text + image input); image chat works out of the box.

The card also offers collapsible sections for: cloud file service on/off, endpoint URLs, image resolution/size limits, timeouts & retries, and the model list. Leave any field empty to restore its default.

<details>
<summary>Advanced settings.yaml fields (optional)</summary>

These can also be set by editing the `dsh-provider-veark:` section of `%DSH_HOME%\settings.yaml` (hot-reloads on save; the whole section may be omitted = all defaults):

```yaml
dsh-provider-veark:
  preferFiles: true
  chatBaseURL: https://ark.cn-beijing.volces.com/api/coding/v3   # coding gateway, do not change
  filesBaseURL: https://ark.cn-beijing.volces.com/api/v3         # switch to …/api/coding/v3 when standard domain returns 403
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

Alternatively, skip the card entirely and set the `ARK_API_KEY` environment variable before starting DSH (or a custom reference name via `apiKeyEnv`).

</details>

## Uninstall

```bash
dsh plugin --profile web remove @icedcola/dsh-provider-veark
```

Then restart DSH. The plugin does not modify any host files; afterwards you may also delete `%DSH_HOME%\dsh-provider-veark\` (only this plugin's state files).

## Endpoints & Billing

| Request | URL | Billing |
|---|---|---|
| Chat | `…/api/coding/v3/responses` | Coding Plan subscription |
| File upload/delete | `…/api/v3/files` (default) | Storage API, no model tokens |

> Field-tested (2026-08, coding key): the coding gateway `/api/coding/v3/files` is not available; the standard domain `/api/v3/files` works. It looks like Volcengine may migrate file storage for coding plans over to the standard domain later. The default (standard domain) already works — no configuration needed.

## Known Limitations

- Assistant reasoning blocks are not replayed in history (Responses protocol limitation).
- No video, document, or TOS direct-upload support — planned future work.

## Development

Architecture, tests, publishing and the rollback manual live in [DEV.md](./DEV.md).

```bash
pnpm install
pnpm test
```

## License

[MIT](LICENSE)
