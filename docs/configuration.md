# Configuration

Kledo MCP reads configuration only from its process environment. It has no
runtime dependency on 1Password, dotenv, or another secret manager.

## Requirements

- Node.js 22.19 or later
- npm
- a Kledo API base URL
- a Kledo Open API bearer token for the tenant you intend to query

The MCP interface is read-only, but the upstream bearer token may still expose
sensitive accounting and contact data. Use a dedicated token with the shortest
practical expiry and access scope available in Kledo.

## Setup wizard

From a source checkout:

```bash
npm ci
npm run setup
```

The repeatable Bash wizard lives at [`scripts/setup.sh`](../scripts/setup.sh).
It is designed for macOS, Linux, and WSL. Set `ENV_FILE` if the local env file
should live somewhere other than the repository root:

```bash
ENV_FILE=/private/path/kledo.env npm run setup
```

The wizard performs three stages:

| Stage | Action | Output |
| --- | --- | --- |
| Project preflight | Checks Node and npm, installs dependencies if approved, then builds | `dist/` |
| Kledo Open API credentials | Opens Kledo, validates the API root, and accepts the token with hidden input | private env file |
| Validate and connect | Runs the same configuration validation used by the production server | sanitized success or failure |

The wizard never calls a Kledo data endpoint and never writes a GitHub Actions
secret. Persistent identity storage remains disabled unless the operator opts
in after setup. The wizard prints the optional SQLite setting and warm-up
command after local validation. CI uses synthetic fixtures and does not need a
production credential.

## Finding the Kledo values

Kledo's published integration journey is:

1. open the intended tenant's
   [Settings > Integration > Open API](https://app.kledo.com/#/settings/apps?activeKey=6)
   page and sign in if prompted;
2. confirm that the intended tenant is active;
3. use the API hostname shown by the API documentation link;
4. configure the root as `https://<your-kledo-api-host>/api/v1/`; and
5. create or copy the Open API token.

Do not enter a Kledo account password into this project. The wizard asks only
for the generated bearer token.

## Environment variables

| Variable | Required | Description |
| --- | :---: | --- |
| `KLEDO_API_BASE_URL` | Yes | Absolute HTTPS URL ending at the tenant API v1 root |
| `KLEDO_API_TOKEN` | Yes | Kledo bearer token; a leading `Bearer ` prefix is accepted and normalized |
| `KLEDO_IDENTITY_CACHE` | No | `memory` by default; set to `sqlite` to opt into persistent identity storage |
| `KLEDO_STATE_DIR` | No | Absolute private SQLite directory; valid only when `KLEDO_IDENTITY_CACHE=sqlite` |

The base URL must:

- use HTTPS;
- end at `/api/v1/`;
- contain no embedded credentials;
- contain no query string or fragment; and
- come from the human operator, never from an AI tool call or Kledo record.

The server sends the bearer token only to the configured origin. Redirects to a
different origin are rejected.

## Optional local identity catalog

The server keeps identity mappings in process memory by default and does not
write them to disk. When the operator explicitly sets
`KLEDO_IDENTITY_CACHE=sqlite`, sanitized Kledo master-reference mappings are
persisted in `identity-catalog.sqlite`. This lets a new MCP process resolve an exact
salesperson name to its Kledo ID without reloading `/users` while the snapshot
is fresh. Other kinds are prefetched for future ID-based routing but are not
exposed through another public MCP tool.

| Catalog kind | Read-only source |
| --- | --- |
| `salesperson` | `/users` |
| `contact`, `customer`, `vendor`, `employee`, `investor`, `other_contact` | paginated `/finance/contacts`, split by `type_ids` 1 through 5 |
| `contact_type` | Kledo contact types 1 Vendor, 2 Employee, 3 Customer, 4 Other, 5 Investor |
| `contact_group` | `/finance/contactGroups` |
| `product` | paginated `/finance/products` |
| `product_category` | `/finance/productCategories`, including nested children |
| `warehouse` | `/finance/warehouses` |
| `unit` | paginated `/finance/units` |
| `account` | paginated `/finance/accounts` |

When SQLite is enabled, the default directory is:

- `~/Library/Application Support/kledo-mcp` on macOS;
- `$XDG_STATE_HOME/kledo-mcp` when `XDG_STATE_HOME` is set; or
- `~/.local/state/kledo-mcp` on other supported systems.

Set `KLEDO_STATE_DIR` to an absolute private directory to override the default.
Providing `KLEDO_STATE_DIR` without `KLEDO_IDENTITY_CACHE=sqlite` is rejected so
the server never appears to persist data without explicit opt-in.
The database stores only a pseudonymous tenant scope, entity type, external ID,
display name, normalized name, active flag, and refresh timestamps. It does not
store the bearer token, email address, phone number, address, tax data, raw
Kledo response, or transaction data.

Tenant scope is derived one-way from the configured API origin and token. A
token rotation therefore causes a safe cold refresh instead of reusing an old
credential scope. If SQLite is unavailable, name resolution falls back to the
live `/users` endpoint and the tool result includes a sanitized warning.

To opt in, add this setting to the private `.env` file:

```env
KLEDO_IDENTITY_CACHE=sqlite
```

Then populate or refresh the catalog explicitly:

```bash
npm run warmup
```

The command validates every source above and atomically replaces all
tenant-scoped snapshots. Its output is limited to stored record counts by kind
and the refresh timestamp. It does not expose a fourth MCP tool and does not
print names, IDs, URLs, credentials, or raw Kledo data.

Transaction/document IDs are intentionally excluded. Transaction-specific
status IDs, finance-account categories, and bank-transaction type IDs also stay
unmapped until a stable read-only label source is validated; warm-up does not
scan accounting transactions to infer reference data.

## Manual local setup

Copy the placeholder file, fill it only on your machine, then lock its
permissions:

```bash
cp .env.example .env
chmod 600 .env
npm run build
npm run config:check
```

The copied example defaults to memory-only operation. If persistent lookup is
desired, set `KLEDO_IDENTITY_CACHE=sqlite` and then run `npm run warmup`.

The tracked [`.env.example`](../.env.example) contains placeholders only. Local
`.env` files are gitignored. Creating one does not make the server parse it
automatically. Use Node's env-file loader when launching:

```bash
node --env-file=/absolute/path/to/kledo-mcp/.env \
  /absolute/path/to/kledo-mcp/dist/bin/stdio.js
```

The process then waits for MCP JSON-RPC on stdin. It is normally launched by an
MCP client rather than used as an interactive command.

## Other secret managers

The server is intentionally secret-manager agnostic. Any mechanism is valid if
it injects the same two environment variables into the server process:

```text
shell export / MCP client env / env-file loader / secret-manager exec
                              |
                              v
                  KLEDO_API_BASE_URL + KLEDO_API_TOKEN
                              |
                              v
                         kledo-mcp
```

Supported patterns include:

- export both variables in the shell or service manager launching the MCP;
- let the MCP client inherit the two named variables;
- use Node's built-in `--env-file` option with a private file;
- use a secret manager's `run` or `exec` command; or
- provide an `ENV_FILE` path managed outside the repository when running the
  wizard.

Never place a token in a command-line argument, committed client configuration,
chat message, issue, log, or shell history.

## Multiple tenants

Run a separate server process and credential scope for each tenant:

```text
kledo_maju_jaya   -> process A -> tenant A URL and token
kledo_sinar_abadi -> process B -> tenant B URL and token
```

There is intentionally no tenant selector in any MCP tool. See
[client setup](client-setup.md) for registration examples. When SQLite is
explicitly enabled, separate processes may share the default database because
every identity row is isolated by its pseudonymous tenant scope.
