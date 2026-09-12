# Catalog submission — `plugin-catalog/ai-usage-tracker.yaml`

Adds one entry to the Hermes plugin catalog:

```yaml
name: ai-usage-tracker
repo: https://github.com/lvabarajithan/hermes-ai-usage-tracker
sha: "f666b46ccce3a5a18c47968745ec3ebc62c1865f"   # v1.0.0
tier: community
```

## What the plugin does

Surfaces **live subscription-quota windows** for every AI provider Hermes can route to —
Codex, Anthropic (OAuth), Nous, OpenRouter, Copilot, OpenCode Go/Zen, Z.AI, Kimi, MiniMax,
DeepSeek — as a desktop page (sidebar → *AI usage*), a status-bar chip showing the worst
remaining window, and a per-profile picker.

- **Read-only.** Credentials resolve in-process through Hermes's own resolver and are never
  serialized; the wire carries `configured: true/false` plus a source label.
- **Per-profile.** `GET /usage?profile=<name>` binds that profile's `HERMES_HOME` via
  `hermes_constants`' context-local override, so credentials/`state.db` follow the profile.
- **Honest about gaps.** Providers with no public quota API get an explicit reason, never a
  fabricated progress bar.
- No tokens, no cost estimates, no period filters — quota windows only.

## Submission checklist

- [x] Owner-submitted (`lvabarajithan` owns the repo)
- [x] Public repository
- [x] Released (tag `v1.0.0` + GitHub release)
- [x] Capabilities declared: none — the plugin registers no tools, hooks, or middleware;
      `requires_env: []` (it reads credentials the user already configured in Hermes)
- [x] `hermes plugins validate` passes
- [x] `scripts/validate_plugin_catalog.py` passes on the entry
- [ ] Pin maturity — **blocked until 2026-09-26** (the pinned commit `f666b46` must be
      ≥2 weeks old at review time, per the catalog README)

## Verify locally

```bash
hermes plugins install lvabarajithan/hermes-ai-usage-tracker --enable
hermes plugins validate ~/.hermes/plugins/ai-usage-tracker
```

Repo layout is a single unified package (agent half + `desktop/plugin.js`, which Electron
materializes into `desktop-plugins/<id>/`), so one install covers both halves.
