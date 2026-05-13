---
name: subagent-routing
description: Decide when to keep work in the parent session, use repo-governor, or delegate to local-builder or local-reviewer. Use for Time Keeper task routing and subagent selection.
---

# Time Keeper Subagent Routing

This skill is for the parent orchestrator only. Do not inject or follow it inside child subagents.

## Read next
- `../../agents/local-builder.md`
- `../../agents/local-reviewer.md`
- `../../agents/repo-governor.md`
- `../../../AGENTS.md`
- `/Users/nemmer/.nvm/versions/node/v24.12.0/lib/node_modules/pi-subagents/skills/pi-subagents/SKILL.md`

## Routing rules

### Keep work in the parent session when
- the task is architectural or cross-cutting
- auth, API contracts, persistence, or security are involved
- the scope is ambiguous and needs clarification first
- success depends on synthesizing many files or decisions across the repo

### Use `repo-governor` when
- the task is mainly about governance
- docs, memory, or repo operating rules need alignment
- you need non-destructive planning around repo conventions

### Use `local-builder` when
- the task is bounded and low-risk
- the relevant scope is small (roughly one package or up to about five files)
- the work is code/doc editing, a focused refactor, or a targeted test
- the validation plan is straightforward
- a local Ollama model is good enough and cheaper than a high-context hosted agent

### Avoid `local-builder` when
- auth or storage boundaries are touched
- the task needs broad diagnosis or large-context planning
- the task spans multiple packages with contract changes
- the task would require the child to orchestrate other subagents

### Use `local-reviewer` when
- you want a cheap first-pass review of a small diff, bounded implementation, plan, or doc set
- the review scope is narrow and the likely issues are local correctness, validation gaps, or unnecessary complexity
- you want evidence-backed findings before escalating to a stronger hosted reviewer

### Avoid `local-reviewer` when
- the review touches auth, security, persistence, trust boundaries, or other subtle high-risk surfaces
- the review depends on broad repo context or many interacting files
- you already know the task needs deep architectural judgment

## Prompting guidance
When delegating to `local-builder`, give:
- the exact outcome
- the relevant files or package
- hard constraints and invariants
- the validation to run
- stop rules for handing work back to the parent

When delegating to `local-reviewer`, give:
- the exact review target (diff, files, plan, or doc set)
- the review angle if any (correctness, tests, simplicity, docs)
- constraints such as review-only / no edits
- the expected output shape for findings
- stop rules for handing broad or security-sensitive review back to the parent
