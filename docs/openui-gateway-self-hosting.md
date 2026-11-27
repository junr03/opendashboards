# OpenUI Gateway self-hosting investigation

Historical investigation; see [the independent implementation guide](self-hosting.md) for the replacement implemented in this fork.

Researched 2026-11-27 against first-party documentation, source, and this checkout. No application code or configuration was changed.

## Answer

OpenUI advertises **Gateway self-hosting and VPC deployment on its custom Scale plan**. That is the documented vendor-supported route. The public pricing page does not specify deployment artifacts, infrastructure requirements, offline operation, or whether that offer includes every Cloud API used by OpenDashboards. Those details need confirmation from Thesys before treating it as a complete stack replacement. [Gateway pricing](https://www.openui.com/docs/gateway/pricing-credits)

Separately, OpenUI's language, parser, prompt generation, and renderer can run without Gateway. Its official documentation explicitly makes the hosted service optional. We can keep those libraries and own model access and application persistence ourselves. [OpenUI Lang overview](https://www.openui.com/docs/openui-lang/overview), [Agent flow](https://www.openui.com/docs/build-agents/how-it-works)

## What is public, and what remains uncertain

The public OpenUI repository contains the language runtime, renderers, prompt generation, chat libraries, and integration utilities. I did not find public Gateway server deployment instructions or an image/Compose/Helm distribution in the first-party sources reviewed. This is a scoped search result, not proof that a vendor-distributed deployment does not exist. In particular, `@openuidev/server` is an SDK for interacting with OpenUI services; installing that package does not start a Gateway service. [OpenUI repository](https://github.com/thesysdev/openui), [Server SDK README](https://github.com/thesysdev/openui/blob/main/packages/server/README.md)

Replacing Gateway removes its automatic provider failover and streamed OpenUI Lang repairs unless we implement equivalents. Autofix is another hosted API, so it retains a Thesys dependency even when inference goes directly to a model provider. [Gateway reliability](https://www.openui.com/docs/gateway/reliability), [Production options](https://www.openui.com/docs/production)

## Options

| Approach | What we control | Remaining dependency / limitation |
| --- | --- | --- |
| Vendor Scale self-hosting | Contract-dependent Gateway deployment and usage settings | Confirm licensing, operational requirements, outbound dependencies, and Cloud artifact/interpreter API coverage with Thesys. |
| Call a model provider directly | Our orchestration, credentials, retries, concurrency, persistence | Provider capacity and rate limits remain. OpenUI Cloud features need separate replacement. |
| Host model inference ourselves | Application services and model-serving capacity | We operate the hardware/runtime and handle generation quality, validation, repairs, and storage. |
| BYOK through hosted Gateway | Provider billing/account | Gateway remains in the path and its plan API-call limits still apply. |

The self-hosting and BYOK distinctions come from [OpenUI pricing](https://www.openui.com/docs/gateway/pricing-credits); BYOK explicitly preserves the hosted routing/correction layer. [BYOK documentation](https://www.openui.com/docs/gateway/byok)

For a concrete local inference example, Thesys's **Open Intelligent UI** app supports a custom OpenAI-compatible Chat Completions endpoint, Ollama, and LM Studio. It generates the complete OpenUI prompt locally. It also explains that local output has no Cloud repair step and that sufficient model context is essential. These are capabilities of that example, **not existing environment variables in OpenDashboards**. [Official example setup](https://github.com/thesysdev/open-intelligent-ui/blob/main/README.md#use-any-openai-compatible-api)

Ollama itself documents a local OpenAI-compatible `/v1/chat/completions` API, with streaming and tools among its supported features. API compatibility still needs testing with our actual tool loop and chosen model; it does not guarantee equivalent reasoning or dashboard generation quality. [Ollama compatibility reference](https://docs.ollama.com/api/openai-compatibility)

For direct OpenUI Lang generation, generate the full prompt in our backend with `generateSystemPrompt({ library, promptOptions })`. `cloud: true` emits instructions for Gateway to interpret, so simply redirecting such a request to a local model would be insufficient. [OpenUI system prompts](https://www.openui.com/docs/openui-lang/system-prompts)

## Dependencies in this checkout

These findings are from repository source, rather than assumptions about a generic OpenUI integration:

| Area | Current implementation | Migration implication |
| --- | --- | --- |
| Build conversation | `lib/agent/index.ts` uses the OpenAI SDK against `config().openui.gatewayUrl`; its response is Markdown. | This is the smallest model-access seam. A direct endpoint needs its own credential/model settings and verified streamed function calls. |
| Error wording | `app/api/apps/[appId]/chat/route.ts` maps status/code `429` to the quoted Gateway message. | The text identifies our error mapping; it does not establish whether the underlying constraint is Gateway or its provider. No live account quota was inspected. |
| Dashboard creation/editing | `lib/dashboards/index.ts` uses `OpenUIClient.defineDashboard`. | Changing the Build chat endpoint leaves this hosted generation path in place. |
| Dashboard interpretation | `app/api/interpreter/route.ts` invokes the defined dashboard's interpreter. Installed `@openuidev/server/dist/index.mjs` runs directly registered data tools locally, but sends generated scripts to `/v1/app/execute`, which can return requests for local tool results. | Full independence requires replacing remote script interpretation as well as model generation. |
| Artifact content | `lib/dashboards/index.ts` reads/deletes `/v1/artifacts/...` with frontend tokens. | Artifact programs/versioning must be migrated or an equivalent API supplied. |
| Frontend and conversation storage | Cloud token route, `lib/apps/cloud-threads.ts`, and app workspace components use Cloud tokens, storage, and artifact rendering. | Local metadata alone is insufficient; replace Cloud-backed history/artifact fetching and wire the open-source renderer to owned content. |
| Settings | `config/common.ts` has separate Gateway and Cloud API URLs, one shared model, and a maximum of 24 agent rounds. Both paths use `THESYS_API_KEY`. | Separate credentials/models before changing providers. One user turn can involve multiple model requests, with dashboard generation adding work. |

The installed SDK sends dashboard generation to `/v1/artifact/chat/completions` and token requests to `/v1/frontend-tokens`. A vendor deployment must cover these and `/v1/app/execute`, artifact storage, and conversation APIs for the app to work unchanged.

There are also endpoint defaults outside `config/common.ts`: the chat route does not pass `apiBaseUrl` to `storeChatCompletionHistory`, and workspace components omit it from `useOpenuiCloudStorage` and `OpenUICloudProvider`. These clients default to the hosted service. Repointing the two configuration URLs alone would leave Cloud traffic.

## Recommended sequence

First establish the actual 429 source using upstream response metadata and account usage. The current UI message alone cannot distinguish quota, transient capacity, or provider throttling. Existing `logError("chat.turn", error)` diagnostics can help, but no original 429 response, `Retry-After` header, or live quota was inspected for this investigation.

For immediate model-access independence, isolate Build chat's endpoint/key/model configuration and test one read-only source/tool conversation against a direct provider or owned inference server. This reduces Gateway traffic but does not remove OpenUI Cloud.

For the user's full-stack objective, compare the vendor Scale deployment's confirmed API coverage with replacing Cloud generation, interpreter, artifact storage, and history using the open-source language/runtime libraries. Validate create, reload with live queries, edit, history restoration, ownership isolation, and export/migration of existing artifact programs before claiming a complete migration.
