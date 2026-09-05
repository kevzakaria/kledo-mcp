# Changelog

All notable user-facing changes to Kledo MCP are documented in this file.

The project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Pull-request
labels collect release candidates, while the release pull request owns the
curated wording below.

## [Unreleased]

Nothing yet.

## [0.3.0] - 2026-09-05

### Added

- Added the normalized `salesPerson` and sanitized `tags` fields to Sales
  Order query and detail records, with projection support, matching the Sales
  Invoice contract ([#16](https://github.com/kevzakaria/kledo-mcp/pull/16)).

## [0.2.0] - 2026-09-03

### Added

- Added an optional tenant-scoped SQLite identity catalog with an explicit
  warm-up command. Memory-only identity resolution remains the default, and
  the persistent catalog stores sanitized reference data only
  ([#4](https://github.com/kevzakaria/kledo-mcp/pull/4)).
- Added source-transparent semantic reports for salesperson sales, Sales Order
  intake, dormant-customer candidates, invoice-level receivables, and item
  price analysis without expanding the three-tool public surface
  ([#5](https://github.com/kevzakaria/kledo-mcp/pull/5)).
- Added typed sales and purchase document lineage for
  `QU -> SO -> DO -> INV -> IP` and `PQ -> PO -> PD -> PI -> PP`, including
  bounded invoice payment events and Purchase Quote routing
  ([#6](https://github.com/kevzakaria/kledo-mcp/pull/6)).
- Added bounded Sales Invoice PDF retrieval and a sanitized MCP Inspector
  workflow for observing tool calls without exposing tenant data
  ([#7](https://github.com/kevzakaria/kledo-mcp/pull/7)).
- Added exact, bounded Document Number lookup to `kledo_get` for eight
  commercial document types while retaining numeric IDs as an internal fast
  path ([#9](https://github.com/kevzakaria/kledo-mcp/pull/9)).
- Added a normalized `salesPerson` and sanitized `tags` to Sales Invoice query
  and detail records, plus a `salesPersonId` filter and field projection for
  both ([#12](https://github.com/kevzakaria/kledo-mcp/pull/12)).

### Changed

- Made public schemas, responses, diagnostics, and documentation independent
  of any particular AI model, browser workflow, or maintainer-only validation
  harness. Added architecture, sequence, responsibility, and lifecycle
  diagrams for the stable public behavior
  ([#8](https://github.com/kevzakaria/kledo-mcp/pull/8),
  [#9](https://github.com/kevzakaria/kledo-mcp/pull/9)).

## [0.1.0-rc.1] - 2026-08-27

### Added

- Published the first preview of the local stdio server with exactly three
  bounded read-only tools: `kledo_query`, `kledo_get`, and `kledo_report`.
- Added normalized invoice-payment child transactions while keeping the public
  server read-only.
- Added guided local setup, client configuration documentation, package
  verification, and a guarded GitHub and npm release workflow
  ([#1](https://github.com/kevzakaria/kledo-mcp/pull/1),
  [#2](https://github.com/kevzakaria/kledo-mcp/pull/2)).

[Unreleased]: https://github.com/kevzakaria/kledo-mcp/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/kevzakaria/kledo-mcp/releases/tag/v0.3.0
[0.2.0]: https://github.com/kevzakaria/kledo-mcp/releases/tag/v0.2.0
[0.1.0-rc.1]: https://github.com/kevzakaria/kledo-mcp/releases/tag/v0.1.0-rc.1
