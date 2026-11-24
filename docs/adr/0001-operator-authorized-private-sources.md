---
status: accepted
---

# Private data sources require deployment-operator authorization

OpenDashboards currently refuses nonpublic destinations to protect the server from user-directed access to internal services. For private-source support, retain public-only defaults and allow exceptions for exact hostnames or IP addresses and TCP ports explicitly authorized by the deployment operator; application users cannot expand that authorization. Hostname exceptions additionally constrain connection-time DNS answers to approved addresses or a narrowly scoped subnet, so authorizing a stable service name does not authorize arbitrary future DNS destinations or other hosts in that subnet.

The existing application-database hostname exclusion continues to take precedence, including when another instance uses a different port on that hostname. Explicit exceptions may admit private and loopback IPv4/IPv6 and CGNAT addresses, but cannot override metadata or other special-address denials, including known metadata endpoints inside otherwise eligible classes. Authorization is deployment-wide, subject to existing application connection ownership and source credentials; this feature adds no per-user destination grants.
