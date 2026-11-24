# OpenDashboards

Language for connecting OpenDashboards to data sources.

## Language

**Private data source**:
A data source reached at a destination outside the public internet, including a database on the same server as OpenDashboards.
_Avoid_: Tailscale database (unless specifically describing its network).

**Deployment operator**:
The person responsible for an OpenDashboards deployment and authorized to grant access to private data sources.
_Avoid_: User (when referring to deployment authority).

**Authorized private destination**:
A specific private data-source hostname or IP address and TCP port that the deployment operator has approved for access from OpenDashboards. For a hostname, the approval also bounds the network addresses it may identify.
_Avoid_: Trusted network (an authorization applies to a destination).

**Application user**:
A person using OpenDashboards to connect data sources and create dashboards, without authority through the application to expand the deployment's permitted private destinations.

**Analytics database**:
A database containing data for dashboard analysis, separate from the database holding OpenDashboards application state and connection credentials.
