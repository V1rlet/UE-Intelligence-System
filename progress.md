# GraphBrain current status

> Updated: 2026-08-09

## Product state

GraphBrain has converged to a read-only UE code architecture viewer with three top-level destinations: Overview, Explore, and Changes. Architecture, relations and API are modes inside Explore. Code facts are read-only; annotations and favorites remain as user-owned reading context.

The 2026-08-09 trust audit found that format-valid graphs could still be stale because the catalog exposed file mtimes as update times. Graph format v2 now owns explicit provenance, SHA-256 path/content fingerprints, extraction coverage, and diagnostics. The current Sabotage snapshot verifies against 37 discovered inputs; 33 are consumed and four standalone test translation units are explicitly diagnosed as unsupported. The superseded July project graph is recoverably archived under `data/archive/project-snapshots-v1/`.

Annotations, server function favorites, browser class favorites, and browser function navigation caches now converge on `data/reading-context/ue5_code.json`. The document has an explicit format version and monotonic revision; missing preconditions return 428 and stale revisions return 409 with the latest projection. Fifteen legacy annotation node entries were migrated losslessly and their three source files were hash-addressed under `data/archive/reading-context-v1/`.

Versioned change reports now compare explicit graph snapshots without copying canonical node facts. The first report compares the archived 2026-07-18 project baseline with the verified 2026-08-09 graph: 400 nodes added, 18 semantically changed, 77 relations added, and 55 one-hop affected nodes across eight modules. The baseline remains honestly unverified because its old format has no source fingerprint. Reports use format v1, validate their current file/subsystem/fingerprint against the active graph, and have a lossless exit path because they are derived and rebuildable.

## Authoring platform retirement

Completed with explicit user approval:

- Deleted design, level, narrative, quest, planned-code, review, delivery, timeline, workbench, registry, report, design-package and task-package data and code paths.
- Deleted 466 persisted data files. Receipt: `data/archive/authoring-platform-v1/deletion-manifest.json`.
- Deleted 10 standalone authoring prototype/design-card files. Receipt: `data/archive/authoring-platform-v1/residual-deletion-manifest.json`.
- Migrated two retired-domain annotation files byte-for-byte to `data/archive/authoring-platform-v1/annotations/`.
- Migrated one orphan code-annotation file byte-for-byte to `data/archive/authoring-platform-v1/annotations/orphaned-code/`.
- Kept three active annotation files whose subsystem owner exists in active `ue5_code` graphs.
- Centralized retired HTTP APIs as deterministic 410 responses and retired URLs as home diagnostics.

The deleted authoring content is not recoverable from GraphBrain. The manifest records path, byte count, and SHA-256 for audit; restoration would require an external backup or repository history and a new explicit migration review.

## Cross-tool migration

- ClaudeGameStudios now exclusively owns architecture decisions, level plans, Programmer implementation planning, review, and delivery.
- Removed GraphBrain task-package mode from `dev-story`, `story-readiness`, `story-done`, and `sprint-status`.
- Updated the UE-native level-builder workflow so UE owns spatial/runtime facts and GraphBrain is optional read-only code evidence.
- Removed design-asset and document “GraphBrain backfill” paths from ToolRegistry.

## Active format

- Graphs: `ue5_code`, `format_version: 2`, with explicit provenance and coverage.
- Reading context: `ue5_code` only, versioned annotations plus class/function favorites with revision protection.
- Change reports: `ue5_code`, `format_version: 1`, derived snapshot comparisons with canonical-current reference checks.
- Archives: excluded from runtime catalog, file APIs, and default validation.

## Compatibility lifetime

Retired 410 endpoints remain through the GraphBrain 0.x line. Removal requires a 1.0 breaking change plus an audit showing no known consumer still calls them.

## Resident service and stability (2026-08-09)

The resident viewer now has a versioned deployment boundary. Release manifest v3 / runtime protocol 1 content-addresses the frontend, bundled server runtime, and manifest bootstrap as one immutable artifact; live UE facts remain under the canonical project `data/` root. Frontend-only v1 and incomplete runtime v2 releases enter through one explicit ID migration into v3. Preparation builds on an isolated directory and port, validates the HTTP catalog/report contracts plus all five workspaces, and writes `prepared_release` only after success. Activation and rollback preserve NSSM configuration and use optimistic deployment-state revisions.

A same-document workspace soak gate records a versioned runtime report after forced GC. The 12-cycle verification retained one Document, held DOM nodes and event listeners at zero slope, and measured a 0.06 MiB/cycle heap slope with 0.571 MiB net post-warmup growth. The active NSSM service remains on the legacy launch command until `npm run service:activate` is run from an Administrator terminal; the fully validated v3 candidate is prepared and the failed non-admin attempt made no service change.

## Atomic code-fact publication (2026-08-09)

Generated project graphs and change reports now publish through `data/publications/ue5_code.json` format v1. Payloads are immutable SHA-256-addressed files; schema/reference validation and atomic parse-cache persistence complete before one optimistic-revision pointer write exposes the generation. Catalog, direct graph reads, projections, change reports, and annotation staleness share this resolver. Old dated artifacts remain readable through the centralized legacy boundary and are neither overwritten nor inferred into publication state.

The live Sabotage pipeline completed two zero-diff generations and a real pointer publish → rollback → re-activate drill. Publication revision is 4. Reading context remains its own canonical revisioned owner and is scanned only after a successful fact publication; it is not duplicated inside the generation manifest.
