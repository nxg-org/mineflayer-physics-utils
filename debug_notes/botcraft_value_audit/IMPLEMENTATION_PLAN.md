# Botcraft Value Audit, Vanilla Mapping, and Incremental Test Workflow

## Summary

Create a dedicated audit package under `debug_notes/` that documents the entire investigation end to end, including step-by-step progress, variable inventories, vanilla mappings, test checkpoints, and handoff notes for later agents. The work proceeds in small value-group batches, and every batch must have a baseline test checkpoint before any code change and a matching verification checkpoint after the change so behavior deltas are explicit and recoverable.

Chosen defaults:
- Documentation home: `debug_notes/` subfolder
- Test cadence: per value group

## Documentation Package

Create one dedicated folder for this effort, for example `debug_notes/botcraft_value_audit/`, and keep all process artifacts inside it.

Required documents:
- `README.md`
  Brief index of the audit package, current objective, document map, and restart instructions for another agent.
- `00_process_log.md`
  Chronological step-by-step journal. Every meaningful action gets an entry: what was inspected, what was concluded, what remains open, and which tests were run.
- `01_value_inventory.md`
  Full Botcraft value inventory, organized by subsystem and function.
- `02_typescript_sources.md`
  Source-of-truth mapping from each inventoried value to the TS field, setting, helper, attribute, control state, or cached block/property that provides it.
- `03_vanilla_mapping.md`
  Mapping from each documented Botcraft value to the decompiled Minecraft file/function/line where that value or behavior originates.
- `04_rounding_audit.md`
  Classification of every float-sensitive value: exact float literal, derived float, double-until-assignment, unresolved, or intentionally approximate.
- `05_change_batches.md`
  Planned and completed value-group batches. Each batch gets scope, affected variables, expected behavior, baseline tests, post-change tests, and outcome.
- `handoff.md`
  Current state summary for the next agent: completed batches, unresolved questions, active hypotheses, blocked areas, and exact next recommended step.

Process requirements for every document:
- Use stable headings and a table format where possible.
- Include direct file references and line references for every confirmed mapping.
- Mark each entry as `confirmed`, `partial`, `approximate`, or `unresolved`.
- Never overwrite historical findings silently; append corrections with a dated note in the process log and update the affected tables.

## Audit and Mapping Workflow

Work in batches, not all at once.

### Phase 1: Botcraft value inventory

Read `src/physics/engines/botcraft.ts` completely and inventory all value-bearing items.

For each function, record:
- Persistent inputs read
- Locals created
- Constants/literals used
- Derived values produced
- State fields mutated
- Output values returned or applied
- Whether each value is float-sensitive
- Whether it is version-gated

Value categories to inventory:
- Player state values
- Context/settings values
- Attribute-derived values
- Control/input values
- World/block/material values
- Movement intermediates
- Collision/support-block values
- Pose/sprint/fall-flying state-transition values
- Magic constants, thresholds, epsilons, and `Math.fround` sites

### Phase 2: TypeScript source tracing

For every inventoried value, trace where it comes from and how it is accessed using:
- `PlayerState`
- `EntityPhysicsCtx`
- `PhysicsWorldSettings`
- control-state helpers
- attribute helpers
- utility functions
- physics info JSON/config tables if relevant

For each value, document:
- Storage location
- Initialization path
- Update path
- Read path
- Whether the representation is intended to mirror Java float precision
- Whether the current name matches the vanilla concept or is a Botcraft composite

### Phase 3: Vanilla mapping

Map every documented Botcraft value to decompiled Minecraft references, primarily in:
- `LivingEntity.java`
- `Player.java`

Use helper files only when the value clearly originates elsewhere. For each value, record:
- Vanilla file
- Function
- line reference
- semantic role
- whether Botcraft matches directly, renames, approximates, or merges multiple vanilla concepts

### Phase 4: Matching confirmation

For every value, confirm one of:
- exact semantic and numeric match
- semantic match with naming differences
- semantic match with version-conditioned behavior
- approximate match
- unresolved

### Phase 5: Rounding audit

Classify each float-sensitive value into one of:
- exact float literal copied from vanilla
- float at assignment only
- float at intermediate arithmetic steps
- trig-sensitive and likely precision-dependent
- should remain double
- unresolved

This phase must explicitly cover:
- all `Math.fround` calls
- float-like literals such as `0.9800000190734863`
- mixed arithmetic where vanilla likely truncates at intermediate steps
- attribute and movement calculations that combine float constants with JS double operations

## Incremental Test Strategy

Testing is part of the process, not a final step.

For each value-group batch:
1. Define the batch in `05_change_batches.md`.
2. Add or identify baseline tests before any code change.
3. Run baseline tests and record exact outputs in `00_process_log.md`.
4. Make only the scoped change set for that batch.
5. Run the same tests after the change.
6. Record behavioral differences, intended effect, unintended effect, and pass/fail status.
7. Do not advance to the next batch until the current batch’s outcome is documented.

Batch definition rules:
- One batch should correspond to one coherent movement area or one small cluster of values.
- Good batch examples:
  - jump power and sprint-jump offsets
  - grounded friction and slipperiness
  - fall-flying horizontal drag and vertical drag
  - water inertia and liquid gravity
  - collision epsilons and on-ground determination
- Avoid batches that mix unrelated movement systems.

Required test layers per batch:
- Existing regression tests reused where they already cover the area
- New focused unit tests for the exact value group when the current suite is too broad
- For movement-sensitive batches, before/after sample capture of relevant deltas or state fields
- For fragile areas, one guard test that ensures unrelated behavior did not regress

Documentation requirements for tests:
- Each batch must list the exact commands used
- Each baseline and post-change run must record:
  - test names
  - pass/fail
  - key numeric outputs
  - expected direction of change
- If a batch fails, document the failure in the process log and handoff file before trying the next hypothesis

## Public Interfaces and Change Controls

Expected interface/documentation additions:
- New audit folder under `debug_notes/`
- New Markdown audit documents described above
- Additional targeted tests in the existing test suite, grouped by value batch
- No broad refactors while the audit is still in progress
- No unrelated movement changes outside the current batch

Implementation safety rules:
- Keep production code changes tightly scoped to one documented batch at a time
- Preserve backward-compatible behavior unless a batch explicitly targets a known mismatch
- If a test change is needed to capture a baseline, write the test first and document why it represents current behavior rather than intended future behavior
- When a prior hypothesis is disproven, mark it as ruled out rather than deleting its trace

## Acceptance Criteria

The audit process is complete when all of the following are true:
- Every value-bearing Botcraft movement variable is documented in `01_value_inventory.md`
- Every documented value has a traced TS source in `02_typescript_sources.md`
- Every documented value has a vanilla mapping or an explicit unresolved note in `03_vanilla_mapping.md`
- Every float-sensitive value is classified in `04_rounding_audit.md`
- Every code-change batch has before/after tests and a documented outcome in `05_change_batches.md`
- `handoff.md` is sufficient for another agent to continue without making design decisions
- The process log shows the sequence of investigation and why each conclusion was reached

## Assumptions

- The audit uses vanilla decompiled code as the primary authority and Grim only as a secondary verifier.
- The documentation package should live under `debug_notes/`, not a new top-level docs area.
- Test checkpoints should be added per value group, not per individual variable and not only at milestone boundaries.
- Temporary hypotheses are allowed, but each must be explicitly recorded and either confirmed or ruled out before the next batch proceeds.
