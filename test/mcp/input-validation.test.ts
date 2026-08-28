import { describe, expect, it } from 'vitest'

import { applyQueryOptions } from '../../src/kledo/query-options.js'
import {
  kledoGetInputSchema,
  kledoQueryInputSchema,
  kledoReportInputSchema,
} from '../../src/tools/schemas.js'

describe('public MCP input validation', () => {
  it('accepts bounded positive decimal IDs and rejects zero or oversized IDs', () => {
    expect(
      kledoGetInputSchema.safeParse({
        entity: 'sales_invoice',
        id: '99999999999999999999',
      }).success,
    ).toBe(true)
    for (const id of ['0', '01', '-1', '100000000000000000000']) {
      expect(
        kledoGetInputSchema.safeParse({ entity: 'sales_invoice', id }).success,
      ).toBe(false)
    }
    expect(
      kledoReportInputSchema.safeParse({
        report: 'sales_by_period',
        period: { from: '2026-08-01', to: '2026-08-31' },
        unitId: '0',
      }).success,
    ).toBe(false)

    for (const value of ['0', '01', '100000000000000000000']) {
      const invalidId = kledoQueryInputSchema.parse({
        entity: 'sales_invoice',
        filters: [{ field: 'contactId', op: 'eq', value }],
      })
      expect(() => applyQueryOptions(invalidId, new URL('https://example.test/invoices'))).toThrow(
        'Unsupported sales_invoice filter: contactId eq',
      )
    }
  })

  it('defaults and bounds document-lineage and payment-event expansion', () => {
    expect(
      kledoGetInputSchema.parse({
        entity: 'sales_invoice',
        id: '500',
        include: ['document_lineage', 'payment_events'],
      }),
    ).toEqual({
      entity: 'sales_invoice',
      id: '500',
      include: ['document_lineage', 'payment_events'],
      lineItemLimit: 50,
      invoicePaymentLimit: 50,
      lineageLimit: 50,
      paymentEventLimit: 50,
    })

    for (const input of [
      { lineageLimit: 0 },
      { lineageLimit: 201 },
      { paymentEventLimit: 0 },
      { paymentEventLimit: 201 },
    ]) {
      expect(
        kledoGetInputSchema.safeParse({
          entity: 'sales_invoice',
          id: '500',
          include: ['document_lineage', 'payment_events'],
          ...input,
        }).success,
      ).toBe(false)
    }
  })

  it('requires quoted strings for IDs, dates, decimal amounts, lists, and ranges', () => {
    for (const filter of [
      { field: 'contactId', op: 'eq', value: 9_007_199_254_740_990 },
      { field: 'amount', op: 'gte', value: 9_007_199_254_740_990 },
      { field: 'transactionDate', op: 'gte', value: 20_260_801 },
      { field: 'productId', op: 'in', value: ['5', 6] },
      { field: 'amount', op: 'between', value: { from: '1.00', to: 2 } },
    ]) {
      expect(
        kledoQueryInputSchema.safeParse({ entity: 'sales_invoice', filters: [filter] }).success,
      ).toBe(false)
    }

    const exact = kledoQueryInputSchema.parse({
      entity: 'sales_invoice',
      filters: [
        { field: 'contactId', op: 'eq', value: '9007199254740990' },
        { field: 'amount', op: 'gte', value: '9007199254740990.5' },
        { field: 'productId', op: 'in', value: ['5', '6'] },
      ],
    })
    const url = new URL('https://example.test/invoices')
    applyQueryOptions(exact, url)
    expect(url.searchParams.get('contact_id')).toBe('9007199254740990')
    expect(url.searchParams.get('amount_gte')).toBe('9007199254740990.5')
    expect(url.searchParams.get('product_id')).toBe('5,6')

    expect(
      kledoQueryInputSchema.safeParse({
        entity: 'product',
        filters: [{ field: 'archived', op: 'eq', value: true }],
      }).success,
    ).toBe(true)
  })

  it('bounds every user-controlled query string before it reaches Kledo', () => {
    const valid = kledoQueryInputSchema.safeParse({
      entity: 'sales_invoice',
      search: 's'.repeat(200),
      filters: [
        { field: 'statusId', op: 'eq', value: '1'.repeat(200) },
        { field: 'statusId', op: 'in', value: ['1'.repeat(200)] },
        {
          field: 'transactionDate',
          op: 'between',
          value: { from: '2'.repeat(200), to: '3'.repeat(200) },
        },
      ],
      sort: [{ field: 'transactionDate', direction: 'asc' }],
      fields: ['reference'],
      cursor: 'c'.repeat(2048),
    })
    expect(valid.success).toBe(true)

    for (const input of [
      { entity: 'sales_invoice', search: 's'.repeat(201) },
      {
        entity: 'sales_invoice',
        filters: [{ field: 'statusId', op: 'eq', value: '1'.repeat(201) }],
      },
      {
        entity: 'sales_invoice',
        filters: [{ field: 'statusId', op: 'in', value: ['1'.repeat(201)] }],
      },
      {
        entity: 'sales_invoice',
        filters: [
          {
            field: 'transactionDate',
            op: 'between',
            value: { from: '2'.repeat(201), to: '2026-08-31' },
          },
        ],
      },
      {
        entity: 'sales_invoice',
        filters: [{ field: 'f'.repeat(81), op: 'eq', value: '1' }],
      },
      {
        entity: 'sales_invoice',
        sort: [{ field: 's'.repeat(81), direction: 'asc' }],
      },
      { entity: 'sales_invoice', fields: ['f'.repeat(81)] },
      { entity: 'sales_invoice', cursor: 'c'.repeat(2049) },
    ] as const) {
      expect(kledoQueryInputSchema.safeParse(input).success).toBe(false)
    }

    expect(
      kledoReportInputSchema.safeParse({
        report: 'aged_payable',
        asOf: '2026-08-31',
        cursor: 'c'.repeat(2049),
      }).success,
    ).toBe(false)

    expect(
      kledoQueryInputSchema.safeParse({
        entity: 'sales_invoice',
        filters: [{ field: 'reference', op: 'contains', value: 'INV' }],
      }).success,
    ).toBe(false)
  })

  it('rejects misspelled canonical query fields with actionable schema errors', () => {
    const cases = [
      {
        input: {
          entity: 'sales_invoice',
          filters: [{ field: 'contactID', op: 'eq', value: '44' }],
        },
        expected: 'contactId',
      },
      {
        input: {
          entity: 'sales_invoice',
          sort: [{ field: 'transaction_date', direction: 'desc' }],
        },
        expected: 'transactionDate',
      },
      {
        input: { entity: 'contact', fields: ['display_name'] },
        expected: 'displayName',
      },
    ] as const

    for (const { input, expected } of cases) {
      const result = kledoQueryInputSchema.safeParse(input)
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.issues[0]?.message).toContain(expected)
    }
  })

  it('accepts only real YYYY-MM report months and chronologically ordered periods', () => {
    for (const month of ['2026-01', '2026-12']) {
      expect(
        kledoReportInputSchema.safeParse({ report: 'executive_summary', month }).success,
      ).toBe(true)
    }
    for (const month of ['2026-00', '2026-13', '2026-1', '26-01']) {
      expect(
        kledoReportInputSchema.safeParse({ report: 'executive_summary', month }).success,
      ).toBe(false)
    }

    expect(
      kledoReportInputSchema.safeParse({
        report: 'profit_loss',
        period: { from: '2026-08-31', to: '2026-08-01' },
      }).success,
    ).toBe(false)
    expect(
      kledoReportInputSchema.safeParse({
        report: 'profit_loss',
        period: { from: '2026-08-01', to: '2026-08-31' },
        comparePeriod: { from: '2026-07-31', to: '2026-07-01' },
      }).success,
    ).toBe(false)
    expect(
      kledoReportInputSchema.safeParse({
        report: 'profit_loss',
        period: { from: '2026-08-01', to: '2026-08-31' },
        comparePeriod: { from: '2026-07-01', to: '2026-07-31' },
      }).success,
    ).toBe(true)
  })

  it('defaults and bounds dormant-customer analysis windows', () => {
    expect(
      kledoReportInputSchema.parse({
        report: 'dormant_customers',
        asOf: '2026-08-27',
      }),
    ).toEqual({
      report: 'dormant_customers',
      asOf: '2026-08-27',
      inactiveDays: 90,
      historyDays: 365,
      pageSize: 20,
    })

    for (const input of [
      { report: 'dormant_customers', asOf: '2026-02-29' },
      { report: 'dormant_customers', asOf: '2026-08-27', inactiveDays: 0 },
      { report: 'dormant_customers', asOf: '2026-08-27', historyDays: 3651 },
    ]) {
      expect(kledoReportInputSchema.safeParse(input).success).toBe(false)
    }
  })

  it('requires one exact product selector and a period for item price analysis', () => {
    expect(
      kledoReportInputSchema.parse({
        report: 'item_price_analysis',
        productCode: 'PAINT-001',
        period: { from: '2026-08-01', to: '2026-08-31' },
      }),
    ).toEqual({
      report: 'item_price_analysis',
      productCode: 'PAINT-001',
      period: { from: '2026-08-01', to: '2026-08-31' },
      profitabilityMethod: 'inventory',
    })

    for (const input of [
      {
        report: 'item_price_analysis',
        period: { from: '2026-08-01', to: '2026-08-31' },
      },
      {
        report: 'item_price_analysis',
        productCode: 'PAINT-001',
        productName: 'Fixture Paint',
        period: { from: '2026-08-01', to: '2026-08-31' },
      },
      { report: 'item_price_analysis', productCode: 'PAINT-001' },
      {
        report: 'item_price_analysis',
        productName: 'Fixture Paint',
        period: { from: '2026-08-31', to: '2026-08-01' },
      },
    ]) {
      expect(kledoReportInputSchema.safeParse(input).success).toBe(false)
    }
  })

  it('defaults and bounds customer fan-out for receivable invoice details', () => {
    expect(
      kledoReportInputSchema.parse({
        report: 'receivable_by_invoice',
        asOf: '2026-08-27',
      }),
    ).toEqual({
      report: 'receivable_by_invoice',
      asOf: '2026-08-27',
      pageSize: 10,
    })

    for (const input of [
      { report: 'receivable_by_invoice', asOf: '2026-02-29' },
      { report: 'receivable_by_invoice', asOf: '2026-08-27', pageSize: 0 },
      { report: 'receivable_by_invoice', asOf: '2026-08-27', pageSize: 21 },
      {
        report: 'receivable_by_invoice',
        asOf: '2026-08-27',
        warehouseIds: ['2'],
      },
    ]) {
      expect(kledoReportInputSchema.safeParse(input).success).toBe(false)
    }
  })

  it('requires a bounded period and one optional salesperson selector for Sales Order KPI', () => {
    expect(
      kledoReportInputSchema.parse({
        report: 'sales_order_kpi',
        period: { from: '2026-08-01', to: '2026-08-31' },
        salesPersonName: 'Fixture Seller',
      }),
    ).toEqual({
      report: 'sales_order_kpi',
      period: { from: '2026-08-01', to: '2026-08-31' },
      salesPersonName: 'Fixture Seller',
    })

    for (const input of [
      { report: 'sales_order_kpi' },
      {
        report: 'sales_order_kpi',
        period: { from: '2026-08-31', to: '2026-08-01' },
      },
      {
        report: 'sales_order_kpi',
        period: { from: '2026-08-01', to: '2026-08-31' },
        salesPersonId: '7',
        salesPersonName: 'Fixture Seller',
      },
      {
        report: 'sales_order_kpi',
        period: { from: '2026-08-01', to: '2026-08-31' },
        cursor: 'not-supported',
      },
    ]) {
      expect(kledoReportInputSchema.safeParse(input).success).toBe(false)
    }
  })

  it('rejects invalid or reversed query date ranges before building an upstream URL', () => {
    for (const value of [
      { from: '2026-08-31', to: '2026-08-01' },
      { from: '2026-02-29', to: '2026-03-01' },
    ]) {
      const input = kledoQueryInputSchema.parse({
        entity: 'sales_invoice',
        filters: [{ field: 'transactionDate', op: 'between', value }],
      })
      expect(() => applyQueryOptions(input, new URL('https://example.test/invoices'))).toThrow(
        'Unsupported sales_invoice filter: transactionDate between',
      )
    }
  })
})
