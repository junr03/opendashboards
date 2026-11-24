# Operator-authorized private data sources

OpenDashboards connects only to public addresses by default. A deployment operator can authorize particular private endpoints for the existing PostgreSQL, MySQL, ClickHouse, and MCP connectors, including MCP OAuth requests. Application users cannot change these rules.

## Configuration

Add rules to `network.privateDestinations` in `config/local.ts` for development/tests or `config/prod.ts` for production, preserving the other network settings. Both shipped lists are empty.

For a hostname, specify the exact port and permitted DNS answer addresses or narrow subnets:

```ts
privateDestinations: [
  { host: "analytics-db", port: 5432, addresses: ["172.28.0.0/24"] },
]
```

Replace these examples with the actual endpoint and its narrowest operational bounds. This permits `analytics-db:5432`, not other names in that subnet. Aliases require their own rules. Hostnames match case-insensitively and ignore a trailing dot.

For a literal address, specify only that address and port:

```ts
privateDestinations: [
  { host: "100.90.0.10", port: 5432 },
  { host: "fd7a:115c:a1e0::10", port: 5432 },
]
```

IPv6 brackets and mapped IPv4 are normalized for comparison. Literals cannot specify an additional address list. Rules support private/loopback IPv4 and IPv6 and CGNAT addresses. Wildcards, unbounded DNS names, invalid ranges, and duplicate normalized destination pairs fail build/startup validation. CIDRs must fit entirely inside eligible private space.

Apply changes through the existing configuration build/deployment workflow. No environment-variable JSON parser, management UI, or hot reload is introduced. Removing all exceptions restores public-only behavior after redeployment; existing processes retain their loaded settings.

## Enforcement

Every answer from the actual connection's DNS lookup must pass. Mixed permitted/forbidden answers are refused. For a service publishing both IPv4 and IPv6, approve bounds for both or configure its DNS appropriately. A matching rule whose bounds fail is refused even if it resolves to a public address. Other public destinations retain current behavior.

The application's own database hostname remains forbidden, including a different port on that name. Give the separate analytics instance a distinct service hostname/address. This is the existing hostname-based check, not detection of every alias of that database.

Metadata remains blocked, including `169.254.169.254`, `fd00:ec2::254`, and `100.100.100.200`, even under overlapping rules or mapped IPv4 notation. Link-local, unspecified, multicast, reserved, and unsupported transition addresses remain blocked. Subnets cannot override these denials.

An application rule supplies permission, not routing, DNS, firewall changes, Tailscale membership/grants, or credentials. Existing connection ownership still applies. Permission is deployment-wide; this feature adds no per-user destination grants.

Same-server instances can use distinct service names over a private network. Tailscale or other private networks can provide remote connectivity. The feature manages neither network membership nor IPv6 routing.

TLS remains required with the existing connector defaults and explicitly supported encrypt-only choice. No TLS-off mode or certificate-management interface is added. PostgreSQL must support an existing TLS mode.

MCP stays HTTPS-only. Each private OAuth discovery, registration, or token endpoint needs its own matching authorization; it does not inherit permission from the MCP server. Origin restrictions and redirect refusal remain enforced. Outbound clients not using these guards are unchanged.

## First-demo procedure

Use a separately authorized test deployment with one existing analytics table in a separate PostgreSQL instance. Provisioning, populating tables, and CSV import are outside the feature.

1. Confirm the analytics endpoint has a distinct hostname/address from application storage, is reachable from the application process/container, and supports an existing TLS mode. Have read-only source credentials ready.
2. With no exception, attempt the private connection in the existing form; network policy must refuse it.
3. Add the exact endpoint rule and redeploy through the normal workflow.
4. Test/save the connection and confirm table discovery.
5. Ask for a dashboard querying the table. Check its result against known data and record the prompt, expected result, and actual result without credentials.

Repository tests cover private PostgreSQL connection testing, table discovery and queries, plus real TCP/HTTPS/fetch policy boundaries. They do not prove a hosted dashboard was generated. Record dashboard-demo evidence separately; production activation and upstream submission remain separately authorized.
