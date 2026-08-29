# GraphBrain repository guide

GraphBrain is a read-only UE code architecture viewer. Treat this boundary as a product invariant.

The active coding and review contract is `docs/engineering-standard-v1.md` (format version 1). Its only exception registry is `config/engineering-standard-exceptions.json`; do not add source-local TypeScript suppressions or permanent waivers.

## Ownership

- GraphBrain owns versioned `ue5_code` facts extracted from source and user annotations attached to those facts.
- ClaudeGameStudios owns architecture decisions, plans, stories, Programmer work, reviews, and delivery.
- Unreal Engine assets own spatial, sequence, asset, and runtime state.
- ToolRegistry owns declarations of external tool capabilities and health.

Do not add design editors, planned graphs, level/narrative/quest models, task packages, delivery receipts, workflow dashboards, timelines, or World Atlas functionality.

## Active structure

```text
adapters/ue5-code/       source and engine extraction
core/reading-context/    canonical versioned annotations and favorites
core/annotation/         annotation projection and source staleness
core/favorites/          favorites projection
core/hooks/              code fact refresh only
core/query/              read-only graph analysis and versioned change reports
core/schema/             graph, reading-context and change-report validation
server/                  read APIs, annotation APIs, change APIs, retired 410 boundaries
viewer/                  overview / explore (architecture, relations, API) / changes
data/graphs/             active ue5_code v2 facts with provenance and coverage
data/changes/            derived versioned snapshot comparisons; safe to rebuild/remove
data/reading-context/    active user reading state with revision protection
data/archive/            immutable migration evidence, never active input
```

## Compatibility

- Normalize legacy URLs only in `viewer/src/appRoute.ts`.
- Return retired authoring API responses only through `server/retired-authoring-tools.ts`.
- Do not scatter old-domain checks through components or services.
- Persisted graph changes require an explicit `format_version` and deterministic migration.
- Change reports must reference the canonical active graph; they never become a second node/edge owner.
- Never infer product or design semantics during migration.

## Verification

Run:

```powershell
npm run layer-gate
npm run typecheck
npm test
npm run validate
npm run build
npm run check:bundle
```

Browser smoke tests require the local viewer and Chrome. A missing browser may be explicitly skipped with `GB_SMOKE_SKIP=1`; do not silently report a skipped smoke run as passed.

Any change to the active schema, catalog, annotations, or routing must test both current code facts and the retired compatibility boundary.
