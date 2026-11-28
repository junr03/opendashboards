<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Container configuration

- For custom services and packaged applications, make `docker-compose.yml` the runtime
  configuration surface: prefer environment variables, using command arguments and
  mounted config/secret files where needed.
- Keep startup validation, readiness checks and initialization inside the container.
- Limit Nix to host integration and deploying Compose; avoid duplicate application
  settings in Nix options.
