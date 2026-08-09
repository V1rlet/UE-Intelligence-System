# Project snapshot archive v1

This directory stores superseded `ue5_code/project` extraction snapshots that must no longer appear as competing active facts.

- Active replacement: `data/graphs/ue5_code_project_2026-08-09.cyto.json`
- Archived snapshot: `ue5_code_project_2026-07-18.cyto.json`
- Reason: the July snapshot predates 29 current source inputs and has no content fingerprint or coverage evidence.
- Recovery: move the archived file back to `data/graphs/`; GraphBrain will expose it as a stale historical snapshot. Do not remove the active replacement unless a breaking rollback is explicitly chosen.

The archived file was structurally migrated to graph format v2 before archival. Its provenance and coverage remain `unknown`; migration did not invent source facts.
