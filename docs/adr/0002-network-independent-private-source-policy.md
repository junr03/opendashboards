---
status: accepted
---

# Keep private-source authorization independent of network technology

Private database access requires both a working network path and permission for OpenDashboards to contact the destination. The application will implement operator-controlled destination authorization independently of whether deployment connectivity uses a local container network, Tailscale, or another private network. Routing and network membership remain deployment responsibilities, avoiding a Tailscale-specific integration as a prerequisite for private database support.
