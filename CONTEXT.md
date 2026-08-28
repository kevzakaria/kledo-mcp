# Kledo Document Semantics

This context gives Kledo MCP one precise language for commercial documents, their lineage, and the metrics derived from them. It prevents order intake, invoicing, and cash collection from being presented as the same business event.

## Shared language

**Document Number**:
The unique human-facing number assigned to a commercial document, such as `SO/...` or `INV/...`.
_Avoid_: Reference, memo

**Reference**:
The operator-entered project or business context shown in Kledo's Reference field.
_Avoid_: Document Number

**Document Lineage**:
The typed set of predecessor and successor documents that describe how a commercial event was converted, fulfilled, billed, and settled.
_Avoid_: Parent ID without a document type

**Immediate Parent**:
The document directly used to create another document. It is one edge in Document Lineage and is not necessarily the first document in the cycle.
_Avoid_: Original document, root document

**Predecessor Document**:
A typed document that appears earlier in a document's lineage. It may be the Immediate Parent or a more distant ancestor.
_Avoid_: Parent ID, source ID

**Payment Event**:
A typed receipt or payment transaction applied to an invoice. One Payment Event does not by itself prove that the invoice is fully settled.
_Avoid_: Paid Date, Invoice, Final Settlement

## Sales cycle

**Sales Quote (QU)**:
A commercial offer sent to a customer before an order is booked.
_Avoid_: Deal, revenue

**Sales Order (SO)**:
A customer order booked against a salesperson. It records order intake but does not prove delivery, invoicing, or payment.
_Avoid_: Omset, invoice, cash sale

**Sales Delivery (DO)**:
Evidence that ordered goods were prepared or delivered to a customer.
_Avoid_: Sales Order, Sales Invoice

**Sales Invoice (INV)**:
A customer billing document that creates or settles a receivable.
_Avoid_: Payment, collected revenue

**Invoice Payment (IP)**:
A receipt applied to a Sales Invoice.
_Avoid_: Invoice, order value

## Purchase cycle

**Purchase Quote (PQ)**:
A vendor quotation recorded before a purchase commitment.
_Avoid_: Purchase Order, payable

**Purchase Order (PO)**:
A purchase commitment placed with a vendor.
_Avoid_: Purchase Invoice, cash outflow

**Purchase Delivery (PD)**:
Evidence that ordered goods were received from a vendor.
_Avoid_: Purchase Order, Purchase Invoice

**Purchase Invoice (PI)**:
A vendor billing document that creates or settles a payable.
_Avoid_: Purchase Payment

**Purchase Payment (PP)**:
A payment applied to a Purchase Invoice.
_Avoid_: Purchase Invoice, purchase value

## Operational metrics

**Booked Sales Order Set**:
Sales Orders with transaction type `6`, a `trans_date` inside the inclusive
requested period, and status Open (`5`), Partially Shipped (`6`), or Closed
(`7`). Waiting Approval (`111`) and Rejected (`112`) are outside this KPI.
_Avoid_: All Sales Documents, Approved Revenue

**Order Count**:
The number of eligible Sales Orders booked in a period.
_Avoid_: Quantity, invoice count

**Net Booked Order Value**:
The before-tax value of eligible Sales Orders booked in a period and attributed to their assigned salesperson.
_Avoid_: Omset, recognized revenue, collected cash

**Gross Booked Order Value**:
The after-tax value of eligible Sales Orders booked in a period.
_Avoid_: Net Booked Order Value

**Open Order Backlog**:
The value of eligible Sales Orders that Kledo still identifies as unbilled.
_Avoid_: Receivable, overdue invoice

**Invoiced Sales Value**:
The value billed through Sales Invoices in a period.
_Avoid_: Booked Order Value, collected cash

**Collected Cash**:
The value of Invoice Payments received in a period.
_Avoid_: Invoice value, order value

**Outstanding Receivable**:
The unpaid Sales Invoice balance reported by Kledo as of an explicit date. A
company-wide answer is complete only after every customer page has been
consumed; each returned customer's invoice drill-down must also be complete.
_Avoid_: Invoice Amount, Booked Order Value, Collected Cash

**Receivable Project Reference**:
The operator-entered project or business context stored in the Sales Invoice
API `memo` field and normalized as `projectReference`.
_Avoid_: Invoice Number, Document Number

## Customer activity

**Dormancy Candidate**:
A customer that appears in Kledo's Income per Customer report during a bounded
historical eligibility period but does not appear during the following
inactivity period through the analysis date. This is a read-only signal for
human review and possible follow-up, not proof that the customer relationship
has ended.
_Avoid_: Churned Customer, Lost Customer

**Inactivity Cutoff**:
The latest date on which observed Income per Customer activity can still make a
customer a Dormancy Candidate. Activity after this date excludes the customer
from the candidate set.
_Avoid_: Last Purchase Date

**Historical Eligibility Period**:
The bounded period before the Inactivity Cutoff used to establish that a
customer had prior observed income activity. Customers whose only activity
predates this period are outside the analysis rather than classified as
dormant.
_Avoid_: Customer Lifetime

## Product pricing

**Exact Product Identity**:
One active Kledo product selected for analysis. Product code or SKU is the
authoritative selector when a name search returns more than one product.
_Avoid_: First Search Result, Product Family

**Catalog Sale Price**:
The product's configured sale-price setting. It is not evidence that a sale
occurred at that price.
_Avoid_: Latest Sold Price, Period Average Sale Price

**Catalog Base Purchase Price**:
The product's configured base purchase-price setting. It is not evidence that a
purchase occurred at that price.
_Avoid_: Latest Purchased Price, Cost of Goods Sold

**Average Inventory Cost**:
Kledo's current average base cost for the product. It is an inventory valuation
fact, not the purchase price of one vendor invoice.
_Avoid_: Catalog Base Purchase Price, Latest Purchased Price

**Latest Sold Unit Price**:
The latest unit sale price returned by Kledo for the Exact Product Identity,
with the latest sale-transaction date when Kledo supplies it.
_Avoid_: Catalog Sale Price, Period Average Sale Price

**Latest Purchased Unit Price**:
The latest unit purchase price returned by Kledo for the Exact Product Identity.
Its date is exposed only when that price is corroborated by the newest Purchase
Invoice rows in the product transaction history.
_Avoid_: Catalog Base Purchase Price, Average Inventory Cost

**Period Product Profitability**:
Kledo's product sales, cost of goods sold, gross profit, and gross margin for an
explicit date range and calculation method. Gross margin is gross profit divided
by period sales, not the spread between two catalog settings.
_Avoid_: Catalog Margin, Lifetime Margin
