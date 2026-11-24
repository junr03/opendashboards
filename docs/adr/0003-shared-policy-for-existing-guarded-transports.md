---
status: accepted
---

# Apply one destination policy across existing guarded transports

PostgreSQL and MySQL share a TCP adapter, while ClickHouse HTTPS and MCP fetch reuse the same DNS/address checks through separate adapters. Apply the operator-authorized destination policy consistently across these existing guarded paths, passing actual hostname, port, and resolved-address context rather than broadening the public-address predicate. This also covers MCP's guarded OAuth requests, each evaluated against its own destination, and avoids divergent private-access semantics between transports; PostgreSQL remains the first end-to-end demo.
