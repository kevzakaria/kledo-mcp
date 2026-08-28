import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('visual MCP Inspector workflow', () => {
  const inspector = resolve('node_modules/.bin/mcp-inspector')
  const inspectorConfig = resolve('mcp-inspector.json')

  it('connects to the synthetic stdio target and discovers exactly three tools', () => {
    const result = spawnSync(
      inspector,
      [
        '--cli',
        '--config',
        inspectorConfig,
        '--server',
        'kledo-fixture',
        '--method',
        'tools/list',
        '--strict',
        '--format',
        'json',
      ],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: '--disable-warning=ExperimentalWarning',
        },
        timeout: 10_000,
      },
    )

    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    const response = JSON.parse(result.stdout) as {
      result: {
        tools: Array<{
          name: string
          inputSchema: {
            oneOf?: unknown
            properties?: Record<string, unknown>
            required?: string[]
          }
        }>
      }
    }
    expect(response.result.tools.map(({ name }) => name)).toEqual([
      'kledo_get',
      'kledo_query',
      'kledo_report',
    ])
    const reportTool = response.result.tools.find(({ name }) => name === 'kledo_report')
    expect(reportTool?.inputSchema.oneOf).toBeUndefined()
    expect(reportTool?.inputSchema.properties).toHaveProperty('report')
    expect(reportTool?.inputSchema.required).toContain('report')
    expect(result.stderr).not.toContain('fixture-secret')
  })

  it('calls the salesperson report through the same synthetic Inspector target', () => {
    const result = spawnSync(
      inspector,
      [
        '--cli',
        '--config',
        inspectorConfig,
        '--server',
        'kledo-fixture',
        '--method',
        'tools/call',
        '--tool-name',
        'kledo_report',
        '--tool-arg',
        'report=sales_by_person',
        '--tool-arg',
        'period={"from":"2026-07-01","to":"2026-07-31"}',
        '--tool-arg',
        'salesPersonName=Fixture Seller',
        '--tool-arg',
        'pageSize=20',
        '--format',
        'json',
      ],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: '--disable-warning=ExperimentalWarning',
        },
        timeout: 10_000,
      },
    )

    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    const response = JSON.parse(result.stdout) as {
      result: {
        isError?: boolean
        structuredContent?: unknown
      }
    }
    expect(response.result.isError).not.toBe(true)
    expect(response.result.structuredContent).toMatchObject({
      report: 'sales_by_person',
      parameters: { salesperson: { id: '7', name: 'Fixture Seller' } },
      data: {
        rows: [
          {
            salesperson: { id: '7', name: 'Fixture Seller' },
            sales: { amount: '125000000.00', currency: null },
            salesCount: 42,
            commission: { amount: '0.00', currency: null },
          },
        ],
      },
    })
    expect(result.stderr).not.toContain('synthetic-inspector-token')
  })

  it('shows bounded Sales Order KPI values and a sanitized aggregate trace', () => {
    const result = spawnSync(
      inspector,
      [
        '--cli',
        '--config',
        inspectorConfig,
        '--server',
        'kledo-fixture',
        '--method',
        'tools/call',
        '--tool-name',
        'kledo_report',
        '--tool-arg',
        'report=sales_order_kpi',
        '--tool-arg',
        'period={"from":"2026-08-01","to":"2026-08-31"}',
        '--tool-arg',
        'salesPersonName=Fixture Seller',
        '--format',
        'json',
      ],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: '--disable-warning=ExperimentalWarning',
        },
        timeout: 10_000,
      },
    )

    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    const response = JSON.parse(result.stdout) as {
      result: { isError?: boolean; structuredContent?: unknown }
    }
    expect(response.result.isError).not.toBe(true)
    expect(response.result.structuredContent).toMatchObject({
      report: 'sales_order_kpi',
      parameters: {
        period: { from: '2026-08-01', to: '2026-08-31' },
        dateBasis: 'trans_date',
        salesperson: { id: '7', name: 'Fixture Seller' },
        statusPolicy: { name: 'booked', includedStatusIds: ['5', '6', '7'] },
      },
      data: {
        orderCount: 2,
        orderedQuantity: '12.5',
        netBookedOrderValue: { amount: '2500.00' },
        grossBookedOrderValue: { amount: '2775.00' },
        openOrderBacklog: { amount: '1000.00' },
      },
      provenance: {
        orders: '/finance/orders',
        aggregateScope: 'sum_of_all_page_grand_subtotals',
      },
    })
    expect(result.stderr).toContain('report.sales_order_kpi.orders.request')
    expect(result.stderr).not.toContain('synthetic-inspector-token')
    expect(result.stderr).not.toContain('private-fixture@example.invalid')
  })

  it('shows the two-window dormant-customer analysis through Inspector', () => {
    const result = spawnSync(
      inspector,
      [
        '--cli',
        '--config',
        inspectorConfig,
        '--server',
        'kledo-fixture',
        '--method',
        'tools/call',
        '--tool-name',
        'kledo_report',
        '--tool-arg',
        'report=dormant_customers',
        '--tool-arg',
        'asOf=2026-08-27',
        '--tool-arg',
        'inactiveDays=90',
        '--tool-arg',
        'historyDays=365',
        '--tool-arg',
        'pageSize=20',
        '--format',
        'json',
      ],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: '--disable-warning=ExperimentalWarning',
        },
        timeout: 10_000,
      },
    )

    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    const response = JSON.parse(result.stdout) as {
      result: { isError?: boolean; structuredContent?: unknown }
    }
    expect(response.result.isError).not.toBe(true)
    expect(response.result.structuredContent).toMatchObject({
      report: 'dormant_customers',
      parameters: {
        historicalPeriod: { from: '2025-05-30', to: '2026-05-29' },
        recentPeriod: { from: '2026-05-30', to: '2026-08-27' },
      },
      data: {
        candidates: [
          {
            customer: { id: '101', displayName: 'Fixture Company' },
            historicalIncome: { amount: '3000.00', currency: null },
            historicalTransactionCount: 3,
          },
        ],
      },
      pageInfo: { hasMore: false, total: 1 },
    })
    expect(result.stderr).toContain('report.dormant_customers.historical.request')
    expect(result.stderr).toContain('report.dormant_customers.recent.request')
    expect(result.stderr).not.toContain('synthetic-inspector-token')
  })

  it('shows exact-SKU item price analysis and its sanitized source trace through Inspector', () => {
    const result = spawnSync(
      inspector,
      [
        '--cli',
        '--config',
        inspectorConfig,
        '--server',
        'kledo-fixture',
        '--method',
        'tools/call',
        '--tool-name',
        'kledo_report',
        '--tool-arg',
        'report=item_price_analysis',
        '--tool-arg',
        'productCode=PAINT-EXACT',
        '--tool-arg',
        'period={"from":"2026-08-01","to":"2026-08-31"}',
        '--tool-arg',
        'profitabilityMethod=inventory',
        '--format',
        'json',
      ],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: '--disable-warning=ExperimentalWarning',
        },
        timeout: 10_000,
      },
    )

    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    const response = JSON.parse(result.stdout) as {
      result: { isError?: boolean; structuredContent?: unknown }
    }
    expect(response.result.isError).not.toBe(true)
    expect(response.result.structuredContent).toMatchObject({
      report: 'item_price_analysis',
      parameters: {
        productSelector: { code: 'PAINT-EXACT' },
        period: { from: '2026-08-01', to: '2026-08-31' },
      },
      data: {
        catalogPrices: {
          salePrice: { amount: '150000.00' },
          basePurchasePrice: { amount: '90000.00' },
        },
        latestTransactionPrices: {
          soldUnitPrice: { amount: '140000.00' },
          purchasedUnitPrice: { amount: '88000.00' },
          purchaseTransactionDate: '2026-08-20',
        },
        profitability: {
          totalSales: { amount: '1400000.00' },
          totalCostOfGoodsSold: { amount: '880000.00' },
          grossProfit: { amount: '520000.00' },
          grossMarginPercent: '37.142857',
        },
      },
    })
    expect(result.stderr).toContain('report.item_price_analysis.product_search.request')
    expect(result.stderr).toContain('report.item_price_analysis.profitability.request')
    expect(result.stderr).not.toContain('synthetic-inspector-token')
    expect(result.stderr).not.toContain('Private fixture customer')
  })

  it('shows invoice-level receivables and project/reference provenance through Inspector', () => {
    const result = spawnSync(
      inspector,
      [
        '--cli',
        '--config',
        inspectorConfig,
        '--server',
        'kledo-fixture',
        '--method',
        'tools/call',
        '--tool-name',
        'kledo_report',
        '--tool-arg',
        'report=receivable_by_invoice',
        '--tool-arg',
        'asOf=2026-08-27',
        '--tool-arg',
        'pageSize=10',
        '--format',
        'json',
      ],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: '--disable-warning=ExperimentalWarning',
        },
        timeout: 10_000,
      },
    )

    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    const response = JSON.parse(result.stdout) as {
      result: { isError?: boolean; structuredContent?: unknown }
    }
    expect(response.result.isError).not.toBe(true)
    expect(response.result.structuredContent).toMatchObject({
      report: 'receivable_by_invoice',
      data: {
        customers: [
          {
            customer: { id: '44', displayName: 'Fixture Customer Ltd' },
            totals: { outstanding: { amount: '1250.00' } },
            invoices: [
              {
                invoiceNumber: 'INV/FIXTURE/501',
                projectReference: 'Fixture Project Alpha',
                outstanding: { amount: '1250.00' },
              },
            ],
          },
        ],
      },
      provenance: {
        customerTotals: '/reportings/agedReceivable',
        invoiceBreakdown: '/reportings/agedReceivableDetail/:contactId',
        projectReference: { apiField: 'memo' },
      },
    })
    expect(
      (
        response.result.structuredContent as {
          provenance: { projectReference: unknown }
        }
      ).provenance.projectReference,
    ).toEqual({ apiField: 'memo' })
    expect(result.stderr).toContain('report.receivable_by_invoice.customer_totals.request')
    expect(result.stderr).toContain('report.receivable_by_invoice.invoice_breakdown.request')
    expect(result.stderr).not.toContain('synthetic-inspector-token')
    expect(result.stderr).not.toContain('private-fixture@example.invalid')
  })

  it('shows the typed Sales Invoice document chain and payment event through Inspector', () => {
    const result = spawnSync(
      inspector,
      [
        '--cli',
        '--config',
        inspectorConfig,
        '--server',
        'kledo-fixture',
        '--method',
        'tools/call',
        '--tool-name',
        'kledo_get',
        '--tool-arg',
        'entity=sales_invoice',
        '--tool-arg',
        'documentNumber="INV/FIXTURE/500"',
        '--tool-arg',
        'include=["document_lineage","payment_events"]',
        '--format',
        'json',
      ],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: '--disable-warning=ExperimentalWarning',
        },
        timeout: 10_000,
      },
    )

    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    const response = JSON.parse(result.stdout) as {
      result: { isError?: boolean; structuredContent?: unknown }
    }
    expect(response.result.isError).not.toBe(true)
    expect(response.result.structuredContent).toMatchObject({
      entity: 'sales_invoice',
      documentLineage: {
        anchor: { documentType: 'sales_invoice', id: '500' },
        immediateParent: { documentType: 'sales_delivery', id: '300' },
        predecessors: [
          { documentType: 'sales_quote', id: '100' },
          { documentType: 'sales_order', id: '200' },
          { documentType: 'sales_delivery', id: '300' },
        ],
        complete: true,
      },
      paymentEvents: [
        {
          relation: 'payment_for',
          documentType: 'invoice_payment',
          id: '600',
          invoiceId: '500',
          number: 'IP/FIXTURE/600',
          amount: { amount: '500.00' },
        },
      ],
      truncation: { documentLineage: false, paymentEvents: false },
    })
    expect(result.stderr).toContain('get.document_number.search.request')
    expect(result.stderr).toContain('upstream.get.document_number.search requested')
    expect(result.stderr).toContain('get.sales_invoice.detail.request')
    expect(result.stderr).toContain('get.sales_invoice.payment_events.request')
    expect(result.stderr).not.toContain('synthetic-inspector-token')
    expect(result.stderr).not.toContain('private-lineage@example.invalid')
  })

  it('shows the bounded Sales Invoice PDF as an embedded Inspector resource', () => {
    const result = spawnSync(
      inspector,
      [
        '--cli',
        '--config',
        inspectorConfig,
        '--server',
        'kledo-fixture',
        '--method',
        'tools/call',
        '--tool-name',
        'kledo_get',
        '--tool-arg',
        'entity=sales_invoice',
        '--tool-arg',
        'id="500"',
        '--tool-arg',
        'include=["print_document"]',
        '--format',
        'json',
      ],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: '--disable-warning=ExperimentalWarning',
        },
        timeout: 10_000,
      },
    )

    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    const response = JSON.parse(result.stdout) as {
      result: {
        isError?: boolean
        structuredContent?: unknown
        content?: Array<{
          type: string
          resource?: { uri?: string; mimeType?: string; blob?: string }
        }>
      }
    }
    expect(response.result.isError).not.toBe(true)
    expect(response.result.structuredContent).toMatchObject({
      entity: 'sales_invoice',
      printDocument: {
        resourceUri: 'kledo://sales-invoice/500/print-document.pdf',
        mimeType: 'application/pdf',
        byteCount: 592,
        sha256: '4f66cd87a350fb7581397c77a2a775e1202f8b682236aaeff615817aa18b2074',
      },
    })
    const resource = response.result.content?.find(({ type }) => type === 'resource')?.resource
    expect(resource).toMatchObject({
      uri: 'kledo://sales-invoice/500/print-document.pdf',
      mimeType: 'application/pdf',
    })
    expect(Buffer.from(resource?.blob ?? '', 'base64').subarray(0, 5).toString('ascii')).toBe(
      '%PDF-',
    )
    expect(result.stderr).toContain('get.sales_invoice.detail.request')
    expect(result.stderr).toContain('get.sales_invoice.print_document.request')
    expect(result.stderr).toContain('upstream.get.sales_invoice.print_document requested (592 bytes)')
    expect(result.stderr).not.toContain('synthetic-inspector-token')
    expect(result.stdout).not.toContain('fixture-print-locator')
  })

  it('shows the typed Purchase Invoice document chain and embedded payment event', () => {
    const result = spawnSync(
      inspector,
      [
        '--cli',
        '--config',
        inspectorConfig,
        '--server',
        'kledo-fixture',
        '--method',
        'tools/call',
        '--tool-name',
        'kledo_get',
        '--tool-arg',
        'entity=purchase_invoice',
        '--tool-arg',
        'id="700"',
        '--tool-arg',
        'include=["document_lineage","payment_events"]',
        '--format',
        'json',
      ],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: '--disable-warning=ExperimentalWarning',
        },
        timeout: 10_000,
      },
    )

    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    const response = JSON.parse(result.stdout) as {
      result: { isError?: boolean; structuredContent?: unknown }
    }
    expect(response.result.isError).not.toBe(true)
    expect(response.result.structuredContent).toMatchObject({
      entity: 'purchase_invoice',
      documentLineage: {
        anchor: { documentType: 'purchase_invoice', id: '700' },
        immediateParent: { documentType: 'purchase_delivery', id: '600' },
        predecessors: [
          { documentType: 'purchase_quote', id: '400' },
          { documentType: 'purchase_order', id: '500' },
          { documentType: 'purchase_delivery', id: '600' },
        ],
        complete: true,
      },
      paymentEvents: [
        {
          relation: 'payment_for',
          documentType: 'purchase_payment',
          transactionTypeId: '16',
          id: '800',
          invoiceId: '700',
          number: 'PP/FIXTURE/800',
          amount: { amount: '500.00' },
        },
      ],
      truncation: { documentLineage: false, paymentEvents: false },
    })
    expect(result.stderr).toContain('get.purchase_invoice.detail.request')
    expect(result.stderr).not.toContain('get.sales_invoice.payment_events.request')
    expect(result.stderr).not.toContain('synthetic-inspector-token')
    expect(result.stderr).not.toContain('private-purchase-lineage@example.invalid')
  })

  it('queries Purchase Quotes through the public Inspector target', () => {
    const result = spawnSync(
      inspector,
      [
        '--cli',
        '--config',
        inspectorConfig,
        '--server',
        'kledo-fixture',
        '--method',
        'tools/call',
        '--tool-name',
        'kledo_query',
        '--tool-arg',
        'entity=purchase_quote',
        '--tool-arg',
        'pageSize=1',
        '--format',
        'json',
      ],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: '--disable-warning=ExperimentalWarning',
        },
        timeout: 10_000,
      },
    )

    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    const response = JSON.parse(result.stdout) as {
      result: { isError?: boolean; structuredContent?: unknown }
    }
    expect(response.result.isError).not.toBe(true)
    expect(response.result.structuredContent).toMatchObject({
      entity: 'purchase_quote',
      items: [
        {
          kind: 'purchase_quote',
          id: '400',
          reference: 'PQ/FIXTURE/400',
          transactionDate: '2026-08-10',
          dueDate: '2026-09-10',
        },
      ],
      pageInfo: { hasMore: false, total: 1 },
      meta: { complete: true },
    })
    expect(result.stderr).toContain('upstream.query.purchase_quote requested')
    expect(result.stderr).not.toContain('synthetic-inspector-token')
    expect(result.stderr).not.toContain('private-purchase-quote@example.invalid')
  })
})
