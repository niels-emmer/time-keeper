---
name: delivery-validation
description: Validation guidance for Time Keeper changes. Use when selecting checks, running builds/tests, or reporting verification.
---

# Delivery Validation

Load this file when you need to verify local changes or choose the smallest credible validation set.

## Default checks
- `yarn workspace @time-keeper/shared test`
- `yarn workspace @time-keeper/backend test`
- `yarn workspace @time-keeper/frontend test`
- `yarn workspace @time-keeper/backend build`
- `yarn workspace @time-keeper/frontend build`

## Guidance
- Run the narrowest checks that credibly verify the changed surface.
- If architecture, shared logic, or cross-package contracts changed, expand to broader verification.
- Report what you ran, what passed, and what was intentionally not run.
