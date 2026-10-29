# ADR 0006: Configuration and Secrets Management

- Status: Accepted
- Date: 2026-03-31

## Context

Local and cloud environments require different values for endpoints, credentials, and operational flags. Hardcoded secrets are unsafe and hard to rotate.

## Decision

Use environment variables for runtime configuration. In AWS, adopt Secrets Manager and Parameter Store for secret and configuration delivery.

## Consequences

Positive:

- Keeps source code free from environment-specific secrets.
- Improves portability across local, test, and cloud environments.
- Aligns with containerized deployment best practices.

Trade-offs:

- Requires disciplined documentation of required variables.
- Misconfigured environments can fail at runtime if validation is weak.
