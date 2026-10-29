# ADR 0005: Containerization Strategy

- Status: Accepted
- Date: 2026-03-31

## Context

Local development should be reproducible and close to cloud runtime characteristics. Teams will have heterogeneous local environments.

## Decision

Use Dockerfiles per service and Docker Compose for local orchestration.

## Consequences

Positive:

- Consistent runtime behavior across developer machines.
- Clear path to ECS task definitions from existing container images.
- Simplifies onboarding for contributors.

Trade-offs:

- Slightly slower feedback loops than host-native tooling.
- Additional complexity in local networking and volume management.
