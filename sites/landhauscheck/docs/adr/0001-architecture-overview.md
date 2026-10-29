# ADR 0001: System Architecture Overview

- Status: Accepted
- Date: 2026-03-31

## Context

The project needs a maintainable local development setup with a clear path to AWS deployment. Early decisions should reduce migration friction and avoid local-only assumptions.

## Decision

Adopt a split architecture with:

- Frontend application in `sites/landhauscheck/frontend`
- Backend API in `sites/landhauscheck`
- Infrastructure definitions in `infra/`
- Decision records in `docs/adr`

This creates clear boundaries between product code and deployment concerns.

## Consequences

Positive:

- Teams can evolve frontend, backend, and infrastructure independently.
- Repository structure aligns with common cloud deployment workflows.
- Future AWS IaC can be added without relocating application code.

Trade-offs:

- Requires explicit interfaces and coordination across app boundaries.
- Adds initial setup overhead compared with a single-process monolith.
