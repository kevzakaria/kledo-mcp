# Client setup

Build the project and configure credentials first:

```bash
npm ci
npm run setup
```

The examples below use Node's built-in env-file loader so the token stays out of
client configuration. Replace both absolute paths with paths on your machine.
For inherited variables or an external secret manager, use the equivalent
launch command described in [configuration](configuration.md).

## Hermes

Add the server to the private Hermes configuration:

```yaml
mcp_servers:
  kledo:
    command: "node"
    args:
      - "--env-file=/absolute/path/to/kledo-mcp/.env"
      - "/absolute/path/to/kledo-mcp/dist/bin/stdio.js"
    protocol: stateless
    trust: untrusted
    tools:
      include:
        - kledo_query
        - kledo_get
        - kledo_report
```

Run `hermes mcp test kledo` or reload MCP servers with `/reload-mcp`. Hermes
registers the tools as `mcp__kledo__kledo_query`, `mcp__kledo__kledo_get`, and
`mcp__kledo__kledo_report`.

## Codex

Codex CLI, the desktop app, and the IDE extension share one MCP configuration
on a machine. Add this to the private user configuration at
`~/.codex/config.toml`:

```toml
[mcp_servers.kledo]
command = "node"
args = [
  "--env-file=/absolute/path/to/kledo-mcp/.env",
  "/absolute/path/to/kledo-mcp/dist/bin/stdio.js"
]
enabled_tools = ["kledo_query", "kledo_get", "kledo_report"]
required = true
```

Restart the client. Run `codex mcp list` in the CLI or open `/mcp` in an
interactive Codex session to confirm discovery.

## Claude Desktop

Add this entry to the private Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "kledo": {
      "command": "node",
      "args": [
        "--env-file=/absolute/path/to/kledo-mcp/.env",
        "/absolute/path/to/kledo-mcp/dist/bin/stdio.js"
      ]
    }
  }
}
```

Restart Claude Desktop after changing its configuration.

## Cursor

Use the private user MCP configuration. Avoid placing real credentials in a
project-level `.cursor/mcp.json` that could be committed accidentally.

```json
{
  "mcpServers": {
    "kledo": {
      "command": "node",
      "args": [
        "--env-file=/absolute/path/to/kledo-mcp/.env",
        "/absolute/path/to/kledo-mcp/dist/bin/stdio.js"
      ]
    }
  }
}
```

## MCP Inspector

Create a private Inspector session file outside the repository:

```json
{
  "mcpServers": {
    "kledo": {
      "type": "stdio",
      "command": "node",
      "args": [
        "--env-file=/absolute/path/to/kledo-mcp/.env",
        "/absolute/path/to/kledo-mcp/dist/bin/stdio.js"
      ],
      "protocolEra": "modern"
    }
  }
}
```

Then run a strict schema check:

```bash
npx @modelcontextprotocol/inspector --cli \
  --config /absolute/path/to/private-inspector-session.json \
  --server kledo --method tools/list --strict --format json
```

The result should list exactly `kledo_get`, `kledo_query`, and `kledo_report`.
Listing tools does not call Kledo. Actual tool calls may read tenant data, so
use an authorized tenant and keep all output private.

For development, keep deterministic Vitest integration tests as the primary
debugging harness. They exercise the public MCP tool boundary against synthetic
HTTP fixtures and temporary SQLite databases. Use the
[official MCP Inspector](https://github.com/modelcontextprotocol/inspector) for
manual JSON-RPC discovery and tool-call traces.

To watch the salesperson identity-routing test step by step, run:

```bash
npm run test:trace
```

The trace shows the cold `/users` request, sanitized SQLite write, simulated MCP
restart, warm SQLite lookup, report request by `sales_id`, and the single-refresh
behavior for an unknown name. It uses only synthetic fixture data.

Persistent warm-up is optional. With a private `.env` configured, first set
`KLEDO_IDENTITY_CACHE=sqlite`, then run `npm run warmup` to fetch the authorized
tenant's sanitized master-reference catalogs before opening a client. The
command refuses to contact Kledo unless SQLite persistence is explicitly
enabled. It prints only stored counts by kind and the refresh timestamp; inspect
IDs locally with a read-only SQLite client when needed.

## Visual debugging with MCP Inspector

Launch the pinned official Inspector web UI:

```bash
npm run debug:mcp
```

The browser opens on `http://localhost:6274`. The bundled
[`mcp-inspector.json`](../mcp-inspector.json) offers two stdio targets:

- `kledo-fixture` runs immediately with synthetic users, report rows, and a
  temporary SQLite database;
- `kledo-live` loads `.env` locally and enables sanitized stderr diagnostics.

Start with `kledo-fixture`, connect, open **Tools**, select `kledo_report`, and
fill the visible form with the equivalent of:

```json
{
  "report": "sales_by_person",
  "period": { "from": "2026-07-01", "to": "2026-07-31" },
  "salesPersonName": "Fixture Seller",
  "pageSize": 20
}
```

The report form shows the shared fields for every report type. Only fill the
fields used by the selected report; the server still applies the original
strict report-specific validation before any upstream request.

The result panel shows the normalized MCP response. The server stderr panel
shows safe events such as `identity.sqlite.snapshot_miss`,
`identity.upstream.refresh`, `identity.sqlite.write`, and
`report.sales_by_person.request`.

To inspect complete Sales Order deal-intake aggregation, call the fixture with:

```json
{
  "report": "sales_order_kpi",
  "period": { "from": "2026-08-01", "to": "2026-08-31" },
  "salesPersonName": "Fixture Seller"
}
```

The result keeps Order Count, Ordered Quantity, before-tax and after-tax booked
values, and unbilled backlog separate. Its provenance shows the exact
`grand_subtotal` source fields. The equivalent two-page terminal trace is
`npm run test:trace:orders`.

To see the two-window dormancy analysis, keep `kledo-fixture` selected and call
the same tool with:

```json
{
  "report": "dormant_customers",
  "asOf": "2026-08-27",
  "inactiveDays": 90,
  "historyDays": 365,
  "pageSize": 20
}
```

The stderr panel shows separate sanitized historical and recent request events;
the result contains only synthetic follow-up candidates and explicit inference
warnings. The equivalent terminal trace is `npm run test:trace:dormant`.

For the exact-SKU product flow, run `npm run test:trace:price`. It prints the
synthetic route sequence from product resolution through catalog prices,
latest sold and purchased prices, Purchase Invoice date corroboration, and
period profitability. No production payload or credential is used.

To inspect customer, invoice, and project/reference receivables, call the
fixture with:

```json
{
  "report": "receivable_by_invoice",
  "asOf": "2026-08-27",
  "pageSize": 10
}
```

The stderr panel shows a sanitized customer-total request followed by bounded
invoice drill-down requests. The result maps API `memo` to
`projectReference`, records the Web UI label in `provenance`, and never returns
fixture contact email. The equivalent terminal trace is
`npm run test:trace:receivable`.

To inspect one complete synthetic Sales Invoice chain, select `kledo_get` and
call the fixture with:

```json
{
  "entity": "sales_invoice",
  "id": "500",
  "include": ["document_lineage", "payment_events"]
}
```

The result shows `QU -> SO -> DO -> INV` as typed documents and a joined `IP`
event. The stderr panel shows only the sanitized detail and payment-event
request stages. IDs must stay quoted strings in both the Inspector form and CLI.
The equivalent visible terminal trace is `npm run test:trace:lineage`.

To see the PDF path without using live accounting data, call the same fixture
with:

```json
{
  "entity": "sales_invoice",
  "id": "500",
  "include": ["print_document"]
}
```

Inspector shows safe PDF metadata in `structuredContent` and one embedded
`application/pdf` resource in `content`. Its stderr trace contains only the
detail and print-document stages; the opaque locator is absent. The equivalent
terminal trace is `npm run test:trace:print-document`.

For the purchase cycle, call the fixture with:

```json
{
  "entity": "purchase_invoice",
  "id": "700",
  "include": ["document_lineage", "payment_events"]
}
```

The result shows `PQ -> PO -> PD -> PI` and one joined `PP` event. Only the
Purchase Invoice detail request appears in stderr because Kledo embeds Purchase
Payment rows there; the verified API has no separate purchase-transactions
route. The equivalent terminal trace is
`npm run test:trace:purchase-lineage`.

Purchase Quote itself is available through the same public tools. In Inspector,
call `kledo_query` with `{"entity":"purchase_quote","pageSize":1}`, then use
`kledo_get` with `{"entity":"purchase_quote","id":"400"}` against the
fixture. Keep the ID quoted: Inspector otherwise parses it as a JSON number and
the MCP boundary correctly rejects it.

Use `kledo-live` only after `npm run setup` has created a private `.env`. Never
paste live credentials into the Inspector UI or commit them. Keep the Inspector
bound to local loopback and stop it when the debugging session is finished.

[MCPJam's local inspector](https://github.com/MCPJam/inspector) is useful later
for waterfall traces, saved scenarios, and comparing client or model behavior.
Its hosted inspector cannot launch a local stdio server, so use the local
package for this project. A model harness is intentionally not the first
debugging layer because protocol routing, upstream request counts, tenant
isolation, and persisted lookup behavior should be deterministic before model
evaluation begins.
