# Private data sources implementation verification

Application implementation and verification completed on 2026-11-24. The complete ticket's hosted-dashboard demo remains pending its separately authorized activation; it has not been reported as passed. No live deployment, upstream submission, or host configuration change was performed.

## Work evidence

The accepted ticket's work IDs are ownership units within one application slice, not additional tickets or PRs.

| Work ID | Deliverable | Depends on | Owner | State | Evidence |
| --- | --- | --- | --- | --- | --- |
| W1 | Shared destination policy and typed operator configuration | None | Codex | Verified | Configuration tests cover empty defaults, malformed/ambiguous rules and normalization; policy tests cover exact host/port matching, bounded IPv4/IPv6/mapped answers and permanent denials |
| W2 | Private PostgreSQL/MySQL TCP path | W1 | Codex | Verified at shared guard; PostgreSQL integration verified | Real TCP guard tests exercise DNS/port and own-host precedence; PostgreSQL test proves refusal without a rule, then connection testing, discovery and querying of a fixture table with its exact rule; MySQL's existing caller uses that same guarded socket |
| W3 | Private HTTPS and fetch/OAuth paths | W1 | Codex | Verified at guarded transport boundaries | Real local TLS tests exercise production address authorization, explicit TLS mode and default certificate refusal; one fetch instance cannot reuse a hostname's permission at another origin/port; existing fetch and MCP suites pass |
| W4 | Full verification and standards/spec review | W2, W3 | Codex | Verified | 27 test files pass: 507 tests passed, 23 opt-in tests skipped; typechecking, lint and production build pass; standards review found no issues; spec review's missing multi-origin DNS regression was added and the reviewer confirmed resolution |
| W5 | Operator documentation and first PostgreSQL dashboard demo | W2 | Codex | Documentation verified; dashboard activation pending | Operator guide documents typed settings, DNS bounds, TLS, own-host/metadata denials and demo procedure. PostgreSQL source path is tested; no hosted dashboard was generated |

## Checks

Executed the repository's dashboard-spec generation and Next.js route type generation before typechecking. Ran focused tests during implementation, then the complete suite. Following review, added one regression test and reran the complete suite: **507 passed, 23 skipped, across 27 passing files**.

Typechecking (`tsc --noEmit`), repository lint (`eslint .`), and the production build (`next build`, Next.js 16.4.5) passed. The build needed network access for the application's existing Google font downloads; the initial sandboxed attempt was stopped and the unchanged build passed with network access.

Database tests used an isolated temporary PostgreSQL 17 cluster on a nondefault loopback port. The PostgreSQL fixture supplies a disposable TLS proxy so normal development databases need no TLS reconfiguration. HTTPS/fetch tests use temporary local TLS servers and the production destination policy. OpenSSL is already a prerequisite of the existing OAuth tests.

The optional real MySQL and ClickHouse engine suites and external live-service tests were not activated. Shared TCP/HTTPS guard behavior is verified; this is not a claim that those database engines were exercised end to end.

## Review

Reviewed the change from starting revision `bb525b1d0ede7ed55b5d710f82523994c3a352c1` against the confirmed design and repository guidance, with separate standards and spec reviewers.

### Standards

No findings.

### Spec

One regression-coverage finding: the original multi-origin fetch test used literals and did not prove per-connection DNS port binding in one shared dispatcher. Added a hostname-based test using two real TLS ports, requiring a blocked-address cause and zero requests at the unauthorized server. The reviewer confirmed it resolved the finding. No remaining confirmed spec defects.

## Remaining activation evidence

In an authorized deployment, use the assumed populated analytics PostgreSQL instance with a distinct destination and compatible TLS, demonstrate refusal without its rule, then connection/table discovery and a generated dashboard with its exact rule. Record the prompt and expected/actual fixture result. The [operator guide](private-data-sources.md) provides the procedure.

Actual dashboard generation, production packaging/rollout, and upstream submission are separate gates. They do not block implementation of the application policy, but pending demo evidence prevents claiming the entire ticket's acceptance criteria are complete.
