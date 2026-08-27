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
