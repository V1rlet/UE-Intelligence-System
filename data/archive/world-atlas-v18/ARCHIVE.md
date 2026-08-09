# World Atlas retirement archive

This directory is the immutable exit archive for the retired GraphBrain World
Atlas, Quest Program, player-metrics, geometry-export, and level-builder
pipelines.

- Frozen formats: `world-atlas@18`, `world-project@2`, `quest-program@2`
- Runtime owner after retirement: Unreal Engine assets and project source
- Architecture/implementation owner: GraphBrain planned graphs and task packages
- Narrative/design source: project GDDs and ClaudeGameStudios documents
- Archived at: 2026-08-08

The files below are not active GraphBrain data and are deliberately excluded
from runtime discovery and schema validation. They must not be edited or copied
back into an active `data/world-projects` directory.

## Migration decisions

### demo-facility

Observed Unreal targets:

- `/Game/Levels/DemoFacility`
- `/Game/Levels/DemoFacility_Alt`
- `/Game/Cinematics/DemoFacility_Beats`
- `/Game/Cinematics/DemoFacility_Beats_Anchored`

These asset paths prove that an engine-side implementation exists; they do not
prove semantic or transform parity with the archived Atlas. Geometry, beats,
camera cuts, and triggers therefore remain `requires_review` in the manifest.
Quest Program content has no implemented Quest owner in the Sabotage source and
is retained only as a legacy design reference.

### world-baf56900

No matching Unreal Level or Sequence was observed during retirement. The
project is `archive_only`; no migration script may create product content from
it without an explicit human decision.

## Rollback

Rollback is a data recovery operation, not a supported runtime mode. Verify file
hashes in `migration-manifest.json`, restore the retired implementation from
source history, and reintroduce the data through one centralized compatibility
boundary. Do not add legacy checks to GraphBrain UI or planning call sites.
