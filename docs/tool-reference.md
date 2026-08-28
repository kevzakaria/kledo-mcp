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

For `sales_invoice` and `purchase_invoice`, `document_lineage` validates the
anchor transaction type, reads the authoritative typed `relations[]`, and
returns the ordered predecessors. Sales uses Sales Quote (4), Sales Order (6),
and Sales Delivery (7); purchases use Purchase Quote (63), Purchase Order (2),
and Purchase Delivery (8). It also checks that `parent_tran` names the same
typed immediate predecessor. It never infers a document type from lifecycle
position or numeric ordering. The `lineageLimit` defaults to 50 and is capped
at 200; truncation is explicit and sets `documentLineage.complete` to false.

The `payment_events` include joins typed payment relations, which carry the
document number, to compact transaction rows, which carry the event date,
amount, status, payment type, and destination bank account. Sales Invoice uses
Invoice Payment type 17 plus its dedicated child-transactions endpoint.
Purchase Invoice uses Purchase Payment type 16 embedded in the detail response;
the verified API has no Purchase Invoice child-transactions route. Missing or
conflicting halves fail safely rather than returning a partially joined event.
`paymentEventLimit` defaults to 50 and is capped at 200.

For `sales_invoice`, the optional `invoice_payments` include returns bounded
child Invoice Payment transactions (`IP`, Kledo transaction type 17), including
payment date, amount, and destination bank account when supplied by Kledo. This
is direct payment-event history, not an authoritative settlement date. Credits
and non-IP child transaction types remain outside this include.

`invoicePaymentLimit` defaults to 50 and is capped at 200. It remains as a
backward-compatible compact view; new lifecycle-aware callers should use
`document_lineage` and `payment_events`.

For `sales_invoice`, `print_document` first reads the typed invoice detail, keeps
Kledo's opaque `print_url` internal, and fetches only the allowlisted PDF route
on the configured origin. The standard server limits this download to 4 MiB and
30 seconds, rejects redirects, validates both `application/pdf` and `%PDF-`, and
never writes a persistent file. `structuredContent.printDocument` contains only
`resourceUri`, MIME type, byte count, and SHA-256. The base64 bytes occur once,
as an embedded MCP resource. Other document types, print variants, and outbound
email or messaging remain unsupported.

## `kledo_report`

Runs one allowlisted native Kledo financial or operational report, or one
explicitly validated semantic adapter. Accounting statements come from Kledo's
report endpoints and are not reconstructed from an incomplete invoice page.

Use `sales_by_person` for sales grouped by salesperson or filtered to one
salesperson. It calls Kledo's native `salesPerPerson` report, defaults to
`trans_date`, and uses `shipping_date` only when explicitly requested. A caller
may supply either `salesPersonId` or `salesPersonName`, never both. Exact name
resolution is trimmed and case-insensitive. It uses `/users` on a cold bounded
cache, retaining at most 1,000 sanitized ID/name pairs for five minutes by
default. Mappings remain memory-only unless the operator opts into
`KLEDO_IDENTITY_CACHE=sqlite`; only then are they persisted for reuse after a
process restart. The catalog never stores user email addresses, tokens, raw
responses, or transaction data. Kledo currently returns this report as a flat
array. The adapter validates and locally paginates that array, maps
`total_amount_after_tax` to sales money, exposes `total_count` as `salesCount`
rather than product quantity, and returns the reported commission as a separate
money value.

Use `sales_order_kpi` for Sales Order deal intake over an inclusive
transaction-date period, optionally filtered by exact salesperson ID or name.
It fixes transaction type to Sales Order (`6`) and the booked status set to
Open (`5`), Partially Shipped (`6`), and Closed (`7`). Waiting Approval and
Rejected orders are excluded.

The adapter consumes every `/finance/orders` page, validates every row remains
inside the requested type, status, date, and salesperson scope, and adds each
page's `grand_subtotal` with exact decimal arithmetic. It returns Order Count,
Ordered Quantity, Net Booked Order Value, Gross Booked Order Value, and Open
Order Backlog. The field-to-aggregate mapping and all-pages scope are explicit
in `provenance`. Booked values are order intake, not accounting revenue,
invoice value, receivable, or collected cash.

Use `income_by_customer` only when the grouping or ranking dimension is the
customer, even if the report is filtered by a salesperson. Use
`sales_by_period` only for day, month, or year time buckets. Salesperson totals
must not be reconstructed by crawling invoices.

Use `dormant_customers` for a bounded, read-only follow-up candidate list. The
adapter compares two complete pagesets from Kledo's native Income per Customer
report: a historical eligibility period and the following inactivity period
through `asOf`. `inactiveDays` defaults to 90, `historyDays` defaults to 365,
and `pageSize` defaults to 20. A candidate had observed historical income but
no observed income during the inactivity period. Results are ranked by
historical income and paginated locally with a signed cursor.

This is deliberately called dormancy rather than churn. The source does not
provide an exact last-transaction date, active/archive status, outreach
consent, or evidence that the relationship ended. Those facts must be reviewed
before a human follows up. Contacts whose only activity predates the bounded
historical period are outside the analysis, not classified as dormant.

Use `receivable_by_invoice` when the answer needs the customer, invoice number,
and project/reference behind each outstanding receivable. It first reads
Kledo's native Aged Receivable customer page, then fully consumes the
`agedReceivableDetail` pages for every customer returned on that page. The
adapter validates customer identity and customer totals across both sources.

`asOf` is required. `pageSize` controls customers, defaults to 10, and is capped
at 20 because every customer has a bounded detail fan-out. Follow
`pageInfo.nextCursor` before presenting a company-wide list. Filters such as
warehouse or salesperson are intentionally unsupported because the upstream
summary-to-detail report contract does not preserve them.

Each invoice returns `invoiceNumber`, dates, invoice amount, outstanding amount,
and `projectReference`. The latter is sourced from the upstream API `memo`.
Source families and this field mapping are explicit in `provenance`. Contact
email, phone, address, tax ID, and raw contact payloads are never returned.

Use `item_price_analysis` for one product's pricing and gross-margin facts. It
requires an explicit `period` plus exactly one of `productCode` or
`productName`. Product code is matched exactly and case-insensitively. A name
may be used only when Kledo resolves it to one safe product; multiple name
matches fail with `AMBIGUOUS` and the caller must retry with the exact SKU.

The result deliberately separates configured catalog sale/base-purchase prices
and average inventory cost from latest sold/purchased transaction prices and
from period profitability. The purchase date is returned only when the latest
purchase price is corroborated by the newest Purchase Invoice product rows.
Profitability includes period sales, HPP, gross profit, gross margin, average
sale price, and average HPP. `profitabilityMethod` defaults to `inventory`; set
`non_inventory` or `package` explicitly for those Kledo calculation modes. The
six source endpoint families are named in `provenance` so an answer remains
inspectable.

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
| Purchase quote | `purchase_quote` | Yes |
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
- `receivable_by_invoice`
- `aged_payable`
- `bank_summary`
- `sales_by_period`
- `sales_by_person`
- `sales_order_kpi`
- `purchases_by_period`
- `sales_by_product`
- `income_by_customer`
- `dormant_customers`
- `item_price_analysis`

## Example questions

The MCP client chooses a tool. Users do not need to know Kledo endpoint names.

| User question | Expected tool |
| --- | --- |
| "Show the latest 20 sales invoices." | `kledo_query` |
| "Find invoices for PT Maju Jaya." | `kledo_query` |
| "Show the line items for invoice ID 123." | `kledo_get` |
| "List direct payment events and destination accounts for invoice ID 123." | `kledo_get` with `invoice_payments` |
| "Trace invoice ID 123 back through its quote, order, delivery, and payments." | `kledo_get` with `document_lineage` and `payment_events` |
| "Trace purchase invoice ID 456 back through its quote, order, delivery, and payment." | `kledo_get` with `document_lineage` and `payment_events` |
| "Give me the printable PDF for Sales Invoice ID 123." | `kledo_get` with `print_document` |
| "What is the aged receivable position as of today?" | `kledo_report` |
| "Which customers owe us, which invoices, and what project is each invoice for?" | `kledo_report` with `receivable_by_invoice` |
| "Compare sales this month with last month." | `kledo_report` |
| "How much did a salesperson sell in July?" | `kledo_report` with `sales_by_person` |
| "How many deals did a salesperson book in August, and what was their value?" | `kledo_report` with `sales_order_kpi` |
| "Which customers bought the most from a salesperson?" | `kledo_report` with `income_by_customer` |
| "Which old customers should we review for follow-up?" | `kledo_report` with `dormant_customers` |
| "What are the catalog, latest sold, latest purchased, and period-margin values for exact SKU PAINT-001?" | `kledo_report` with `item_price_analysis` |

Tool results include fetch time, completeness, warnings, pagination state, and
normalized values. The model should disclose truncation or incomplete pages
instead of presenting them as company totals.

## Current implementation status

Version `0.1.0` implements the complete catalog above:

- `kledo_query` routes all 15 entities through explicit GET paths, bounded
  pages, signed query-bound cursors where Kledo documents continuation,
  canonical filters, one sort key, and local field projection;
- `bank_transaction` queries require an explicit `bankAccountId` equality
  filter because Kledo requires `bank_account_id`;
- `product` and `unit` do not have a documented ordinary `page` parameter. If
  Kledo reports more data than the bounded response, the result is marked
  incomplete instead of inventing an unsupported continuation;
- `kledo_get` routes all 14 entities with detail GET endpoints. `unit` is absent
  from the detail schema because Kledo exposes no unit detail GET;
- transaction documents support bounded `line_items` and directly present
  `relation_ids` without recursive graph requests;
- sales and purchase invoice detail can include bounded typed QU -> SO -> DO or
  PQ -> PO -> PD predecessor chains plus joined Invoice or Purchase Payment
  events. The adapter reconciles `relations[]`, `parent_tran`, and the available
  transaction source; unexpected type, parent, relation, account, or row shapes
  fail safely. The legacy bounded `invoice_payments` view remains available for
  Sales Invoice only;
- Sales Invoice can opt into one bounded embedded PDF resource with safe
  metadata; the opaque upstream print locator is never returned or logged;
- `kledo_report` routes 12 native reports plus the `sales_order_kpi`,
  `dormant_customers`, `receivable_by_invoice`, and `item_price_analysis`
  semantic adapters;
- paginated reports return signed cursors and non-paginated statements are never
  reconstructed from transaction pages; and
- normalized records minimize contact PII and represent IDs and record-level
  money as decimal strings.

Most native report payloads remain Kledo-shaped JSON because the public OpenAPI
document does not define their internal rows. `sales_by_person`,
`sales_order_kpi`, `dormant_customers`, `receivable_by_invoice`, and `item_price_analysis` are
strictly validated adapters.
The dormancy adapter fully consumes two bounded `incomePerCustomer` windows,
subtracts recent customer IDs from the historical set, and returns normalized
candidates without inventing a last purchase date. The receivable adapter joins
native customer totals to fully consumed invoice drill-down pages while keeping
pagination visible. The item adapter resolves a single product before fetching
its distinct price and profitability sources. See
[architecture](architecture.md) for normalization, framing, and failure
behavior.
