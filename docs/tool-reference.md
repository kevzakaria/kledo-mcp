# Tool reference

Kledo MCP exposes exactly three read-only, non-destructive, and idempotent tools.
Unsupported entity, filter, sort, field, include, or report combinations fail
before any upstream request. There is no raw request fallback.

## `kledo_query`

Lists or searches one allowlisted entity. Results are bounded and paginated
with an opaque cursor tied to the original query.

Important inputs include `entity`, optional `search`, bounded filters and sort
keys, optional selected fields, `pageSize` with a default of 20 and maximum of
100, and an opaque continuation `cursor`.

## `kledo_get`

Retrieves one normalized record by entity and numeric Kledo ID. Optional
`line_items` and `relation_ids` includes are bounded. Relationships are returned
only when already present in the detail response and are never followed
recursively.

For `sales_invoice`, the optional `invoice_payments` include returns bounded
child Invoice Payment transactions (`IP`, Kledo transaction type 17), including
payment date, amount, and destination bank account when supplied by Kledo. This
is direct payment-event history, not an authoritative settlement date. Credits
and non-IP child transaction types remain outside this include.

`invoicePaymentLimit` defaults to 50 and is capped at 200.

## `kledo_report`

Runs one allowlisted native Kledo financial or operational report. Accounting
statements come from Kledo's report endpoints and are not reconstructed from an
incomplete invoice page.

## Entity catalog

| Entity | Query | Detail |
| --- | :---: | :---: |
| Sales invoice | `sales_invoice` | Yes |
| Purchase invoice | `purchase_invoice` | Yes |
| Sales order | `sales_order` | Yes |
| Purchase order | `purchase_order` | Yes |
| Sales delivery | `sales_delivery` | Yes |
| Purchase delivery | `purchase_delivery` | Yes |
| Sales quote | `sales_quote` | Yes |
| Contact | `contact` | Yes |
| Product | `product` | Yes |
| Account | `account` | Yes |
| Bank transaction | `bank_transaction` | Yes |
| Expense | `expense` | Yes |
| Warehouse | `warehouse` | Yes |
| Unit | `unit` | No detail endpoint |

## Report catalog

- `executive_summary`
- `balance_sheet`
- `profit_loss`
- `cash_flow`
- `aged_receivable`
- `aged_payable`
- `bank_summary`
- `sales_by_period`
- `purchases_by_period`
- `sales_by_product`
- `income_by_customer`

## Example questions

The MCP client chooses a tool. Users do not need to know Kledo endpoint names.

| User question | Expected tool |
| --- | --- |
| "Show the latest 20 sales invoices." | `kledo_query` |
| "Find invoices for PT Maju Jaya." | `kledo_query` |
| "Show the line items for invoice ID 123." | `kledo_get` |
| "List direct payment events and destination accounts for invoice ID 123." | `kledo_get` with `invoice_payments` |
| "What is the aged receivable position as of today?" | `kledo_report` |
| "Compare sales this month with last month." | `kledo_report` |

Tool results include fetch time, completeness, warnings, pagination state, and
normalized values. The model should disclose truncation or incomplete pages
instead of presenting them as company totals.

## Current implementation status

Version `0.1.0` implements the complete catalog above:

- `kledo_query` routes all 14 entities through explicit GET paths, bounded
  pages, signed query-bound cursors where Kledo documents continuation,
  canonical filters, one sort key, and local field projection;
- `bank_transaction` queries require an explicit `bankAccountId` equality
  filter because Kledo requires `bank_account_id`;
- `product` and `unit` do not have a documented ordinary `page` parameter. If
  Kledo reports more data than the bounded response, the result is marked
  incomplete instead of inventing an unsupported continuation;
- `kledo_get` routes all 13 entities with detail GET endpoints. `unit` is absent
  from the detail schema because Kledo exposes no unit detail GET;
- transaction documents support bounded `line_items` and directly present
  `relation_ids` without recursive graph requests;
- sales invoice detail can include bounded, deduplicated `invoice_payments` from
  Kledo's child-transactions endpoint. Unexpected type, parent, account, or row
  shapes fail safely;
- `kledo_report` routes all 11 reports to native Kledo report endpoints;
- paginated reports return signed cursors and non-paginated statements are never
  reconstructed from transaction pages; and
- normalized records minimize contact PII and represent IDs and record-level
  money as decimal strings.

Native report payloads remain Kledo-shaped JSON because the public OpenAPI
document does not define their internal rows. See [architecture](architecture.md)
for normalization, framing, and failure behavior.
