<p align="center">
  <img src="public/shiro-logo.svg" alt="" width="96" />
</p>

<h1 align="center">OpenDashboards</h1>

<p align="center"><strong>Ask any question. Get a live dashboard.</strong><br />The open-source alternative to Claude Dashboards.</p>

<p align="center">
  <a href="https://opendashboards.com">Website</a> ·
  <a href="https://opendashboards.com/apps">Sign up</a>
</p>

<p align="center">
  <a href="https://discord.com/invite/Pbv5PsqUSv"><img src="https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>
  <a href="https://x.com/openuidev"><img src="https://img.shields.io/badge/@openuidev-black?logo=x&logoColor=white" alt="X" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-black" alt="MIT license" /></a>
  <a href="https://github.com/thesysdev/opendashboards/stargazers"><img src="https://img.shields.io/github/stars/thesysdev/opendashboards?style=flat&color=black" alt="GitHub stars" /></a>
</p>

## What is OpenDashboards

Connect your databases and tools, ask a question in plain words, and get a live, interactive
dashboard that pulls from all of them. Filter it, drill down, and edit one chart without
touching the rest.

This fork is an independent, self-hosted implementation. It uses your OpenAI-compatible model
server (Ollama/vLLM), stores dashboards and chats in your Postgres, and executes generated
scripts locally in QuickJS WebAssembly. No OpenUI Cloud account or Gateway key is required.
See the [deployment and migration guide](docs/self-hosting.md).

## Product tour

One question, one dashboard, from every tool that has part of the answer.

<table>
  <tr>
    <td width="50%" valign="top"><b>"How was revenue this month?"</b><br />MRR, net new revenue and churn, from Stripe and Postgres.<br /><br /><img src="public/landing/dashboards/revenue-light.png" alt="A revenue dashboard built from Stripe and PostgreSQL" /></td>
    <td width="50%" valign="top"><b>"How are my sales looking?"</b><br />Pipeline by stage and rep, from HubSpot and Postgres.<br /><br /><img src="public/landing/dashboards/pipeline-light.png" alt="A sales pipeline dashboard built from HubSpot and PostgreSQL" /></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><b>"Which ads are actually working?"</b><br />Cost per customer by channel, from Google Analytics, HubSpot and Stripe.<br /><br /><img src="public/landing/dashboards/marketing-light.png" alt="A marketing dashboard built from Google Analytics, HubSpot and Stripe" /></td>
    <td width="50%" valign="top"><b>"Are signups turning into customers?"</b><br />The signup-to-paid funnel by source, from PostHog, Stripe and Postgres.<br /><br /><img src="public/landing/dashboards/conversion-light.png" alt="A conversion dashboard built from PostHog, Stripe and PostgreSQL" /></td>
  </tr>
</table>

## Why OpenDashboards

- **Your data, your servers.** Connection credentials stay on your server, and queries run
  from it. Generation, storage, and script execution run in your own deployment.
- **Any model.** Connect your own OpenAI-compatible inference endpoint and select its model.
- **Live and interactive.** Dashboards stay connected to your data. Filter them and drill
  down, and they update when the data does.
- **Edit one chart.** Ask for a change and only that chart is built again.
- **Open source.** MIT licensed. Read it, fork it, run it.

## Data sources

| Source | Status | What you need |
| --- | --- | --- |
| PostgreSQL (and Supabase, Neon) | ✅ Supported | Host, database and a read-only user, or a connection string |
| MySQL / MariaDB | ✅ Supported | Host, database and a read-only user, or a connection string |
| ClickHouse | ✅ Supported | HTTPS host, database and a read-only user |
| BigQuery | ✅ Supported | Project ID and a service account key |
| PostHog | ✅ Supported | Region, project ID and a personal API key |
| Google Analytics (GA4) | ✅ Supported | Property ID and a service account key |
| Search Console | ✅ Supported | Property and a service account key |
| Any MCP server | ⚠️ Limited | A remote (HTTPS) server URL. API key auth only, no OAuth |

Give OpenDashboards read-only credentials: a read-only database user, and API keys that can only
read. Anything without a built-in connector, like Stripe or HubSpot, connects
through its MCP server.

## Quick start

### Use the hosted version

Sign up at [opendashboards.com](https://opendashboards.com). Nothing to install.

### Run it yourself

You need Node 24, pnpm 9.15.4, Docker, and an OpenAI-compatible inference server.

```bash
git clone https://github.com/junr03/opendashboards.git
cd opendashboards
corepack pnpm install
cp .env.example .env.local   # set LLM_BASE_URL and LLM_MODEL
corepack pnpm db:up
corepack pnpm db:migrate     # additive; preserves existing data
corepack pnpm dev --port 3100
```

Locally, every request acts as the dev user in `config/local.ts`, and connection keys are
stored unencrypted. Production refuses both.

### Deploy to production

Standalone production hosting includes an operator login and AES-256-GCM credential storage.
Set `AUTH_PASSWORD`, `AUTH_SECRET`, `ENCRYPTION_KEY`, `APP_ORIGIN`, and your inference settings,
then use the Docker Compose app profile. The [deployment guide](docs/self-hosting.md) covers
container networking, optional Ollama hosting, backups, and migration of existing Cloud data.

For databases on private networks, see [operator-authorized private data sources](docs/private-data-sources.md).

## How it works

1. **Connect** your databases and tools. Credentials are encrypted and stay on your server.
2. **Ask** a question. The Build agent explores your sources and plans the dashboard.
3. **Get a dashboard.** Your model generates it, and it queries your sources live
   through your server every time it opens.
4. **Refine** it by chatting. Change one chart, add a filter, or start a new dashboard in the
   same app.

Model requests go directly to your configured inference endpoint. Dashboard programs, versions,
and chat history stay in your Postgres. Filters and refreshes run local queries and isolated
scripts without model calls. Product telemetry is off unless you configure your own endpoint.

## License

[MIT](LICENSE) © Thesys Inc.
