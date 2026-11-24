# Private data sources design

The complete design and verification plan were confirmed on 2026-11-24. A subsequent implementation request authorized the application slice; deployment and upstream submission remain separate.

## First demo and scope

Enable OpenDashboards to connect to databases outside the public internet. The first demo is one analytics table in a separate PostgreSQL instance, one explicitly authorized private connection, and one generated dashboard.

Take an existing, populated local PostgreSQL instance as a prior. Both servers may reside on electricpeak; another tailnet machine is not required. The analytics instance must use a service hostname or address distinct from the configured application-database hostname.

CSV import, an import workflow, cloud data-processing policy, new authentication/secrets infrastructure, and new connection-form interfaces are outside scope. Existing deployment capabilities are context, not additional requirements.

## Accepted authorization model

- Public-only remains the default in every environment. Only the deployment operator can grant exceptions.
- Each exception identifies one exact hostname or IP address and TCP port. No wildcard hosts or blanket private-network permission.
- Hostname rules also specify permitted DNS answer addresses or narrowly scoped subnets. Other hostnames in those subnets gain no permission.
- Validate every answer used for the actual connection; reject the answer set if any answer violates its rule or an overriding denial. Do not authorize through a separate preliminary lookup.
- Explicit exceptions may admit private and loopback IPv4/IPv6 and CGNAT addresses. They do not add network routes or IPv6 connectivity.
- Metadata endpoints remain forbidden, including known endpoints in otherwise eligible classes. Link-local, unspecified, multicast, reserved, and unsupported transition-address classes remain forbidden. Normalize IPv4-mapped IPv6 before evaluation.
- The existing application-database hostname exclusion takes precedence, even for another instance on a different port. This remains a hostname-based check, not identification through every alias or resolved address.
- Authorization is deployment-wide, subject to existing connection ownership and source credentials. No new per-user destination grants.
- Preserve existing TLS modes: `verify-full` by default, or explicitly selected `require` for encryption without certificate verification. No unencrypted mode or new certificate-management interface.
- Authorization is independent of network technology. Routing and network membership remain deployment responsibilities.

See the [glossary](../GLOSSARY.md) and ADRs for [operator authorization](adr/0001-operator-authorized-private-sources.md), [network independence](adr/0002-network-independent-private-source-policy.md), and [shared enforcement](adr/0003-shared-policy-for-existing-guarded-transports.md).

## Configuration following repository conventions

Use a typed destination-rule list in the existing environment-specific `network` settings, with an empty list in both `config/local.ts` and `config/prod.ts`. Extend `config/settings.ts` and the existing central configuration validation. Nonsecret settings already use these objects; no new JSON environment variable or management interface is needed.

A rule contains `host`, `port`, and, for a DNS hostname, `addresses` containing permitted IP addresses or CIDRs. An IP-literal rule grants only its literal and port without requiring a redundant address list. Canonical matching ignores hostname case and a trailing dot; DNS aliases require their own rules. Normalize IPv6 brackets and mapped IPv4 consistently.

Reject malformed host/port/address syntax, wildcard hosts, missing hostname address bounds, duplicate normalized host/port entries, and bounds outside eligible address classes through existing build/startup validation. Address bounds cannot override permanent denials; operators should select the narrowest operational subnet. Policy changes follow the normal configuration build/deployment workflow, with no hot reload.

Policy order:

1. Enforce own-host and permanent metadata/special-address denials.
2. For an exact matching rule, require every literal or DNS answer to satisfy its address bounds and eligible classes. A matching rule whose bounds fail cannot fall back to public-only authorization.
3. Without a matching rule, retain existing public-only behavior, including rejection of mixed public/private DNS answers.

Unlisted public destinations retain current behavior. A private rule grants no permission to other ports, aliases, or hosts.

## Shared enforcement boundary

Use one destination-policy implementation from existing guarded TCP, HTTPS, and fetch adapters. Pass actual hostname, port, and address context: changing the address-only public predicate is insufficient. Handle literal addresses as well as connection-time DNS.

This covers PostgreSQL, MySQL, ClickHouse, MCP transport, and MCP's guarded OAuth discovery/registration/token requests. Every discovered destination needs its own authorization; allowing an MCP server does not authorize all endpoints it names. Fetch may contact multiple origins, so context must come from the actual connection rather than the initial URL.

Preserve HTTPS-only transport, certificate choices, origin restrictions, redirect refusal, and response limits. Apply own-host precedence consistently, including literal-address paths. Existing connection lifecycles remain; there is no live policy-revocation mechanism.

Other outbound paths that do not use these guards remain outside scope: application metadata PostgreSQL, Google/BigQuery, PostHog, OpenUI, KMS, and similar service clients.

PostgreSQL connection testing, table discovery, and queries already share one client connection seam. Preserve its read-only transactions, timeouts, row bounds, and protection against application environment credential fallback.

## Verification and acceptance

Extend existing tests at the shared policy, configuration, and adapter boundaries:

- Empty defaults preserve public-only behavior. Approved private targets succeed; different private hosts, literal IPs, or ports fail.
- Approved DNS answers work; changed/out-of-bounds answers, forbidden mixed answers, and unauthorized aliases fail through the actual connection lookup.
- Cover private IPv4/IPv6, loopback, CGNAT, mapped addresses, and literals. Existing metadata cases `169.254.169.254`, `fd00:ec2::254`, and `100.100.100.200` remain blocked even with overlapping rules.
- Own-host denial takes precedence, including other ports on the same name. Preserve credential isolation and read-only query protections.
- Invalid/ambiguous configuration fails validation; shipped local and production rule lists stay empty.
- Exercise the production policy through TCP, HTTPS, and fetch adapters. Preserve TLS, origin, redirect, and response-limit behavior, including independently authorized MCP discovery targets.

At the coherent application boundary, run the relevant existing integration suites and lint/build checks. Review actual-port propagation, DNS/literal handling, overriding denials, and cross-adapter consistency. PostgreSQL success alone does not establish correctness across the accepted shared scope.

The end-to-end demo starts with the assumed populated PostgreSQL instance: demonstrate refusal without its rule, then successful connection testing, table discovery, and a generated dashboard querying the table with the exact rule. No CSV ingestion is required. Actual demo deployment/execution is separately authorized.

## Delivery and activation boundaries

The first complete application slice comprises shared policy, typed configuration and validation, all affected guard adapters, focused tests, and operator documentation. It has one PostgreSQL user-visible demo; connector-specific verification belongs to the same slice. No parallel expansion or PR-count target is agreed.

Aim for an upstream-suitable contribution, allowing a maintained fork if upstream declines. Upstream acceptance is not a prerequisite for local use. The removal of the earlier local allowance establishes an intentional restriction; maintainers' broader rationale and acceptance of this proposal remain unknown.

Application implementation is authorized. Upstream contact, provisioning, and deployment remain separate actions. Application packaging belongs in `electricpeak-services`; host changes require PRs to `junr03/electricpeak` and the normal deployment workflow; deployment-specific values belong in `electricpeak-sensitive`. Host investigation remains read-only. Do not manually activate configurations or change live services.

The concrete deployment network, PostgreSQL TLS readiness, and eventual upstream submission sequence are later activation/contribution tasks, not prerequisites to completing this application design.
