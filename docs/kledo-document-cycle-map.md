# Kledo document cycle map

This document maps Kledo's sales and purchase document lifecycles across Web UI routes, read-only API endpoints, upstream fields, and the current MCP surface. The map was reconciled against the live Kledo Web UI and API through 2026-08-28; it intentionally contains no tenant payloads, credentials, document IDs, customer names, or transaction amounts.

## Canonical lifecycle

```mermaid
flowchart LR
    QU[Sales Quote\nQU · type 4] --> SO[Sales Order\nSO · type 6]
    SO --> DO[Sales Delivery\nDO · type 7]
    DO --> INV[Sales Invoice\nINV · type 5]
    INV --> IP[Invoice Payment\nIP · type 17]

    PQ[Purchase Quote\nPQ · type 63] --> PO[Purchase Order\nPO · type 2]
    PO --> PD[Purchase Delivery\nPD · type 8]
    PD --> PI[Purchase Invoice\nPI · type 3]
    PI --> PP[Purchase Payment\nPP · type 16]
```

The arrows describe the normal business cycle, not a guaranteed one-to-one chain. Kledo allows documents to be created without every predecessor, and one order may produce multiple deliveries, invoices, or payments. Code must use the typed relation data returned by Kledo instead of inferring a parent from the child's position in this diagram.

## Routes, endpoints, and MCP coverage

| Stage | Web UI route | List endpoint | Detail/payment source | Current MCP access |
|---|---|---|---|---|
| QU | `#/sales/quotes` | `GET /finance/quotes` | `GET /finance/quotes/{id}` | `sales_quote` query/get |
| SO | `#/sales/orders` | `GET /finance/orders?trans_type_ids=6` | `GET /finance/orders/{id}` | `sales_order` query/get |
| DO | `#/sales/deliveries` | `GET /finance/deliveries?trans_type_ids=7` | `GET /finance/deliveries/{id}` | `sales_delivery` query/get |
| INV | `#/sales/invoices` | `GET /finance/invoices?trans_type_ids=5` | `GET /finance/invoices/{id}` | `sales_invoice` query/get; typed predecessors with `document_lineage` |
| IP | Inside Sales Invoice detail | — | Invoice `transactions[]` and `relations[]`; `GET /finance/invoices/{id}/transactions` returns payment rows | `sales_invoice` get with joined `payment_events`; legacy `invoice_payments` remains |
| PQ | `#/purchases/quotes` | `GET /finance/purchaseQuotes` | `GET /finance/purchaseQuotes/{id}` | `purchase_quote` query/get |
| PO | `#/purchases/purchaseorders` | `GET /finance/purchaseOrders` | `GET /finance/purchaseOrders/{id}` | `purchase_order` query/get |
| PD | `#/purchases/deliveries` | `GET /finance/purchaseDeliveries` | `GET /finance/purchaseDeliveries/{id}` | `purchase_delivery` query/get |
| PI | `#/purchases/purchaseinvoices` | `GET /finance/purchaseInvoices?trans_type_ids=3` | `GET /finance/purchaseInvoices/{id}` | `purchase_invoice` query/get; typed predecessors with `document_lineage` |
| PP | Inside Purchase Invoice detail | — | Purchase Invoice `transactions[]` and `relations[]` | `purchase_invoice` get with joined `payment_events` |

The Purchase Invoice `/{id}/transactions` route was not present in the verified API. Purchase Payments are embedded in the Purchase Invoice detail response, while Sales Invoice payments are available both in the detail response and from the dedicated transactions route.

## Transaction type registry

The numeric IDs are not in lifecycle order and must never be interpreted by comparing their values.

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

The registry is available from Kledo initialization metadata. Status IDs are entity-scoped and localized: for example, status `7` can be rendered as Closed, Billed, or Complete depending on the document type and UI locale. Do not create one global `status_id -> label` map.

## Common header fields

| Web UI meaning | API source | Recommended normalized field | Notes |
|---|---|---|---|
| Number | `ref_number` | `number` | This is the document number, not the user-entered Reference. The current MCP calls it `reference`; that name is ambiguous. |
| Reference / project | `memo` | `reference` | Kledo Web UI's Reference field. Current MCP correctly retains the value as `memo`. |
| Customer or Vendor | `contact_id`, `contact` | `party` | Keep only sanitized identity fields. |
| Transaction Date | `trans_date` | `transactionDate` | Date basis for booking or billing depends on the document type. |
| Expiry / Due Date | `due_date` | `expiryDate` or `dueDate` | Quote expiry and invoice due date are different domain concepts even though the API field is shared. |
| Shipping Date | `shipping_date` | `shippingDate` | Used by order and delivery workflows. |
| Warehouse | `warehouse_id` | `warehouseId` | May also exist per line item. |
| Sales Person | `sales_id`, `sales` | `salesperson` | Relevant to sales-side attribution. |
| Status | `status_id` plus entity-specific initialization catalog | `status: { id, label, scope }` | Labels are localized and must be resolved within the document type. |
| Transaction type | `trans_type_id` | `documentType` and `transactionTypeId` | Required for safe lineage parsing. |
| Total before tax | `amount`; aggregate `grand_subtotal.amount` | `amounts.beforeTax` | Verify endpoint-specific discount behavior. |
| Tax | `tax`, `total_tax` | `amounts.tax` | Header and line tax fields have different granularity. |
| Total | `amount_after_tax`; aggregate `grand_subtotal.amount_after_tax` | `amounts.afterTax` | Current MCP exposes this as `total`. |
| Balance Due | `due` | `amounts.remaining` | Payment semantics are valid for INV and PI. Do not infer payment state from this field on quotes, orders, or deliveries. |
| Unbilled | `unbilled_amount`; aggregate `grand_subtotal.unbilled_amount` | `amounts.unbilled` | Operational backlog, not receivable. |
| Currency | `currency_id`, `currency_rate`, `currency_source` | `currency` | Preserve decimal strings. |
| Tags | `tags` | `tags` | Treat Kledo-originated labels as untrusted data. |
| Message | `message` | `message` | Optional customer/vendor-facing text. |
| Attachment | `attachment`, `attachment_details` | Not exposed by default | Do not download or expose without an explicit bounded contract. |
| Approval | `approval_status`, `approval_level`, `approval_progress`, `approval_log` | Optional approval summary | Entity-dependent. |

## Line-item fields

| Web UI column | API source | Current MCP field |
|---|---|---|
| Product | `items[].product.id/code/name` | `lineItems[].product` |
| Description | `items[].desc` | `lineItems[].description` |
| Qty | `items[].qty` | `lineItems[].quantity` |
| Unit | `items[].unit_id` and endpoint-provided unit metadata | `lineItems[].unit` when available |
| Warehouse | `items[].warehouse_id` | Gap: not normalized per line |
| Discount | `discount_percent`, `discount_amount`, `additional_discount_amount` | Gap: not normalized explicitly |
| Price | `items[].price` | `lineItems[].unitPrice` |
| Tax | `tax_id`, `item_tax`, `tax` | `lineItems[].taxRate`, `lineItems[].tax` |
| Amount before tax | `items[].amount` or `subtotal`, depending on endpoint semantics | `lineItems[].subtotal` |
| Amount after tax | `items[].amount_after_tax` | `lineItems[].total` |

## Stage-specific Web UI labels

| Stage | Verified detail labels |
|---|---|
| QU | Customer, Number, Transaction Date, Expiry, Reference, Tag, Sales Person, Message |
| SO | Customer, Number, Quote Number, Transaction Date, Due Date, Warehouse, Reference, Tag, Sales Person, Message |
| DO | Customer, Number, Shipping date, Order Number, Warehouse, Reference, Tag, Sales Person, Message |
| INV | Customer, Number, Delivery Number, Transaction Date, Due Date, Warehouse, Reference, Tag, Sales Person, Message |
| IP | Date, Transaction, Number, Tag, Reference, Amount in the Sales Invoice transaction table |
| PQ | Vendor, Number, Transaction Date, Expiry, Reference, Tag, DIKIRIM KEPADA, Message |
| PO | Vendor, Number, Transaction Date, Due Date, Warehouse, Reference, Tag, DIKIRIM KEPADA, Tanggal Kirim, Message |
| PD | Vendor, Number, Shipping date, Order Number, Warehouse, Reference, Tag, Message |
| PI | Vendor, Number, Delivery Number, Transaction Date, Due Date, Warehouse, Reference, Tag |
| PP | Date, Transaction, Number, Tag, Reference, Amount in the Purchase Invoice transaction table |

## Lineage contract

Use these sources in descending order of purpose:

1. `relations[]` is the full typed lineage visible in the detail screen. Each row includes at least `id`, `ref_number`, and `trans_type_id`; it also includes payment references that are absent from the compact payment transaction row.
2. `parent_tran` is the immediate predecessor and includes `id`, `ref_number`, and `trans_type_id`.
3. Named convenience objects such as `quote`, `order`, `purchase_order`, and `purchase_quote` can corroborate a known predecessor but are not present on every stage.
4. `transactions[]` contains settlement rows. Type `17` is an Invoice Payment; type `16` is a Purchase Payment. `business_tran_id` on the transaction points to the invoice being settled.
5. `business_tran_id` on a document can connect a child to its source, but its target type still needs the transaction-type registry.

Never map `parent_tran` to a fixed entity based only on the child entity. A Sales Invoice may have a Sales Delivery as its immediate parent, and a Purchase Invoice may have a Purchase Delivery as its immediate parent.

Recommended normalized relation:

```json
{
  "relation": "derived_from",
  "documentType": "sales_delivery",
  "transactionTypeId": "7",
  "id": "<decimal Kledo ID>",
  "number": "<sanitized document number>"
}
```

Recommended normalized payment relation:

```json
{
  "relation": "payment_for",
  "documentType": "invoice_payment",
  "transactionTypeId": "17",
  "id": "<decimal Kledo ID>",
  "invoiceId": "<decimal Kledo ID>",
  "number": "<sanitized payment number>",
  "transactionDate": "YYYY-MM-DD",
  "amount": { "amount": "0", "currency": null }
}
```

## Sales Order KPI contract

Total Sales Orders per salesperson can be a KPI when it is named and filtered precisely.

### Dimensions

- salesperson: `sales_id` assigned to the Sales Order;
- period: inclusive `date_from` and `date_to` over `trans_date`;
- document type: `trans_type_ids=6`;
- eligible status: Open (`5`), Partially Shipped (`6`), or Closed (`7`);
- excluded status: Waiting Approval (`111`) and Rejected (`112`).

### Metrics

| Metric | API source | Meaning |
|---|---|---|
| Order Count | page envelope `total` | Number of eligible SO documents, not product quantity. |
| Ordered Quantity | `grand_subtotal.qty` | Sum of item quantities. Do not call this deal count. |
| Net Booked Order Value | `grand_subtotal.amount` | Before-tax booked value; recommended headline sales KPI. |
| Gross Booked Order Value | `grand_subtotal.amount_after_tax` | After-tax booked value; useful for matching the UI Total column. |
| Open Order Backlog | `grand_subtotal.unbilled_amount` | Kledo-provided unbilled value for the selected SO set. |

Booked Order Value is not omset, accounting revenue, invoice value, or cash collected. Those need separate INV and IP metrics. Returns and later reversals also need an explicit netting policy before the KPI is called net realized sales.

The verified Web UI filter serializes `sales_id`, `trans_type_ids=6`, `date_from`, and `date_to`, then calls the Sales Order list endpoint. The `sales_order_kpi` adapter now consumes every API page and sums page-level aggregates exactly. The UI count, before-tax total, and after-tax total matched the public MCP result for the tested period.

## Observed API detail-field inventory

The live detail responses share a broad transaction model. The tables above map every operator-facing field individually. The remaining observed keys are classified below so internal, printing, approval, and integration metadata are not mistaken for unanswered business fields.

### Header fields

| Field group | Observed API fields | Exposure policy |
|---|---|---|
| Identity and type | `id`, `ref_number`, `trans_type_id`, `status_id`, `business_tran_id`, `sub_business_tran_id`, `membership_trans_type_id` | Normalize IDs as decimal strings; type every relation before exposing it. |
| Dates and time | `trans_date`, `due_date`, `shipping_date`, `payment_date`, `paid_date`, `trans_time`, `due_time`, `created_at`, `updated_at` | Expose only dates with a document-specific meaning. Do not turn a missing date into a business event. |
| Party and ownership | `contact_id`, `contact`, `contact_shipping_address_id`, `contact_shipping_address`, `owner_id`, `sales_id`, `sales` | Sanitize contact and salesperson identity; never expose email, phone, address, tax ID, or bank data by default. |
| Amounts and tax | `amount`, `amount_after_tax`, `amount_ori`, `amount_after_tax_ori`, `subtotal`, `tax`, `total_tax`, `include_tax`, `due`, `balance` | Preserve decimal strings and label before-tax, after-tax, and remaining amounts explicitly. |
| Discounts and fees | `discount_percent`, `discount_amount`, `additional_discount_percent`, `additional_discount_amount`, `additional_discounts`, `total_additional_discounts`, `total_after_discount`, `fees` | Normalize only when a bounded report needs the breakdown. |
| Currency | `currency_id`, `currency_source_id`, `currency_source`, `currency_rate` | Keep source currency and rate provenance; never infer a currency code from the tenant. |
| Terms and settlement controls | `term_id`, `pay_later`, `pay_from_finance_account_id`, `payment_id`, `payment_type_id`, `payback`, `bank_statement_id`, `bank_account_id` | These are controls or links, not proof of settlement. Settlement truth comes from typed payment transactions and remaining invoice balance. |
| Shipping and warehouse | `warehouse_id`, `is_multi_warehouse`, `shipping_cost`, `shipping_comp_id`, `shipping_tracking`, `delivery_ids` | Expose operationally when requested; tracking data should remain bounded. |
| Withholding | `witholding_percent`, `witholding_amount`, `witholding_account_id`, `witholding_account`, `witholdings` | Preserve Kledo's upstream spelling at the adapter boundary; expose a correctly spelled normalized concept. |
| Human content | `memo`, `desc`, `message`, `tags`, `custom` | Treat as untrusted data. `memo` is the Web UI Reference/project value. |
| Source and integration | `related_id`, `related_type`, `source`, `source_id`, `local_id`, `outlet_id`, `pos_shift_id`, `canvassing_id`, `is_from_canvassing`, `recap_id`, `is_recapped` | Keep internal unless required to prove lineage or source provenance. |
| Invoice variants | `invoice_type_id`, `invoice_type`, `invoice_type_data`, `have_proforma`, `can_create_proforma`, `order_payment` | Model only in a dedicated variant contract. |
| Stamp and queue | `is_stamped`, `stamp_serial_number`, `tran_duty_stamp`, `queue_number`, `queue_number_formatted` | Not part of the default document summary. |
| Approval | `is_approveable`, `approval_status`, `approval_level`, `approval_log`, `approval_roles_on_level`, `approval_progress` | Expose a bounded approval summary, not raw role or audit payloads. |
| Mutability flags | `is_editable`, `is_deletable`, `is_revertable`, `is_closeable`, `is_uncloseable`, `is_voidable`, `is_unvoidable`, `is_returnable`, `currency_editable`, `reason` | Read-only MCP may report lifecycle capability but must never turn it into a write operation. |
| Print and communication | `print_url`, `print_tax_url`, `print_url_word`, `print_url_excel`, `print_url_label`, `print_url_delivery`, `print_url_recap`, `print_url_receipt`, `print_url_document_receipt`, `print_url_approval`, `already_send_sms`, `already_send_email`, `already_send_email_recap`, `already_send_whatsapp` | Exclude raw locators and communication state from default MCP output. PDF retrieval may only happen through the explicit bounded contract below; never fetch or send implicitly. |
| Navigation and audit | `next`, `prev`, `log`, `attachment`, `attachment_details` | Exclude from default MCP output; use an explicit bounded contract if later required. |
| Embedded cycle data | `items`, `transactions`, `relations`, `parent_tran`, `quote`, `order`, `purchase_quote`, `purchase_order`, `deliveries`, `dp_transactions`, `memo_payment_transactions`, `available_memos` | Parse with the typed lineage and payment rules in this document. |
| Payment Connect | `payment_connect`, `payment_connect_public_urls` | Exclude from default output because public URLs and provider metadata are not required for analysis. |

### Line-item fields

| Field group | Observed API fields | Exposure policy |
|---|---|---|
| Identity and ownership | `id`, `tran_id`, `trans_type_id`, `membership_trans_type_id`, `finance_account_id` | Keep line ID and product identity; expose accounting IDs only under an explicit report contract. |
| Product | `product`, `product_name`, `original_product_name`, `custom_product_name` | Prefer the typed product object and preserve explicit custom naming. |
| Description and quantity | `desc`, `qty`, `unit_id`, `unit_conv`, `warehouse_id`, `sort_order` | Normalize description, quantity, unit, and warehouse; sort order is presentation metadata. |
| Price and amount | `price`, `price_after_tax`, `amount`, `amount_after_tax`, `subtotal`, `amount_ori`, `amount_after_tax_ori` | Preserve decimal strings and label tax basis. |
| Discount | `discount_percent`, `discount_amount`, `discount_amount_input`, `additional_discount_amount` | Expose only with clear order-of-operations semantics. |
| Tax | `tax_id`, `taxable`, `tax`, `item_tax` | Normalize tax ID, label, rate, and amount when available. |
| Currency | `currency_id`, `currency_rate` | Keep explicit source metadata only. |
| Physical attributes | `weight_in_gram`, `total_weight_in_gram`, `length`, `width`, `height`, `total_volume` | Optional fulfillment metadata, not part of default finance answers. |
| Serial and configuration | `serial_numbers`, `modifiers`, `custom` | Expose only when explicitly requested and bounded. |
| Pricing rules | `price_rule`, `price_rule_id`, `price_rule_reward`, `price_rule_reward_id` | Internal pricing provenance; not the same as the final line price. |
| Local metadata | `local_id` | Never use as a tenant-stable Kledo identity. |

## Print PDF retrieval seam

This is an implemented, read-only `kledo_get` contract for Sales Invoice only.

The Sales Invoice detail response exposes `print_url`, but the value is an opaque
locator rather than a directly fetchable URL. The Web UI constructs a typed
document download route:

```text
GET /finance/invoices/{invoice_id}/download/{opaque_print_locator}
```

A live Chrome plus MCP Inspector check on 2026-08-28 confirmed that the same
Sales Invoice detail exposed a Web UI Print action and that this route returned
`application/pdf`, a valid `%PDF-` signature, matching byte-count and SHA-256
metadata, and a renderable one-page A4 PDF. The check used one bounded sample;
the temporary PDF and render were deleted, and no locator, document ID, business
field, or document content was retained.

The behavior stays behind the existing `kledo_get` interface rather than adding
a fourth tool. The opt-in shape is:

```json
{
  "entity": "sales_invoice",
  "id": "<kledo-id>",
  "include": ["print_document"]
}
```

The adapter does the following:

1. fetches the typed document detail and keeps `print_url` internal;
2. builds only an entity-allowlisted download route, beginning with the verified
   Sales Invoice route;
3. requires HTTPS and the configured Kledo origin, preserves authentication only on
   that origin, and rejects unapproved redirects;
4. enforces a dedicated 30-second timeout and a 4 MiB standard byte limit, then
   validates both `application/pdf` and the `%PDF-` magic bytes;
5. returns one embedded PDF resource plus safe `resourceUri`, MIME type, byte
   count, and SHA-256 metadata; it never returns or logs the raw locator;
6. fails explicitly when the PDF exceeds the MCP transport budget instead of
   truncating or silently writing a persistent local file.

`print_tax_url`, Word, Excel, label, receipt, approval, and communication actions
remain out of scope until each route and its authorization semantics are verified
individually. PDF retrieval is read-only; sending email, WhatsApp, or SMS remains a
write operation and is not part of this MCP.

## Resolved MCP gap

`sales_by_person` now follows the verified flat Kledo response: nested
salesperson identity, `total_amount_after_tax`, `total_count`, and
`total_commission`. The adapter applies bounded signed pagination locally,
reports `salesCount` instead of product quantity, and was matched against the
Web UI through the public MCP Inspector path.

Sales Invoice lineage now uses the transaction-type registry instead of the
child document type. `relations[]` supplies the full typed QU, SO, and DO set;
`parent_tran` is checked as the immediate predecessor; and type-17 relation rows
are joined to compact transaction facts as Invoice Payment events. Limits and
truncation are explicit, and conflicting or incomplete joins fail safely. This
contract is covered through the public `kledo_get` MCP boundary and strict
Inspector fixture. A bounded live Inspector call matched the live API's three
source shapes and the corresponding Web UI detail page on 2026-08-28.

Purchase Invoice now applies the same typed contract to PQ, PO, and PD while
joining type-16 Purchase Payment rows directly from its detail response. This
path deliberately performs one detail request because no separate Purchase
Invoice transactions route was found. Purchase Quote also has explicit
`purchase_quote` query/get routing through its verified list and detail paths.

## Current MCP gaps exposed by the map

1. Generic legacy `relation_ids` normalization outside the typed Sales and
   Purchase Invoice paths can still misclassify `parent_tran` and ignore
   authoritative `relations[]`.
2. Generic `due -> paymentState` inference produces misleading payment states
   on QU, SO, DO, PQ, PO, and PD. Invoice payment state must be
   document-specific; SO list payment status comes from Kledo's derived
   `payment_status` field.
3. Status IDs are returned without entity-scoped labels.
4. Salesperson identity is filterable on selected sales documents but is not normalized into document output.
5. Document number and user-entered Reference are ambiguously named in the current normalized model (`ref_number -> reference`, `memo -> memo`).

## Product priorities

Completed:

- repair `sales_by_person` against the current Kledo response.
- add semantic dormant-customer analysis behind `kledo_report` without calling
  the candidates definitive churn;
- add `item_price_analysis`, fail ambiguous product-name matches, and require an
  exact SKU to distinguish product variants.
- add `receivable_by_invoice`, preserve Sales Invoice API `memo` as
  `projectReference`, and record that Kledo displays it as Reference in the Web
  UI.
- add `sales_order_kpi`, consume every Sales Order page, preserve the exact
  `grand_subtotal` field provenance, and label booked order value separately
  from revenue, invoices, and cash.
- complete typed Sales and Purchase Invoice lineage and payment parity behind
  `kledo_get`, add `purchase_quote` query/get access, and cross-check both
  vertical slices against the live Web UI.

The remaining agreed order is:

1. add opt-in bounded PDF retrieval after the typed document and lineage contracts
   are stable.

All additions stay behind the existing read-only `kledo_query`, `kledo_get`, and `kledo_report` tools.

## Sales Invoice lineage Web UI parity

The Sales Invoice `document_lineage` and `payment_events` contract was
cross-checked on 2026-08-28 against one live invoice detail page. The Web UI's
Delivery Number matched `immediateParent`, and its Transaction table exposed
the same typed Quote, Order, Delivery, and Receive Invoice Payment documents.
A privacy-preserving comparison through the public `kledo_get` Inspector path
matched the anchor, every predecessor ID and number, the immediate-parent ID and
type, and the payment ID, number, date, and amount. The lineage was complete and
neither output was truncated.

The repository retains only this semantic parity statement and synthetic
fixtures; it does not retain the live document IDs, numbers, customer data,
project reference, payment account, dates, amounts, or response payload.

## Purchase cycle Web UI parity

The Purchase Invoice `document_lineage` and `payment_events` contract was
cross-checked on 2026-08-28 against one live detail page. That document had
Purchase Order and Purchase Delivery predecessors plus a Purchase Payment; the
optional Purchase Quote stage was absent. The Web UI and public `kledo_get`
result matched the invoice anchor, every present predecessor, the immediate
parent, and the payment event. A synthetic full-cycle contract separately
covers `PQ -> PO -> PD -> PI -> PP`, including safe failure and truncation.

Purchase Quote query/get routing was also checked through public Inspector
calls. The MCP result matched the Web UI's active empty date window, then one
available detail sample matched on document number, vendor, transaction date,
and expiry. No live identifier or business value is retained in the repository.

## Sales Order KPI Web UI parity

The `sales_order_kpi` adapter was cross-checked on 2026-08-27 against a live
Sales Orders page filtered to one salesperson, transaction type Sales Order,
and one bounded month. Order count, Total Before Tax, and Total matched exactly
between Web UI and the public MCP result. Ordered Quantity and Open Order
Backlog remain API-sourced fields because that list footer does not display
them.

The repository retains only this semantic parity statement and synthetic
fixtures; it does not retain the live salesperson name, ID, order rows,
customer data, or business amounts.

## Receivable Web UI parity

The `receivable_by_invoice` adapter was cross-checked on 2026-08-27 against one
live Aged Receivables customer row and its Aged Receivable Detail page. A
privacy-preserving digest matched for every invoice number, transaction date,
due date, Reference/project, invoice amount, outstanding amount, not-yet-due
amount, transaction age, and due age on that customer page.

The customer summary endpoint does not expose total invoice amount; that value
comes only from the verified detail endpoint. The adapter therefore validates
outstanding totals between both sources but sources invoice amount from detail
instead of inventing it. No live customer name, contact ID, invoice number,
project reference, amount, or response payload is retained in this repository.

## Product-price Web UI parity

The exact-SKU product adapter was cross-checked on 2026-08-27 against Kledo's
Product Profitability report, Product detail, recent Sales Invoice product rows,
and Purchase Invoice-filtered product rows. The MCP result matched the Web UI
for catalog sale price, catalog base purchase price, average inventory cost,
latest sold unit price and date, latest purchased unit price and date, period
sales, HPP, gross profit, and gross margin.

A broad product-name search returned multiple real variants, confirming that a
first-match strategy would be unsafe. The adapter therefore returns
`AMBIGUOUS` until the caller supplies an exact product code. No tenant product
name, product ID, document reference, amount, or response payload is retained in
this repository.
