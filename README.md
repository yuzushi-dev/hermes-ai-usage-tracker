# Hermes AI Usage Tracker

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://github.com/yuzushi-dev/hermes-ai-usage-tracker/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Hermes: >=0.21](https://img.shields.io/badge/Hermes-%3E%3D0.21-purple.svg)](https://hermes-agent.nousresearch.com)

Live subscription-quota tracker for Hermes Desktop with granular sub-quota windows (Google Antigravity Gemini / Argon / Claude, Claude standard & Fable, OpenAI Codex, and Mistral telemetry) plus an Orca ADE-inspired multi-badge status bar.

This independent community plugin is maintained at [yuzushi-dev/hermes-ai-usage-tracker](https://github.com/yuzushi-dev/hermes-ai-usage-tracker). Forked from the original work by [lvabarajithan/ai-usage-tracker](https://github.com/lvabarajithan/hermes-ai-usage-tracker) and expanded with discrete sub-quota models, zero-dependency token resolution, telemetry-backed metered usage, and Orca ADE multi-badge desktop integration.

---

## What it does

Hermes AI Usage Tracker gives you live, real-time visibility into your AI provider quotas without having to navigate menus or hunt through model selection dropdowns. It provides:

- **Orca ADE-Style Multi-Badge Status Bar**: Displays live color-coded remaining percentages side-by-side in the bottom status bar (`● 100% Argon  ● 0% AGY Claude  ● 58% Gemini  ● 0% Claude  ● 100% Fable  ● 6% Codex  ● Metered Mistral`), with immediate reset countdown tooltips on hover.
- **Granular Sub-Quota Separation**: Providers that share credentials but enforce separate quota allowances are decoupled into distinct cards and badges:
  - **Google Antigravity (AGY)**: Separated into **`AGY Gemini`** (5h session + 7d weekly), **`AGY Argon`** (weekly pool), and **`AGY Claude / 3P`** (weekly + 5h) instead of an opaque aggregate number.
  - **Claude (Anthropic)**: Decoupled into **`Claude`** (standard 5h session + 7d weekly) and a dedicated **`Claude Fable`** card/badge (weekly model-scoped quota), ensuring critical session exhaustion never masks Fable availability.
  - **OpenAI Codex**: Live ChatGPT backend wham usage with session and weekly windows.
  - **Mistral AI**: Dynamically recognizes your tier (`Mistral EDU` / Vibe / API) via `whoami`, monitors TPM/RPM rate limits, and surfaces real session token consumption from Hermes `state.db` without fabricating misleading percentages.
- **Dedicated Dashboard Page (`/ai-usage`)**: Full cards for each provider showing progress bars, remaining percentage, exact local reset times, plan details, and single-click status bar pin/unpin toggles.
- **Multi-Profile Scoping**: Switch seamlessly between local Hermes profiles (`default`, `penny`, `forge`, etc.) with thread-local context isolation—querying another profile's quota without modifying server credentials.

---

## Main Providers & Quota Endpoints

| Provider | ID | Mode | Measured Allowance / Windows | Source |
| --- | --- | --- | --- | --- |
| **AGY Gemini** | `antigravity-agy-gemini` | Quota | 5h Session + 7d Weekly windows | `agy -p=/quota` CLI |
| **AGY Argon** | `antigravity-agy-argon` | Quota | Weekly Gemini 4 Argon pool | `agy -p=/quota` CLI |
| **AGY Claude** | `antigravity-agy-claude` | Quota | Weekly + 5h Claude/3P allowance | `agy -p=/quota` CLI |
| **Claude** | `anthropic` | Quota | 5h Session + 7d Weekly utilization | `api.anthropic.com/api/oauth/usage` |
| **Claude Fable** | `claude-fable` | Quota | Weekly scoped Fable model quota | `api.anthropic.com/api/oauth/usage` |
| **OpenAI Codex** | `openai-codex` | Quota | Session + Weekly usage & resets | `chatgpt.com/backend-api/wham/usage` |
| **Mistral AI** | `mistral-vibe` / `mistral` | Telemetry | EDU/Vibe tier, 7d tokens, 1M TPM, 2k RPM | `console.mistral.ai` + `state.db` |
| **OpenRouter** | `openrouter` | Credits | Live credit balance & key limit | `openrouter.ai/api/v1/credits` |
| **Nous Portal** | `nous` | Credits | Subscription credits & renewal date | Nous account portal |
| **GitHub Copilot** | `copilot` | Quota | Internal user quota & allowance | `api.github.com/copilot_internal/user` |
| **Z.AI / GLM** | `zai` | Quota | Live usage / quota / limit | `api.z.ai/api/monitor/usage/quota/limit` |
| **DeepSeek** | `deepseek` | Balance | User account balance | `api.deepseek.com/user/balance` |
| **Kimi Coding** | `kimi-coding` | Quota | Coding plan usage | `api.kimi.com/coding/v1/usages` |
| **MiniMax** | `minimax` | Quota | Coding plan remains | `api.minimax.io/v1/...` |

---

## Status Bar Integration

The status bar chip supports two distinct display modes (configured directly from the header dropdown in `/ai-usage`):

1. **Multi-Badge (Orca ADE style)** *(Default)*:
   Renders favorite or pinned providers side-by-side directly in the status bar:
   ```text
   ● 100% Argon  ● 0% AGY Claude  ● 58% Gemini  ● 0% Claude  ● 100% Fable  ● 6% Codex  ● Metered Mistral
   ```
   - Color-coded indicator dots: Green (healthy >25%), Orange (warning 5%–25%), Red/Accent (exhausted or low ≤5%), or Muted.
   - Hover tooltips show exact window details, percentage left, and local reset times (`resets in 42m (12:50, 11 nov)`).
   - Click anywhere on the status bar to jump straight to the `/ai-usage` dashboard.
2. **Single Badge (Compact)**:
   Displays a single compact pill tracking either the global **Auto** worst remaining quota across all providers or a specific pinned provider.

Click the **Pin** icon on any provider card in `/ai-usage` to customize which badges are anchored to your status bar. Use the **Hide (eye)** icon to hide providers you don't use.

---

## Install

Install directly from GitHub via the Hermes plugin manager:

```bash
hermes plugins install https://github.com/yuzushi-dev/hermes-ai-usage-tracker.git --enable
```

Or enable it across multiple profiles:

```bash
for p in default forge jewel penny; do
  hermes --profile $p plugins enable ai-usage-tracker
done
```

Reload Hermes Desktop (`Ctrl+R` or restart) to mount the new backend endpoints and load the desktop extension.

---

## Security & Architectural Boundaries

- **Read-Only**: The backend performs strictly read-only inspection. It never modifies credentials, keys, or provider configurations.
- **No Secret Exfiltration**: All authentication tokens (OAuth bearer tokens, API keys) are resolved in-process inside the backend service and **never sent to the client or serialized over the wire**. The API wire format carries only `configured: true/false`, source labels, and numeric quota metrics.
- **Zero-Dependency Resilience**: Anthropic and Mistral token resolvers read directly from standard credential stores (`~/.claude/.credentials.json`, `~/.hermes/auth.json`, environment variables) with native fallback to Python standard library `urllib.request`. Probes remain fully operational even in constrained environments where external packages (like `ruamel` or `httpx`) are not in `sys.path`.
- **Shared In-Memory Cache**: Outbound quota probes are cached in-process for 60 seconds (thread-safe lock) to prevent redundant remote requests when multiple sub-quotas share a single endpoint.
- **Profile Boundary**: Each probe executes with the selected profile's `HERMES_HOME` bound via thread-local ContextVar overrides, ensuring that requests for secondary profiles do not touch the active runtime environment.

---

## Layout (One Package, Both SDKs)

```text
hermes-ai-usage-tracker/
├── plugin.yaml              # Hermes plugin definition (v2.0.0)
├── __init__.py              # register(ctx) entrypoint
├── dashboard/
│   ├── manifest.json        # { "name": "ai-usage-tracker", "api": "plugin_api.py" }
│   └── plugin_api.py        # FastAPI router mounted at /api/plugins/ai-usage-tracker/
├── desktop/
│   └── plugin.js            # Hermes Desktop frontend with Orca ADE status bar & dashboard
└── catalog/
    └── ai-usage-tracker.yaml # Plugin catalog registration spec
```

---

## Credits & Attribution

Originally authored by [lvabarajithan](https://github.com/lvabarajithan/hermes-ai-usage-tracker) (v1.0.2). Forked, redesigned, and maintained by [yuzushi-dev](https://github.com/yuzushi-dev) (v2.0.0+) with:
- Granular sub-quotas for Google Antigravity (Gemini, Argon, Claude).
- Dedicated Claude Fable model quota isolation.
- Zero-dependency OAuth credential resolution.
- Live telemetry-backed Mistral EDU/Vibe tracking.
- Orca ADE-inspired multi-badge status bar integration.
