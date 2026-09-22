# AI PROJECT OS CONSTITUTION

This document defines the foundational architectural rules and development principles for all AI agents working on this project. Every task, proposal, context pack, and code modification is evaluated against these principles.

---

## 1. Reuse Before Create
- **Rule**: Always inspect and leverage existing abstractions, classes, interfaces, services, and utilities before creating new ones.
- **Enforcement**: If a service, utility, or helper with similar functionality or nomenclature already exists in the project, the agent MUST reuse it or explain why an extension is necessary. Creating parallel implementations of existing functionality is prohibited.

## 2. Modify Before Duplicate
- **Rule**: When requirements require enhanced behavior, extend, parameterize, or refactor existing modules rather than cloning or writing parallel variants.
- **Enforcement**: Duplicating code logic, creating `v2` or alternate parallel files (e.g. `user-manager.ts` alongside `user-service.ts`) without deprecating or replacing the original is an architecture violation.

## 3. Minimal Change
- **Rule**: Limit modifications strictly to the files and components directly relevant to the current task's objective.
- **Enforcement**: Do not reformat unrelated files, rewrite unrelated modules, or introduce drive-by cleanups outside the declared task scope.

## 4. No Unnecessary Dependencies
- **Rule**: Do not add external npm/runtime dependencies unless explicitly justified and approved.
- **Enforcement**:
  - Check whether existing installed dependencies already provide the needed functionality (e.g. native `fetch` vs `axios`, existing helpers vs `lodash`).
  - Do not add duplicate or conflicting packages.
  - Adding an external dependency requires explicit approval (`approval_required`).
  - Any declared dependency in `package.json` that is not imported in source code is flagged as an `unused_dependency`.

## 5. Preserve Existing Architecture
- **Rule**: Respect architectural boundaries, layer separation, and dependency directions.
- **Enforcement**:
  - UI components must never access database or low-level storage directly.
  - Core domain models must not import UI, CLI, or adapter-specific layers.
  - Subsystem boundaries must remain clean; circular imports between modules or files are strictly prohibited (`error`).

## 6. Avoid Unrelated Changes
- **Rule**: Never modify system configurations, root files, database schemas, or orthogonal subsystems unless the active task explicitly demands it.
- **Enforcement**: Git diff analyzer monitors working-tree changes and flags unexpected file modifications outside the task scope.

## 7. Keep Modules Cohesive
- **Rule**: Keep modules focused with high cohesion and low coupling.
- **Enforcement**: Avoid superficial or unnecessary abstractions (e.g. trivial 1-method wrappers or pass-through proxy classes that merely delegate without adding validation, abstraction, or behavior).

---

## Guard Enforcement Levels
The **Architecture Guard** classifies rule deviations into three distinct tiers:
1. **`warning`**: Advisory notice. Does not block task completion; highlighted in context and summaries for transparency.
2. **`approval_required`**: Requires explicit supervisor or human authorization (e.g. adding new dependencies, touching files outside declared scope).
3. **`error`**: Hard architectural violation (e.g. layer leakage like UI importing DB, circular dependencies, exact duplicate service creation). Blocks task completion.
