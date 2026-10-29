# ADR 0003: Backend Framework Selection

- Status: Accepted
- Date: 2026-03-31

## Context

The backend should provide clear API contracts, built-in validation, good documentation support, and compatibility with containerized AWS runtimes.

## Decision

Use FastAPI served by Uvicorn.

## Consequences

Positive:

- Clear request and response modeling.
- Good developer experience and automatic API docs generation.
- Container-friendly deployment model for ECS Fargate.

Trade-offs:

- Requires Python dependency/version management discipline.
- Async programming model introduces learning overhead for some contributors.
