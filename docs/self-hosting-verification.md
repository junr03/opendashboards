# Independent runtime verification

Verified 2026-11-27 on branch `feat/self-hosted-runtime`.

- TypeScript: `tsc --noEmit` passed.
- ESLint: `eslint .` passed.
- Regression suite: 30 files passed; 521 tests passed, 23 skipped. The skipped suites require optional MySQL/ClickHouse servers or `LIVE_TESTS` external-service access.
- Production Next.js build: passed, including route type generation and prerendering.
- Docker image: `opendashboards:self-hosted` built successfully with production-only dependencies and a nonroot runtime user.
- Browser verification passed against both `next start` on the host and the Docker image. The image check ran its migration startup before serving the app.

The repeatable browser check is `corepack pnpm test:e2e`; on Linux add `SMOKE_IMAGE=opendashboards:self-hosted` to exercise the image. It checks:

1. Unauthenticated artifact reads return 401; protected pages redirect to local sign-in.
2. The operator signs in with a local cookie and opens their own app.
3. A streamed model tool call creates a validated local dashboard.
4. Its generated script runs in the packaged QuickJS runtime and returns a rendered value.
5. Changing the period filter changes the query result without another inference request.
6. A subsequent chat request edits the dashboard and publishes a new version.
7. Reloading restores the revised dashboard and chat history from Postgres.
8. The browser makes no external-origin requests, and exactly two local chat turns are stored.

The HTTP model stand-ins live in `tests/owned-dashboard-runtime.test.ts` and `scripts/self-hosted-smoke.mjs`. They exercise the real OpenAI SDK's HTTP serialization and streaming tool loop. The generation integration tests also inject invalid JSON and 429 responses, check bounded local repair, and ensure failed inference does not persist an artifact. They are intentionally synthetic providers; no real Ollama/vLLM server or model was supplied, so model quality, context configuration, hardware fit, and throughput remain unverified. Postman CLI was unavailable; these checks use a local Node HTTP server and record their assumptions here.

Storage/interpreter tests cover user/app isolation, immutable versions, stale-edit conflicts, app/delete cascades, idempotent history import, filter arguments, isolated globals, CPU/memory/tool-call limits, and cancellation during suspended host calls. Separate tests cover encrypted credential context binding, session expiry/tampering, and bounded streamed request bodies.

The production browser test exposed a redirect-origin issue that unit tests did not catch: Route Handler `request.url` was normalized to `localhost`, so a 127.0.0.1 session cookie did not accompany the redirect. Login/logout now redirect through the configured `APP_ORIGIN`; the same end-to-end test passed afterward.

Legacy export/import tools preserve source archives and existing ownership. History import was exercised against a synthetic exported conversation and real local Postgres. The exporter has not been run against a real legacy Cloud account; availability of hidden generated script sources is not established. See [the migration guide](self-hosting.md#existing-cloud-data).

No live deployment, model download, Cloud-data export, or production-data migration was performed. Test fixture apps were removed after browser verification. The local Postgres test service and built image remain available for further checks.
