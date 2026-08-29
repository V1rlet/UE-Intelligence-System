# GraphBrain 1.0.0 release notes

Release date: 2026-08-13 (Asia/Shanghai)

GraphBrain 1.0 converges on one product boundary: a local-first, read-only UE C++ evidence service and viewer. Project facts, engine facts, human reading context, workflow state and presentation state each have one explicit owner.

## What changed

- Added Evidence API v1 status, query and explicit refresh contracts. Automated consumers fail closed for stale or unverified evidence; the Viewer may still open it read-only with a persistent warning.
- Added Evidence snapshot v3 with separate immutable project and engine artifacts, stable cross-owner references, explicit versions and deterministic v2 migration.
- Registered the `graphbrain-evidence` ToolRegistry adapter and the optional CGS `$code-evidence` workflow. Evidence API v1 is the only supported new external integration boundary.
- Added a local aggregate-only usage summary and split gates into fast, data, release and lifecycle layers.
- Changed the architecture workspace to derive its projection from the active catalog preview. It does not load a second curated architecture fact model.

## Replaced or removed

- Archived seven curated/reference graphs and their 18 annotations under `data/archive/curated-references-v1/`; 18 engine favorites remain bound to unchanged stable class IDs.
- Removed the duplicate Mermaid implementation and dependency. `/api/mermaid` and `/data/mermaid/*` now return the centralized `VIEWER_SURFACE_RETIRED` 410 diagnostic.
- Removed the generic embed application and bundle. `/embed` and `/embed/*` now return the same versioned retirement diagnostic.
- Removed the old architecture reference generators and residual GraphBrain ownership claims for design, balance and Atlas data.
- Ordinary browser smoke writes ignored run artifacts. Updating tracked goldens requires the explicit `npm run smoke:update-golden` path.

The historical authoring/Atlas 410 adapters and old URL normalization remain intentionally retained as thin diagnostic compatibility boundaries. No retired semantic data is automatically reactivated.

## Migration and rollback

- v2 artifacts enter v3 only through the centralized migration/resolver boundary; migrations are deterministic and idempotent. Immutable v2 generations remain addressable.
- Evidence rollback: `npm run evidence:snapshot -- rollback-v2 --generation <generation-id>`, or explicitly reactivate the prior immutable v3 pair.
- Service rollback: `npm run service:rollback`. Deployment retains bounded current/previous release pointers and validates a candidate before activation.
- Curated references can be restored only from the archive manifest through an explicit reviewed migration. Stable 410 diagnostics are the default old-deep-link behavior.

## Verification

The release requires `npm run check:release`, `npm run check:lifecycle`, production candidate health checks, activation, and post-activation Evidence/retirement endpoint verification. Final release and deployment identifiers are recorded in the execution plan after activation.
