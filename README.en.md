# Agent API Hub ⚡ (English)

Wire any **OpenAI / Anthropic / Gemini compatible API** (official or relay endpoint) into your local CLI agents with one click. Supports **Claude Code, Codex CLI and Gemini CLI**.

A hands-on project that recreates the core mechanics of config switchers like cc-switch, plus provider connectivity testing. Zero dependencies, single command to run. [中文说明](README.md)

## Quick Start

```bash
node server.js        # or npm start; requires Node 18+
# open http://127.0.0.1:8317
```

1. Click "＋ Add Provider", pick a target CLI, fill in Base URL and API key;
2. Hit "Test" to verify auth (sends a near-zero-cost real request);
3. Hit "Preview" to see exactly what will be written, then "Enable" to write the CLI config file;
4. Restart your CLI session. The ↺ on a status chip restores the CLI's official defaults.

## How It Works

CLI tools read their upstream URL and key from fixed config files. This tool manages writing those files:

| Target CLI | Config file | Keys written |
|---|---|---|
| Claude Code | `~/.claude/settings.json` | `env.ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL` |
| Codex CLI | `~/.codex/config.toml` + `auth.json` | managed block `model_provider` + `[model_providers.apihub]`; `OPENAI_API_KEY` in `auth.json` |
| Gemini CLI | `~/.gemini/.env` | `GEMINI_API_KEY / GOOGLE_GEMINI_BASE_URL / GEMINI_MODEL` |

```
Your CLI agent ──reads──► config file ◄──merge-write (auto-backup first)── Agent API Hub
                                                                        │
                                                        provider list data/providers.json
```

### Key Design Points

- **Merge writes, never clobber**: only keys managed by this tool are touched. Claude's `settings.json` is parsed and merged; Codex's TOML gets a marked managed block at the top of the file (top-level `model_provider`/`model` keys are replaced — TOML cannot return to the root scope after a `[table]` header, and duplicate keys are invalid); Gemini's `.env` is upserted line by line.
- **Backups before every write**: the original file is copied to `*.apihub.bak` (rolling, latest kept).
- **Idempotent**: managed blocks carry start/end markers; re-enabling never duplicates. Corrupted JSON aborts the write.
- **Atomic writes**: temp file + rename, so a crash never leaves a half-written config.
- **Connectivity test**: Anthropic protocol tries `GET /v1/models` first, falling back to a 1-token chat request; OpenAI/Gemini protocols hit their models list endpoints.
- **Status detection**: the panel reads all three config files live and shows the current upstream and its owner (this tool / manual config / default).

## Local Proxy Mode (round 3)

Run `node server.js --proxy` to also start a local gateway at `127.0.0.1:8321`. Point your CLI's Base URL at it and it forwards by path to the *enabled* provider for each target (`/v1/messages` → claude, `/v1/*` → codex, `/v1beta/*` → gemini), with:

- auth-header injection per protocol,
- streaming (SSE) pass-through,
- per-request usage logging (status, latency, tokens) into `data/usage.json`, serialized writes, capped at 1000 entries,
- automatic failover: if the enabled provider errors or returns 5xx, the next provider for the same target takes over (30s per-attempt timeout),
- a `/proxy-health` endpoint, and a proxy status card on the dashboard.

The Usage Logs view shows the request details. The proxy only reads provider data and never writes CLI config files.

## Project Layout

```
agent-api-hub/
├── server.js          # zero-dep backend: HTTP + storage + config writers for 3 CLIs
├── proxy.js           # local proxy gateway (failover + SSE + usage log)
├── public/
│   ├── index.html     # single-page panel (dashboard / providers / usage logs)
│   ├── style.css      # dark & light themes, console-style layout
│   ├── i18n.js        # zh/en dictionaries
│   └── app.js         # frontend logic (vanilla JS, no build step)
├── test/smoke.js      # sandboxed smoke tests (43 assertions, never touches real configs)
└── data/providers.json  # provider storage (generated on first run)
```

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `APIHUB_PORT` | `8317` | Panel port (binds to 127.0.0.1 only) |
| `APIHUB_PROXY_PORT` | `8321` | Local proxy port |
| `APIHUB_HOME` | home dir | Config-file root (testing) |
| `APIHUB_DATA_DIR` | `./data` | Provider storage dir (testing) |

## Tests

```bash
npm test   # provisions a fake home in .sandbox-home, runs 43 assertions, cleans up
```

Covers: merge-writes preserving user settings, backup generation, idempotent enables, TOML root-key cleanup, `.env` upsert, graceful failure handling, reset-to-default, i18n dictionary completeness, and the local proxy (forwarding, SSE, failover, usage logging).

## Safety Notes

- API keys are stored **in plaintext** in `data/providers.json` — a deliberate trade-off for a single-machine tool; do not share this folder.
- Every prompt and code context is sent to the upstream you configure — consider trust before adding relay endpoints.
- The server listens on loopback only and is never exposed to the LAN/internet by default.
