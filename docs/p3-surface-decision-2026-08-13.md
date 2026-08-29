# P3 product and operations surface decision (2026-08-13)

Status: **Completed** for the initial reduction batch.

## Evidence boundary

Local usage is stored as `graphbrain-local-usage/1` in ignored `logs/usage-summary.json`. Only fixed aggregate keys, counts, total duration, and cache hit/miss/unknown counts are accepted. Search text, source content, paths, URLs and user identity are not recorded. `GET /api/usage/v1/summary` reads the aggregate; `POST /api/usage/v1/event` accepts only allowlisted Viewer workspace events.

This instrumentation did not exist before this release, so historical zero-use counts were not invented. Retirement decisions therefore required both a repository/external-consumer audit and an absence of active owned data, not merely an empty new counter file.

## Decisions

| Candidate | Consumers and data | Decision | Compatibility and recovery |
| --- | --- | --- | --- |
| Engine full catalog | Viewer API and class browser are active; header-name catalog is searchable while class bodies are parsed on selection | **Retain the browse surface; keep demand-driven parsing.** No full engine class graph is copied into project facts | Engine resolver/cache owns engine facts and can be rebuilt; project snapshot holds stable external references only |
| Mermaid relationship diagrams | No `data/mermaid` content and no external consumer; Cytoscape consumes the canonical relation resolver | **Retire duplicate implementation and dependency** | `/api/mermaid` and `/data/mermaid/*` return centralized 410; source control is the recovery path |
| Generic `/embed` viewer | AFFiNE `design_doc` consumer was already removed; no other external consumer found | **Retire implementation and multi-page bundle** | `/embed` and `/embed/*` return centralized 410; normal Viewer deep links and Evidence API v1 replace it |
| Smoke artifacts | Browser outputs are generated evidence, not product source | **Ignore by default; update goldens only through explicit command** | `smoke:update-golden` is the reviewed promotion path |
| Runtime releases | Deployment owns current/previous/prepared | **Retain bounded policy**; current runtime contains two immutable releases | `service:rollback` targets previous; prepared releases are validated before activation |
| Mobile product surface | No independent mobile workflow owner | **Retain accessibility floor only**: viewport, safe-area, touch and keyboard/readability contracts | Same Viewer DOM and domain services; no separate mobile state model |

The allowlist still recognizes `mermaid.open` and `embed.open` as historical aggregate keys so an existing local summary remains readable. New runtime routes do not emit those events.

## Gate layers

- `npm run check:fast`: layer gate, typecheck, unit/contract tests and schema validation.
- `npm run check:data`: previous-format fixtures, migration, publication, rollback/conflict tests and the live Evidence freshness check.
- `npm run check:release`: fast + data gates, production build, bundle boundary and non-skipped browser smoke.
- `npm run check:lifecycle`: the separate long-running workspace/heap soak.

The release gate contains no `GB_SMOKE_SKIP`; an unavailable browser is a failed/unrun gate, never reported as passed.
