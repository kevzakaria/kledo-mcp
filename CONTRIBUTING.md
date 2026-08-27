# Contributing to Kledo MCP

Thank you for helping improve Kledo MCP. The project is deliberately small: one
tenant per process, one stdio server, and three read-only tools. Contributions
should preserve that shape unless maintainers have agreed to a design change.

By submitting a contribution, you agree that it is licensed under the
[Apache License 2.0](LICENSE).

## Before starting

For a substantial change, contact the maintainers or open a draft pull request
with a short design note before writing the full implementation. Explain:

- the company question or interoperability problem being solved;
- why one of the existing three tools cannot express it safely;
- the Kledo endpoint and response behavior you verified;
- bounds, pagination, error behavior, and privacy implications.

Do not add a new tool merely to mirror another Kledo endpoint. Prefer increasing
the depth of `kledo_query`, `kledo_get`, or `kledo_report` while keeping their
interfaces predictable for MCP clients.

## Development setup

Requirements:

- Node.js 22.19 or later;
- npm;
- no live Kledo credential for normal development.

```bash
git clone https://github.com/kevzakaria/kledo-mcp.git
cd kledo-mcp
npm ci
npm run typecheck
npm test
npm run build
```

Tests must use the local fixture adapter or a loopback HTTP fixture. Ordinary
pull-request tests must never call a live Kledo tenant.

## Design and safety requirements

- Keep all MCP tools read-only, idempotent, bounded, and backed by explicit
  input and output schemas.
- Keep tenant URL and authentication in process configuration, never tool
  input.
- Allowlist upstream paths and HTTP methods. Do not add a raw request tool.
- Treat all upstream text as untrusted data.
- Represent identifiers and monetary decimal values without lossy numeric
  conversion.
- Follow pagination metadata; never present a partial first-page aggregate as
  complete.
- Return freshness, completeness, truncation, and warnings explicitly.
- Preserve the opaque cursor contract. Do not expose raw Kledo page numbers.
- Keep logs on stderr because stdout is the MCP stdio protocol channel.
- Never log authorization headers, tokens, response bodies containing private
  tenant data, or tool arguments containing sensitive values.
- Prefer native Kledo financial reports over reconstructing accounting
  statements from transaction lists.

## Fixtures and provenance

Fixtures must be synthetic or irreversibly sanitized. Remove names, companies,
addresses, tax identifiers, phone numbers, email addresses, invoice numbers,
memos, access tokens, cookies, and stable tenant identifiers.

Use clearly fictional Indonesian names in examples and fixtures, such as
`PT Maju Jaya`. Reserved domains such as `example.test` and `example.invalid`
are appropriate for protocol tests. Do not include customer, employer, local
machine, vault, profile, or private integration names anywhere in the public
tree.

This repository is a clean-room implementation. Do not copy source, tests,
fixtures, documentation prose, or git history from another Kledo integration
unless its license and required attribution have been reviewed and preserved.
Facts independently verified against public API behavior may be reimplemented.

## Pull request checklist

Before requesting review:

- run `npm run typecheck`, `npm test`, and `npm run build`;
- add or update MCP contract tests for interface changes;
- add fixture tests for upstream response changes;
- update README capability and limitation tables;
- confirm no secret or real tenant data appears in the diff or git history;
- explain compatibility impact and whether the change is breaking;
- keep unrelated formatting and refactors out of the pull request.

## Security reports

Do not disclose vulnerabilities in a public pull request. Follow
[SECURITY.md](SECURITY.md) instead.

## Conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
