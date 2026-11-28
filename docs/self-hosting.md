# Independent OpenDashboards deployment

This fork owns inference orchestration, dashboard generation and repair, script execution, dashboard versions, and chat history. The application makes no OpenUI Cloud or Gateway calls. OpenUI's MIT-licensed language, renderer, dashboard library, and React chat components remain pinned package dependencies. No additional Thesys fork or private repository is necessary for this implementation.

## Local development

Use Node 24, Docker, and pnpm 9.15.4 (or `corepack pnpm`).

```sh
corepack pnpm install
cp .env.example .env.local
# Set LLM_BASE_URL and LLM_MODEL to your inference server.
docker compose up -d --wait postgres
corepack pnpm db:migrate
corepack pnpm dev --port 3100
```

The example endpoint is `http://127.0.0.1:11434/v1`; `qwen3:32b` is an example model id, not a hardware requirement. No weights are downloaded automatically. Select a model with streamed function calls and enough context for the full component-library prompt, tools, and conversation. JSON generation does not require provider-specific structured-output extensions. [Ollama's compatibility documentation](https://docs.ollama.com/api/openai-compatibility) describes its Chat Completions support; API compatibility does not establish a particular model's quality.

`LLM_DASHBOARD_MODEL` optionally selects a second model on the same endpoint. `LLM_API_KEY` is optional and remains server-side. Other limits/defaults are in `config/common.ts`. Only development may use the dev identity and plaintext credentials. Setting standalone auth/encryption secrets enables the production mechanisms locally too.

## Production

Configure these through `.env.local` or your secret manager:

| Setting | Value |
| --- | --- |
| `APP_ORIGIN` | Public origin, e.g. `https://dashboards.example.com`; HTTP allowed only on loopback |
| `AUTH_PASSWORD` | Strong operator password, at least 16 characters |
| `AUTH_SECRET` | Independent random session signing secret, at least 32 characters |
| `ENCRYPTION_KEY` | Separate 32-byte encryption key, encoded as 64 hex characters |
| `AUTH_USER_ID` | Stable data owner id, default `dev-user`; use the existing owner's exact id when migrating |
| `AUTH_USER_EMAIL` | Operator's display email |
| `LLM_BASE_URL`, `LLM_MODEL` | Your inference server and model; optional `LLM_API_KEY` |

Generate `AUTH_SECRET` and `ENCRYPTION_KEY` independently with `openssl rand -hex 32`. Back up the encryption key separately from Postgres. Losing or changing it without reencryption makes existing credentials unreadable.

To use an existing inference server:

```sh
# Set LLM_BASE_URL to a hostname reachable FROM the container.
# For inference on the Docker host: http://host.docker.internal:11434/v1
# For a separate vLLM server: http://inference.internal:8000/v1
docker compose --env-file .env.local --profile app up -d --build
```

To also host Ollama in this Compose project:

```sh
# Set LLM_BASE_URL=http://ollama:11434/v1 in .env.local first.
docker compose --env-file .env.local --profile inference up -d ollama
# Explicitly select/download a model your hardware can serve:
docker compose --profile inference exec ollama ollama pull qwen3:32b
docker compose --env-file .env.local --profile app --profile inference up -d --build
```

Ollama has persistent model storage and no published inference port. GPU setup is host-specific and is not configured automatically. The app runs as nonroot, binds to loopback port 3100, and applies additive migrations before starting. Use a TLS reverse proxy for remote access.

The included Postgres credentials are for development. For shared/production hosting, configure your own protected database and replace Compose's app `DATABASE_URL` override. Existing private analytics sources retain the [operator-authorized network policy](private-data-sources.md).

Standalone authentication supports one operator account, with locally signed HttpOnly/SameSite=Strict session cookies expiring after 12 hours and logout. It is not a multiuser signup system. Existing Supabase and KMS adapters remain optional. Unset `SUPABASE_URL` to select standalone authentication. Old KMS/plaintext credential records are not silently converted: retain their original provider while migrating, or reenter credentials through the connection UI.

Product telemetry is disabled unless the operator provides their own PostHog host/key. Renderer observability is disabled. `THESYS_API_KEY` is not used by the application.

## Owned runtime

| Operation | Implementation |
| --- | --- |
| Build chat | OpenAI SDK tool loop directly against `LLM_BASE_URL` |
| Dashboard create/edit | Locally assembled prompt, JSON generation, up to two repair retries |
| Validation | Local OpenUI parser/schema plus QuickJS syntax checks before publishing |
| Programs | `dashboard_artifacts` and immutable `dashboard_versions` in Postgres |
| Concurrent edits | Optimistic version checks; stale edits conflict |
| Rendering | Open-source `Renderer` fetching content from this app |
| Filters/refresh | Authenticated local `/api/interpreter`, with no model call |
| Scripts | Fresh QuickJS WebAssembly context per execution |
| Conversations | `app_threads` and idempotent `chat_turns` in Postgres |
| Credentials | AES-256-GCM with authenticated owner, connection, and purpose |

The dashboard document contract is `{ "program": "OpenUI Lang", "scripts": { "script_name": "JavaScript function body" } }`. Scripts receive `args` and `tools`, return JSON, and call registered tools synchronously inside the VM; Asyncify suspends it for asynchronous host I/O. Scripts cannot access Node, files, network, imports, or application secrets. Data tools retain their existing ownership checks, read-only transports, network policy, timeouts, and row limits.

Each script has a 32 MiB heap, 512 KiB stack, 2-second CPU budget, 120-second wall budget, 16-tool-call limit, and 2 MiB result limit. A failed generation never replaces a working version.

Generation completes before publishing a new version. The UI shows progress and then the validated result; partial dashboard programs are not streamed. Edits generate a complete document with instructions to preserve unchanged sections, rather than using the vendor's incremental patch algorithm.

## Existing Cloud data

Migration `0005_owned-runtime.sql` is additive. Existing metadata and credentials are retained; no Cloud records are deleted. Legacy dashboards show an import message until their programs are local. Existing chat mappings remain, but their messages need importing.

Archive the legacy content while the old key still works:

```sh
# This one-time export command alone uses the old THESYS_API_KEY.
node scripts/export-openui-cloud.mjs .backups/openui-export
```

The exporter reads only. It obtains user-scoped tokens, archives raw artifact responses and paginated conversations, and writes a manifest of failures. Files use owner-only permissions; `.backups/` is gitignored. Nonzero exit status means an incomplete export. It needs validation against your actual account and does not establish that Cloud exposes every generated script body.

Import archived conversations before new local turns are written to those threads:

```sh
node scripts/import-openui-history.mjs .backups/openui-export/conversation-0.json
```

The importer checks the original owner/app/thread mapping, preserves the archive, rejects unsupported item types, and is idempotent. It refuses to put older history after new local turns.

Authenticated same-origin artifact endpoints support local backups and imports:

- `GET /api/artifacts/:id?download=1` exports `{program,scripts}`. Add `&version=N` to export an older immutable version for inspection or restoration.
- `PUT /api/artifacts/:id` imports a validated document for an existing owned dashboard. Updating local content requires `If-Match: <current numeric version>`; stale writes conflict.

Raw Cloud exports may need conversion to the document contract. Cloud-generated queries need their script bodies rewritten for the local `tools` contract. There is no hosted interpreter fallback, and unknown scripts are refused. Rebuilding from the original prompt is another option; validate queries/results before replacing existing dashboards. Hidden Cloud script sources are not automatically migrated.

## Verification

```sh
corepack pnpm test
corepack pnpm lint
corepack pnpm build
corepack pnpm exec playwright install chromium
corepack pnpm test:e2e
```

The ordinary suite resets the dedicated `opendashboards_test` database; never point it at application data. The browser smoke script requires a database name ending `_test` and creates/removes only its own fixture app. It uses a real local HTTP model stand-in to check production login, streamed tool calls, create/edit/reload, filters without new inference, restored local history, and absence of external browser requests. It does not measure a real model's quality, hardware requirements, or throughput. Verify those against your Ollama/vLLM endpoint.

On Linux, `SMOKE_IMAGE=opendashboards:self-hosted corepack pnpm test:e2e` runs the same checks against a locally built image using host networking.

## Measuring real inference performance

Set `LLM_PERFORMANCE_METRICS=true` in the app's Compose environment and restart
with the new image. It defaults to false. Use Build normally, then expand
**Performance** below the composer. The last measured turn shows browser wait,
server duration, inference wait and other server work, with each chat/dashboard
model request, outcome, input/output tokens and streaming first-token latency.
The panel belongs to its conversation and is cleared on reload or a new send.

First token includes thinking or tool generation. First output excludes hidden
thinking. Buffered dashboard generation has no observable first-token time and
shows a dash. Token usage is reported by the provider; missing counts remain
unknown. Effective tokens/second is output tokens divided by complete HTTP
request duration, including model loading, queueing, prompt evaluation and
generation. It is not decode-only speed. Inference wait is the union of request
intervals, so overlapping calls are counted once. Other time includes tools,
validation, database work and SDK retry backoff. Retries appear as separate
requests; dashboard repairs appear as separate dashboard calls.

Versioned `inference_call` and `inference_turn` JSON records go to server stdout.
They contain generated trace/call IDs, timestamps, model, phase, status, timing
and token counts. Prompts, outputs, SQL, tool arguments, data-source identifiers,
user identities, request headers and credentials are excluded. No external
telemetry service or new database table is used. Existing container log retention
controls history; the in-app panel is an ephemeral summary.

For a session report on electricpeak:

```sh
docker logs --since 30m opendashboards 2>&1 | node scripts/inference-performance-report.mjs
# Add --json to export statistics. The reporter reads stdin.
```

Run that command from a checkout containing the report script. Reports separate
streamed chat and buffered dashboard generation by model, show completed-request
nearest-rank p50/p95 latency and first-token time, count failures/cancellations separately,
and compute weighted effective throughput from calls with known usage. Small
samples have unstable percentiles; collect 10–20 representative interactions,
including dashboard edits, and retain failures. Simply viewing/filtering an
existing dashboard runs data queries without inference.

For a repeatable synthetic Ollama baseline, independent of app data:

```sh
docker exec -i opendashboards node --input-type=module < scripts/benchmark-ollama.mjs
```

This sends three identical short prompts, thinking disabled and output capped at
64 tokens. It does not force model unloading. Record the reported load duration
and compare the first sample with subsequent samples. Ollama's native API returns
load, prompt-evaluation and generation durations in nanoseconds; the script
converts them to milliseconds and computes decode speed as
`eval_count / eval_duration * 1e9`. The cached prompt count is shown when available.
See [Ollama's usage metrics](https://docs.ollama.com/api/usage). This short baseline
does not predict dashboard quality or long-context latency. The normal app uses
the OpenAI-compatible endpoint, which does not expose that native breakdown;
its measured request timings remain separate from these native server timings.
