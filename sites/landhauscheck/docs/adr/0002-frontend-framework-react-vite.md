# ADR 0002: Frontend Framework Selection

- Status: Accepted
- Date: 2026-03-31

## Context

The frontend should be easy to run locally, well-supported by tooling, and straightforward to package for static hosting on AWS.

## Decision

Use React with Vite for the frontend application.

## Consequences

Positive:

- Fast local startup and iterative development.
- Large ecosystem and maintainable component model.
- Build artifacts can be deployed to S3 + CloudFront with minimal adaptation.

Trade-offs:

- Introduces Node toolchain management.
- Requires bundling and environment variable management for API base URLs.
