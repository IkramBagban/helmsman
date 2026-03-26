---
name: dynamic-selection
description: Dynamic skill selection policy. Use this whenever prompts must stay concise while loading multiple domain skills based on current user intent.
---

# Dynamic Skill Selection

## Policy

1. Always load the core safety/truthfulness skill.
2. Load only the smallest set of domain skills needed for current intent.
3. Allow multiple skills when request spans domains.
4. Cap dynamic skills to avoid context bloat.
5. If skills conflict, apply strictest safety or approval rule.
