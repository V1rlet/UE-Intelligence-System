# P2 compatibility and consumer audit (2026-08-13)

Status: **Completed**. This is the compatibility checkpoint for the Evidence v3 storage split and the stable Evidence API v1 consumer boundary.

## Active consumers

| Consumer | Supported boundary | Result |
| --- | --- | --- |
| ToolRegistry `graphbrain-evidence` | Loopback HTTP, Evidence API v1 | Registered once, versioned manifest, health reports ready/degraded; no GraphBrain module or data-file imports |
| CGS `$code-evidence` | ToolRegistry adapter commands | Optional and fail-closed for stale/unverified evidence; CGS workflow continues when GraphBrain is absent |
| GraphBrain Viewer | Catalog, reading-context and Evidence API/server resolvers | Current project facts only; engine facts join at read time and never copy into the project snapshot |
| Sabotage tools | No active GraphBrain dependency | `h3_beats.py` retains historical provenance text only and explicitly does not read GraphBrain or Atlas data |

The repository-wide audit of `Tools`, `ClaudeGameStudios`, and `Sabotage/Tools` found no active calls to retired GraphBrain authoring/Atlas endpoints, no direct Evidence data-file consumer, and no external Mermaid or generic `/embed` consumer. References to the H3 vendor's Atlas Cloud API are unrelated and intentionally retained.

## Compatibility matrix

| Previous content/path | Current boundary | Verification | Exit/rollback |
| --- | --- | --- | --- |
| Evidence v2 generation | Central `graphbrain-evidence-publication/1` resolver compatibility mode | Real v3 → v2 → same v3 activation exercise; stable IDs and freshness gate remained valid | `npm run evidence:snapshot -- rollback-v2 --generation <id>` or reactivate the immutable v3 pair |
| v2 graph fixture | Deterministic v2 → v3 project/engine migration | Migration, idempotence, source binding, cross-owner reference and tamper tests | Original immutable v2 generation remains addressable |
| old Viewer URL fields | `viewer/src/appRoute.ts` normalization | Historical route fixtures load while the runtime writes only the current URL form | Adapter remains through the 1.0 diagnostic window |
| seven curated/reference graphs | Versioned archive plus stable 410 diagnostic | SHA-256 manifest, archived annotation review, favorite save/reload tests | Restore from `data/archive/curated-references-v1/graphs/` only through an explicit reviewed migration |
| retired authoring/Atlas routes | Central 410 adapters | Authoring-retirement and server contract tests | Source control/archive recovery only; retired semantic data is not auto-reactivated |
| generic embed and Mermaid routes | `VIEWER_SURFACE_RETIRED` 410 adapter | Consumer audit, zero active Mermaid data, unit/interactive/health contract checks | Source control can restore implementation; archived content is never loaded by the adapter |

## Convergence decision

Evidence API v1 is the only supported new external entry point. The v3 storage format has explicit owners, versioning and deterministic migration; compatibility is centralized instead of distributed through UI call sites. No 0.x diagnostic adapter is removed in this change. Removing one later requires a separate release note, a repeated consumer audit, and a tested rollback.

The technical 1.0 prerequisites in P2U5 are satisfied and the package version is now `1.0.0`. Production activation remains coupled to the final full release gate rather than being inferred from this audit alone.
