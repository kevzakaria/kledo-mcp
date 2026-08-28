import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import { createKledoMcpServer } from '../../src/server/create-server.js'
import type { KledoGateway } from '../../src/kledo/gateway.js'

describe('Kledo MCP tool catalog', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  it('advertises exactly the three approved read-only tools over MCP 2026', async () => {
    const gateway: KledoGateway = {
      async query() {
        throw new Error('not used while listing tools')
      },
      async get() {
        throw new Error('not used while listing tools')
      },
      async report() {
        throw new Error('not used while listing tools')
      },
    }

    const client = new Client(
      { name: 'kledo-mcp-contract-test', version: '0.1.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    )
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = serveStdio(() => createKledoMcpServer({ gateway }), {
      legacy: 'reject',
      transport: serverTransport,
    })

    closeables.push(client, server)
    await client.connect(clientTransport)

    const { tools } = await client.listTools()

    expect(tools.map(({ name }) => name)).toEqual([
      'kledo_get',
      'kledo_query',
      'kledo_report',
    ])
    expect(
      tools.map(({ annotations }) => annotations),
    ).toEqual([
      {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    ])
    expect(tools.every(({ inputSchema, outputSchema }) => inputSchema && outputSchema)).toBe(true)
    expect(
      tools.every(({ description }) =>
        /business text.*untrusted data.*never.*instructions/i.test(description ?? ''),
      ),
    ).toBe(true)

    const queryTool = tools.find(({ name }) => name === 'kledo_query')
    const queryProperties = queryTool?.inputSchema.properties as
      | Record<
          string,
          {
            description?: string
            items?: {
              description?: string
              enum?: string[]
              properties?: Record<string, { description?: string; enum?: string[] }>
            }
          }
        >
      | undefined
    const filterField = queryProperties?.filters?.items?.properties?.field
    const sortField = queryProperties?.sort?.items?.properties?.field

    expect(queryTool?.description).toMatch(/sales_invoice.*contactId.*bank_transaction.*bankAccountId/is)
    expect(filterField?.enum).toEqual([
      'contactId',
      'statusId',
      'productId',
      'warehouseId',
      'salesPersonId',
      'bankAccountId',
      'transactionType',
      'typeId',
      'groupId',
      'categoryId',
      'archived',
      'canSell',
      'canPurchase',
      'tracked',
      'transactionDate',
      'dueDate',
      'shippingDate',
      'paymentDate',
      'amount',
    ])
    expect(filterField?.description).toMatch(/warehouse=none.*unit=none/is)
    expect(filterField?.description).toMatch(/ID filter operations default to eq only/i)
    expect(filterField?.description).toMatch(
      /in is allowed only for.*productId.*product\.categoryId.*bank_transaction\.transactionType.*sales_order\.statusId.*warehouseId.*purchase_invoice.*sales_quote/is,
    )
    expect(queryTool?.description).toMatch(/ID filter operations default to eq only/i)
    expect(sortField?.enum).toEqual([
      'transactionDate',
      'statusId',
      'dueDate',
      'total',
      'memo',
      'reference',
      'remaining',
      'paymentDate',
      'name',
      'company',
      'payable',
      'receivable',
      'code',
      'category',
      'basePrice',
      'salePrice',
    ])
    expect(sortField?.description).toMatch(/contact=.*payable.*warehouse=none/is)
    expect(queryProperties?.fields?.items?.enum).toEqual(
      expect.arrayContaining(['kind', 'id', 'party', 'paymentState', 'displayName', 'balance']),
    )
    expect(queryProperties?.fields?.items?.description).toMatch(/sales_invoice.*contact=.*displayName/is)

    const getTool = tools.find(({ name }) => name === 'kledo_get')
    expect(getTool?.inputSchema).toMatchObject({
      properties: {
        include: {
          items: {
            enum: [
              'line_items',
              'relation_ids',
              'invoice_payments',
              'document_lineage',
              'payment_events',
              'print_document',
            ],
          },
          maxItems: 6,
        },
        invoicePaymentLimit: { default: 50, minimum: 1, maximum: 200 },
        lineageLimit: { default: 50, minimum: 1, maximum: 200 },
        paymentEventLimit: { default: 50, minimum: 1, maximum: 200 },
      },
    })
    expect(getTool?.outputSchema).toMatchObject({
      properties: {
        invoicePayments: { type: 'array' },
        documentLineage: { type: 'object' },
        paymentEvents: { type: 'array' },
        printDocument: {
          properties: {
            resourceUri: { type: 'string' },
            mimeType: { const: 'application/pdf', type: 'string' },
            byteCount: { maximum: 6291456, type: 'integer' },
            sha256: { type: 'string' },
          },
          type: 'object',
        },
        truncation: {
          properties: {
            invoicePayments: { type: 'boolean' },
            omittedInvoicePaymentCount: { minimum: 0, type: 'integer' },
            documentLineage: { type: 'boolean' },
            omittedLineageDocumentCount: { minimum: 0, type: 'integer' },
            paymentEvents: { type: 'boolean' },
            omittedPaymentEventCount: { minimum: 0, type: 'integer' },
          },
        },
      },
    })
    const paymentEventVariants = (
      getTool?.outputSchema as {
        properties?: {
          paymentEvents?: {
            items?: {
              oneOf?: Array<{
                properties?: { transactionDate?: { description?: string } }
              }>
            }
          }
        }
      }
    ).properties?.paymentEvents?.items?.oneOf
    expect(paymentEventVariants).toHaveLength(2)
    expect(
      paymentEventVariants?.every((variant) =>
        /sales or purchase payment event/i.test(
          variant.properties?.transactionDate?.description ?? '',
        ),
      ),
    ).toBe(true)

    const reportTool = tools.find(({ name }) => name === 'kledo_report')
    expect(reportTool?.description).toMatch(
      /sales_by_person.*grouped by or filtered to a salesperson.*sales_order_kpi.*deal intake.*not revenue.*income_by_customer.*group or rank customers.*dormant_customers.*not proof of churn.*receivable_by_invoice.*memo.*Reference.*item_price_analysis.*exact.*SKU.*sales_by_period.*time buckets/is,
    )
    const reportInput = reportTool?.inputSchema as {
      oneOf?: unknown
      properties?: Record<string, { enum?: string[]; type?: string }>
      required?: string[]
    }
    expect(reportInput.oneOf).toBeUndefined()
    expect(reportInput.required).toEqual(['report'])
    expect(reportInput.properties).toMatchObject({
      report: {
        enum: expect.arrayContaining([
          'sales_by_person',
          'dormant_customers',
          'receivable_by_invoice',
          'item_price_analysis',
          'sales_order_kpi',
        ]),
      },
      dateBasis: { enum: ['trans_date', 'shipping_date'] },
      salesPersonId: { type: 'string' },
      salesPersonName: { type: 'string' },
      pageSize: { type: 'integer' },
      inactiveDays: { type: 'integer' },
      historyDays: { type: 'integer' },
      productCode: { type: 'string' },
      productName: { type: 'string' },
      profitabilityMethod: { enum: ['inventory', 'non_inventory', 'package'] },
    })

    const reportOutputVariants = (
      reportTool?.outputSchema as {
        oneOf?: Array<{
          properties?: Record<string, unknown> & {
            report?: { const?: string }
            data?: { properties?: Record<string, unknown> }
          }
          required?: string[]
        }>
      }
    ).oneOf
    const salesByPersonOutput = reportOutputVariants?.find(
      (variant) => variant.properties?.report?.const === 'sales_by_person',
    )
    expect(salesByPersonOutput?.required).toEqual([
      'report',
      'parameters',
      'data',
      'pageInfo',
      'meta',
    ])
    expect(salesByPersonOutput?.properties?.data?.properties).toHaveProperty('rows')
    const dormantCustomersOutput = reportOutputVariants?.find(
      (variant) => variant.properties?.report?.const === 'dormant_customers',
    )
    expect(dormantCustomersOutput?.required).toEqual([
      'report',
      'parameters',
      'data',
      'pageInfo',
      'meta',
    ])
    expect(dormantCustomersOutput?.properties?.data?.properties).toHaveProperty('candidates')
    const itemPriceAnalysisOutput = reportOutputVariants?.find(
      (variant) => variant.properties?.report?.const === 'item_price_analysis',
    )
    expect(itemPriceAnalysisOutput?.required).toEqual([
      'report',
      'parameters',
      'data',
      'provenance',
      'meta',
    ])
    expect(itemPriceAnalysisOutput?.properties?.data?.properties).toEqual(
      expect.objectContaining({
        catalogPrices: expect.any(Object),
        latestTransactionPrices: expect.any(Object),
        profitability: expect.any(Object),
      }),
    )
    const receivableByInvoiceOutput = reportOutputVariants?.find(
      (variant) => variant.properties?.report?.const === 'receivable_by_invoice',
    )
    expect(receivableByInvoiceOutput?.required).toEqual([
      'report',
      'parameters',
      'data',
      'pageInfo',
      'provenance',
      'meta',
    ])
    expect(receivableByInvoiceOutput?.properties?.data?.properties).toHaveProperty('customers')
    const salesOrderKpiOutput = reportOutputVariants?.find(
      (variant) => variant.properties?.report?.const === 'sales_order_kpi',
    )
    expect(salesOrderKpiOutput?.required).toEqual([
      'report',
      'parameters',
      'data',
      'provenance',
      'meta',
    ])
    expect(salesOrderKpiOutput?.properties?.data?.properties).toEqual(
      expect.objectContaining({
        orderCount: expect.any(Object),
        orderedQuantity: expect.any(Object),
        netBookedOrderValue: expect.any(Object),
        grossBookedOrderValue: expect.any(Object),
        openOrderBacklog: expect.any(Object),
      }),
    )
  })
})
