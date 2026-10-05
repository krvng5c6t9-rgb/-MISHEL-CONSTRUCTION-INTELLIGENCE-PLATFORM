# REV16 Executed Evidence — Release/Bootstrap Hardening

Scope executed against the REV15 source tree before packaging REV16.

## Fixed
- Removed hard-coded demo email/password and forced `org_id=1` from the login UI.
- Added explicit Organization ID entry on login.
- Protected unauthenticated first-admin bootstrap with a required 32+ character `BOOTSTRAP_ADMIN_TOKEN` and timing-safe comparison.
- Increased JWT secret minimum to 32 characters.
- Replaced unsafe demo seed content with credential-free reference data only.
- Added migration 028 to neutralize untouched historical placeholder organization identity and remove the exact historical placeholder login if it has no audit activity.
- Strengthened runtime build script so absence of lockfiles is reported as BLOCKED rather than silently using mutable `npm install` resolution.

## Runtime boundary
This revision does NOT claim PostgreSQL/E2E PASS. The current execution environment has no PostgreSQL/Docker runtime and npm dependency installation is not completing, so those gates remain UNVERIFIED/BLOCKED.
