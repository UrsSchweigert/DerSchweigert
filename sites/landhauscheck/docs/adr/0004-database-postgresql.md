# ADR 0004: Primary Database Selection

- Status: Accepted
- Date: 2026-03-31

## Context

The solution is expected to migrate to AWS and should avoid a large persistence mismatch between local and cloud environments.

## Decision

Use PostgreSQL as the primary relational database (introduced in Step 2).

## Consequences

Positive:

- Reduces migration risk because AWS target is RDS PostgreSQL.
- Mature ecosystem and operational reliability.
- Supports transactional consistency and complex querying patterns.

Trade-offs:

- More operational overhead than file-based databases.
- Requires local containerized service or host installation for development.
