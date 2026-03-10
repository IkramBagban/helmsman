---
name: skill-creator
description: Design, write, test, and improve SKILL.md skills end-to-end. Use this whenever the user asks to create a skill, make a skill for X, write/build a skill, improve an existing skill or says "improve this skill", or says "I want a skill that does Y." Also trigger when requests involve skill frontmatter, trigger wording, skill packaging, or skill test/iteration workflows.
---

# Skill Creator

Create or improve skills as a repeatable engineering workflow: capture intent, interview for missing constraints, write `SKILL.md`, test with representative prompts, iterate on failures, and package deliverables.

## Rules

1. Do not draft the final `SKILL.md` before running a short discovery interview.
2. Keep `SKILL.md` under 500 lines; split long details into bundled files.
3. Put trigger conditions in frontmatter `description`, not only in body text.
4. Prefer concrete examples over abstract guidance.
5. Validate with both qualitative review and quantitative checks.

## Step 1: Capture Intent

Extract and confirm:

- Skill goal: what capability should be added.
- Trigger surface: exact user phrases that should activate the skill.
- Inputs: files, parameters, context assumptions.
- Outputs: expected format, structure, and acceptance bar.
- Scope: new skill vs. update to existing skill.
- Test needs: required test prompts, edge cases, and any metrics/assertions.

Write a brief intent summary before implementation.

## Step 2: Interview the User Before Writing

Ask focused questions in small batches. Prioritize:

1. Edge cases and failure modes.
2. Input/output formats (including file paths, schemas, and examples).
3. Success criteria ("what counts as good enough").
4. Example prompts that should trigger and should not trigger.
5. Example files/resources available for `scripts/`, `references/`, `assets/`.

If the user is unsure, propose defaults and ask for confirmation.

## Step 3: Plan the Skill Structure

Define the folder layout before drafting:

```text
<skill-name>/
  SKILL.md
  scripts/        (optional; deterministic or repeatable execution)
  references/     (optional; long or variant-specific docs to load only when needed)
  assets/         (optional; templates/static files used in outputs)
```

Use bundled resources when:

- `scripts/`: repeated logic is easier/safer to execute than re-prompt each time.
- `references/`: detailed guidance would bloat `SKILL.md`.
- `assets/`: outputs depend on reusable templates/artifacts.

## Step 4: Write SKILL.md

Produce a complete `SKILL.md` with:

1. YAML frontmatter:
- `name`: lowercase, hyphenated, stable.
- `description`: include both what the skill does and when it should trigger.
- Make trigger wording slightly aggressive to avoid under-triggering.

2. Markdown body:
- Clear step-by-step workflow in imperative voice.
- Explicit decision rules and fallbacks.
- Instructions for when to read each bundled file.
- Constraints and quality bar.

Use this trigger-writing pattern:

```text
<Core capability>. Use this whenever the user asks to <trigger 1>, <trigger 2>, <trigger 3>, or when requests mention <related artifacts/contexts>.
```

## Step 5: Test the Skill

Run a representative test suite:

1. Positive trigger prompts (should trigger).
2. Negative trigger prompts (should not trigger).
3. Workflow prompts (should produce correct outputs).
4. Edge prompts (ambiguous, incomplete, conflicting requirements).

Evaluate with two lenses:

- Qualitative review:
  - Relevance, clarity, completeness, and user effort.
  - Correct use of scripts/references/assets.
  - Good failure handling and explicit assumptions.
- Quantitative checks:
  - Trigger precision/recall from test set.
  - Pass rate for required assertions (format/schema/rules).
  - Error count by category (triggering, reasoning, output format).

If available, encode assertions in an eval harness (for example, output schema checks, must-include fields, forbidden behaviors). Otherwise, use a manual scoring table with explicit pass/fail criteria.

## Step 6: Iterate Until Stable

For each failure:

1. Classify root cause: trigger gap, missing instruction, weak example, bad fallback, or missing resource.
2. Patch the minimal section of `SKILL.md` or bundled files.
3. Re-run targeted tests, then a short regression set.
4. Record what changed and why.

Repeat until results meet agreed success criteria.

## Step 7: Package and Deliver

Deliver:

1. Final `SKILL.md`.
2. Any bundled `scripts/`, `references/`, `assets/`.
3. A concise test report:
- Prompts tested.
- Quantitative results.
- Known limitations.
- Suggested next iteration (if any).

Provide install-ready paths and confirm the skill is self-contained.

## Output Template

When asked to generate a new skill, return:

1. `SKILL.md` content first.
2. Then bundled file contents grouped by path.
3. Then test cases and expected outcomes.

Ensure the result can be copied directly into a skill folder and run through an evaluation loop without extra interpretation.

