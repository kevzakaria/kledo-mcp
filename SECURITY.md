# Security policy

## Supported versions

Kledo MCP is currently a `0.x` preview. Before the first package release,
security fixes are applied on `main`. After publication, fixes are applied to
the latest published minor release only.

| Version | Supported |
| --- | --- |
| `main` before the first release | Yes |
| Latest published `0.1.x` | Yes |
| Older versions | No |

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub Security
Advisories](https://github.com/kevzakaria/kledo-mcp/security/advisories/new).
Do not open a public issue or discussion for a vulnerability.

Include enough information to reproduce and assess the problem:

- affected version and operating system;
- MCP client and transport;
- expected and observed behavior;
- minimal reproduction steps or proof of concept;
- possible impact and any known mitigations.

Remove Kledo access tokens, tenant data, customer information, invoice details,
cookies, and other credentials from the report. If a token may have been
exposed, revoke or rotate it before sending the report.

The maintainers will acknowledge the report privately, investigate it, and
coordinate disclosure and remediation with the reporter. Please allow a fix to
be prepared before publishing details.

## Security model

Kledo MCP is a local, stdio-first, read-only adapter. Its security model assumes:

- one server process represents exactly one Kledo tenant;
- `KLEDO_API_BASE_URL` and `KLEDO_API_TOKEN` are trusted operator
  configuration, not model-controlled input;
- the configured token is sent only to the operator-configured HTTPS origin,
  at a base path ending in `/api/v1/`;
- MCP callers cannot select a tenant, URL, credential, or arbitrary upstream
  path;
- the server exposes allowlisted GET operations only and does not create,
  update, delete, send, export, or upload Kledo data;
- Kledo contact names, memos, product text, and other returned strings are
  untrusted data and must not be treated as instructions.

Read-only access can still expose commercially sensitive and personal data.
Use the least-privileged Kledo credential available, restrict access to the MCP
host, and do not run this server for users who should not see the configured
tenant.

## Secret handling

- Inject the token through the MCP client's environment configuration.
- Never pass the token as a command-line argument or MCP tool argument.
- Never commit tokens, `.env` files, host configuration containing tokens, or
  real Kledo responses.
- Keep client configuration files private to the local operating-system user.
- Do not paste server logs into public reports without reviewing them for
  tenant data.
- Rotate the Kledo token after suspected exposure.

See [README.md](README.md) for safe configuration examples.
