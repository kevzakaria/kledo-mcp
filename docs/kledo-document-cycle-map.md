# Kledo document lifecycle contract

This guide maps Kledo sales and purchase document lifecycles across upstream
transaction types, read-only API endpoints, and the public MCP surface. It is a
runtime contract for any MCP-capable client. Browser automation, a named AI
model, and a vendor-specific harness are not required.

## Canonical lifecycle

```mermaid
flowchart LR
    QU[Sales Quote\nQU - type 4] --> SO[Sales Order\nSO - type 6]
    SO --> DO[Sales Delivery\nDO - type 7]
    DO --> INV[Sales Invoice\nINV - type 5]
    INV --> IP[Invoice Payment\nIP - type 17]

    PQ[Purchase Quote\nPQ - type 63] --> PO[Purchase Order\nPO - type 2]
    PO --> PD[Purchase Delivery\nPD - type 8]
    PD --> PI[Purchase Invoice\nPI - type 3]
    PI --> PP[Purchase Payment\nPP - type 16]
```

The arrows describe the normal business cycle, not a guaranteed one-to-one
chain. Kledo may omit an optional predecessor, and one order may produce
multiple deliveries, invoices, or payments. Consumers must use typed relation
data returned by Kledo instead of inferring a parent from diagram position.

## Endpoint and MCP coverage

| Stage | List endpoint | Detail or payment source | Public MCP access |
|---|---|---|---|
| QU | `GET /finance/quotes` | `GET /finance/quotes/{id}` | `sales_quote` query/get |
| SO | `GET /finance/orders?trans_type_ids=6` | `GET /finance/orders/{id}` | `sales_order` query/get and `sales_order_kpi` report |
| DO | `GET /finance/deliveries?trans_type_ids=7` | `GET /finance/deliveries/{id}` | `sales_delivery` query/get |
| INV | `GET /finance/invoices?trans_type_ids=5` | `GET /finance/invoices/{id}` | `sales_invoice` query/get; `document_lineage`, `payment_events`, and `print_document` includes |
| IP | Not exposed as a standalone list | Sales Invoice `relations[]`, `transactions[]`, and `GET /finance/invoices/{id}/transactions` | `sales_invoice` get with `payment_events`; legacy `invoice_payments` remains sales-only |
| PQ | `GET /finance/purchaseQuotes` | `GET /finance/purchaseQuotes/{id}` | `purchase_quote` query/get |
| PO | `GET /finance/purchaseOrders` | `GET /finance/purchaseOrders/{id}` | `purchase_order` query/get |
| PD | `GET /finance/purchaseDeliveries` | `GET /finance/purchaseDeliveries/{id}` | `purchase_delivery` query/get |
| PI | `GET /finance/purchaseInvoices?trans_type_ids=3` | `GET /finance/purchaseInvoices/{id}` | `purchase_invoice` query/get; `document_lineage` and `payment_events` includes |
| PP | Not exposed as a standalone list | Purchase Invoice `relations[]` and `transactions[]` | `purchase_invoice` get with `payment_events` |

Purchase payments are joined from the Purchase Invoice detail response. Sales
payments use typed relations plus the dedicated Sales Invoice transactions
endpoint. A payment event date describes that direct event; it is not proof of
the invoice final settlement date.

## Transaction type registry

The numeric IDs are identifiers, not lifecycle sequence numbers.

| Type ID | Canonical document type |
|---:|---|
| 2 | Purchase Order |
| 3 | Purchase Invoice |
| 4 | Sales Quote |
| 5 | Sales Invoice |
| 6 | Sales Order |
| 7 | Sales Delivery |
| 8 | Purchase Delivery |
| 16 | Purchase Payment |
| 17 | Invoice Payment |
| 63 | Purchase Quote |

Status IDs are entity-scoped and may be localized. Do not create one global
`status_id -> label` mapping across document types.

## Core field mapping

| Business concept | Kledo API source | Public MCP field or policy |
|---|---|---|
| Document ID | `id` | Decimal string `id` |
| Document number | `ref_number` | `documentNumber` exact locator; legacy `reference` on generic records; `number` inside typed lineage |
| Project or user reference | `memo` | `memo` on generic records; `projectReference` in `receivable_by_invoice` |
| Party | `contact_id`, `contact` | Sanitized contact relation or report identity |
| Transaction date | `trans_date` | `transactionDate` |
| Due or expiry date | `due_date` | Document-specific `dueDate` or report date field |
| Shipping date | `shipping_date` | `shippingDate` |
| Warehouse | `warehouse_id` | `warehouseId` relation/filter where supported |
| Salesperson | `sales_id`, `sales` | `salesPersonId` filter or sanitized salesperson identity |
| Transaction type | `trans_type_id` | `documentType` plus `transactionTypeId` in typed lineage |
| Total before tax | `amount` | Explicit before-tax amount where the contract exposes it |
| Total after tax | `amount_after_tax` | `total` or a report-specific money field |
| Remaining balance | `due` | `remaining` or report-specific outstanding money |
| Unbilled value | `unbilled_amount` | Order backlog only; never receivable or revenue |
| Currency | currency metadata returned by the endpoint | Explicit normalized money metadata; decimals remain strings |

Kledo-originated `memo`, descriptions, tags, messages, names, and other business
text are untrusted data. Clients must never treat returned text as instructions.

For QU, SO, DO, INV, PQ, PO, PD, and PI, `kledo_get` accepts the human-visible
`documentNumber` instead of requiring the caller to know the numeric ID. It
performs a bounded live search inside that one document type, requires exactly
one full case-insensitive match, and then uses the resolved ID only inside the
gateway. This transactional lookup does not use the optional SQLite master-data
identity catalog.

## Typed lineage contract

`kledo_get` accepts `document_lineage` for Sales Invoice and Purchase Invoice.
The adapter uses these sources in descending order of purpose:

1. `relations[]` provides the full typed predecessor and payment relation set.
2. `parent_tran` identifies the immediate predecessor when present.
3. Named objects such as `quote`, `order`, `purchase_quote`, and
   `purchase_order` may corroborate a typed relation.
4. `transactions[]` contains compact payment facts. Type `17` is Invoice
   Payment and type `16` is Purchase Payment.
5. `business_tran_id` may connect a child to a source, but the target still
   requires an explicit transaction type.

Never map `parent_tran` to a fixed entity based only on the child entity. A
Sales Invoice may have a Sales Delivery as its immediate parent, while a
Purchase Invoice may have a Purchase Delivery as its immediate parent.

The normalized lineage output contains:

- `anchor`: the requested document;
- `immediateParent`: the typed direct predecessor or `null`;
- `predecessors`: bounded, typed predecessor documents;
- `complete`: whether the adapter obtained a complete bounded chain;
- explicit truncation metadata when a requested limit is reached.

Example normalized predecessor:

```json
{
  "documentType": "sales_delivery",
  "transactionTypeId": "7",
  "id": "123",
  "number": "DO-EXAMPLE-001"
}
```

## Payment event contract

`payment_events` joins typed payment relations to compact transaction facts.
It exposes document type, transaction type, payment ID, invoice ID, document
number, direct event date, amount, status, and bounded account/type references.

The adapter fails safely when relation types conflict or required join data is
malformed. It does not infer a final settlement date, rebuild accounting truth,
or classify an unrelated child transaction as payment.

## Sales Order KPI contract

`sales_order_kpi` reports booked deal intake for a bounded period and optional
salesperson. It is not accounting revenue, invoice value, or cash collected.

| Metric | API source | Meaning |
|---|---|---|
| Order count | Page envelope `total` | Eligible Sales Order documents, not product quantity |
| Ordered quantity | Per-page `grand_subtotal.qty` | Sum of item quantities |
| Net booked order value | Per-page `grand_subtotal.amount` | Before-tax booked value |
| Gross booked order value | Per-page `grand_subtotal.amount_after_tax` | After-tax booked value |
| Open order backlog | Per-page `grand_subtotal.unbilled_amount` | Kledo-provided unbilled value |

Every page-level aggregate is consumed and summed with decimal-string
arithmetic. `grand_subtotal` is not a whole-query total when more pages remain.

## Bounded Sales Invoice PDF

`kledo_get` accepts `include: ["print_document"]` for Sales Invoice. The adapter:

1. fetches the typed Sales Invoice detail and keeps the opaque `print_url`
   locator internal;
2. builds only the allowlisted same-origin download route
   `/finance/invoices/{invoice_id}/download/{opaque_print_locator}`;
3. requires the configured origin, rejects unapproved redirects, and never
   forwards the bearer token to another origin;
4. enforces timeout, byte, MIME, `%PDF-` magic-byte, and final MCP frame limits;
5. returns safe metadata and one embedded `application/pdf` resource;
6. never silently writes the document to a persistent local file.

Word, Excel, labels, receipts, approval documents, email, WhatsApp, and SMS are
outside this contract. Communication actions are writes and are not exposed by
this read-only MCP server.

## Verification boundary

The repository verifies these contracts with synthetic fixtures at the public
MCP boundary. `npm test` is the deterministic gate, and MCP Inspector is an
optional developer interface for manually inspecting JSON-RPC requests and
responses.

Maintainer release checks may compare normalized results with other Kledo
surfaces, but those procedures are external to the runtime contract. The
package contains no live tenant payloads, browser session state, credentials,
document samples, or date-specific parity claims.

## Known limitations

- Generic legacy `relation_ids` outside typed invoice lineage may expose less
  context than `document_lineage`.
- Generic `due -> paymentState` inference is not authoritative for quotes,
  orders, or deliveries.
- Status labels remain endpoint- and entity-specific.
- Generic document output retains the historical `reference` name for
  `ref_number`; typed lineage uses the clearer `number` field.

All lifecycle behavior remains behind the existing read-only `kledo_query`,
`kledo_get`, and `kledo_report` tools.
