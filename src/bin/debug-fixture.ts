#!/usr/bin/env node

import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { serveStdio } from '@modelcontextprotocol/server/stdio'

import { createKledoHttpGateway } from '../kledo/http-gateway.js'
import { createKledoMcpServer } from '../server/create-server.js'
import { createKledoStdioTransport } from '../server/stdio-transport.js'

const debugEvent = (event: string): void => {
  process.stderr.write(`[kledo-debug] ${event}\n`)
}

const fixturePrintLocator = 'fixture-print-locator'
const fixturePdf = Buffer.from(
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAzMDAgMjAwXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA1MiA+PgpzdHJlYW0KQlQgL0YxIDE4IFRmIDMwIDEwMCBUZCAoS2xlZG8gUERGIGZpeHR1cmUpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwMzM5IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNDA5CiUlRU9GCg==',
  'base64',
)

const receivableDue = (
  values: Partial<Record<'-3' | '-2' | '-1' | '0' | '1' | '2' | '3' | '4', string>>,
) => ({
  '-3': '0.00',
  '-2': '0.00',
  '-1': '0.00',
  '0': '0.00',
  '1': '0.00',
  '2': '0.00',
  '3': '0.00',
  '4': '0.00',
  ...values,
})

const receivableSummaryDue = (
  values: Partial<Record<'-2' | '-1' | '0' | '1' | '2' | '3' | '4', string>>,
) => {
  const { '-3': _invoiceAmount, ...summary } = receivableDue(values)
  return summary
}

const upstream = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://fixture.local')
  response.setHeader('content-type', 'application/json')

  if (url.pathname === '/api/v1/users') {
    debugEvent('upstream.users requested')
    response.end(
      JSON.stringify({
        success: true,
        data: [
          {
            id: 7,
            name: 'Fixture Seller',
            email: 'private-fixture@example.invalid',
          },
        ],
      }),
    )
    return
  }

  if (url.pathname === '/api/v1/reportings/salesPerPerson') {
    debugEvent('upstream.report.sales_by_person requested')
    response.end(
      JSON.stringify({
        success: true,
        data: [
          {
            sales_id: 7,
            sales: { id: 7, name: 'Fixture Seller' },
            total_amount_after_tax: '125000000.00',
            total_count: 42,
            total_commission: '0.00',
          },
        ],
      }),
    )
    return
  }

  if (url.pathname === '/api/v1/finance/orders') {
    debugEvent('upstream.report.sales_order_kpi.orders requested')
    response.end(
      JSON.stringify({
        success: true,
        data: {
          current_page: 1,
          last_page: 1,
          per_page: 100,
          total: 2,
          data: [
            {
              id: 701,
              trans_type_id: 6,
              trans_date: '2026-08-10',
              status_id: 5,
              sales_id: 7,
            },
            {
              id: 702,
              trans_type_id: 6,
              trans_date: '2026-08-20',
              status_id: 7,
              sales_id: 7,
            },
          ],
          grand_subtotal: {
            qty: '12.5',
            amount: '2500.00',
            amount_after_tax: '2775.00',
            due: '1000.00',
            unbilled_amount: '1000.00',
          },
        },
      }),
    )
    return
  }

  if (url.pathname === '/api/v1/reportings/incomePerCustomer') {
    const historical = url.searchParams.get('date_to') === '2026-05-29'
    debugEvent(
      historical
        ? 'upstream.report.dormant_customers.historical requested'
        : 'upstream.report.dormant_customers.recent requested',
    )
    const rows = historical
      ? [
          {
            contact_id: 101,
            amount: '3000.00',
            total_transactions: 3,
            contact: { id: 101, name: 'Fixture Person', company: 'Fixture Company' },
          },
          {
            contact_id: 202,
            amount: '2000.00',
            total_transactions: 2,
            contact: { id: 202, name: 'Recent Fixture', company: null },
          },
        ]
      : [
          {
            contact_id: 202,
            amount: '500.00',
            total_transactions: 1,
            contact: { id: 202, name: 'Recent Fixture', company: null },
          },
        ]
    response.end(
      JSON.stringify({
        success: true,
        data: {
          current_page: 1,
          last_page: 1,
          per_page: 100,
          total: rows.length,
          data: rows,
        },
      }),
    )
    return
  }

  if (url.pathname === '/api/v1/reportings/agedReceivable') {
    debugEvent('upstream.report.receivable_by_invoice.customer_totals requested')
    response.end(
      JSON.stringify({
        success: true,
        data: {
          current_page: 1,
          last_page: 1,
          per_page: Number(url.searchParams.get('per_page')),
          total: 1,
          data: [
            {
              id: 44,
              name: 'Fixture Person',
              company: 'Fixture Customer Ltd',
              due: receivableSummaryDue({ '-1': '1250.00', '0': '1250.00' }),
            },
          ],
        },
      }),
    )
    return
  }

  if (url.pathname === '/api/v1/reportings/agedReceivableDetail/44') {
    debugEvent('upstream.report.receivable_by_invoice.invoice_breakdown requested')
    const totals = receivableDue({ '-3': '1500.00', '-1': '1250.00', '0': '1250.00' })
    response.end(
      JSON.stringify({
        success: true,
        data: {
          current_page: 1,
          last_page: 1,
          per_page: 100,
          total: 1,
          total_due: totals,
          contact: {
            id: 44,
            name: 'Fixture Person',
            company: 'Fixture Customer Ltd',
            email: 'private-fixture@example.invalid',
          },
          data: [
            {
              id: 501,
              trans_date: '2026-08-01',
              due_date: '2026-08-20',
              ref_number: 'INV/FIXTURE/501',
              memo: 'Fixture Project Alpha',
              due: totals,
              age_due: 7,
              age_trans: 26,
            },
          ],
        },
      }),
    )
    return
  }

  if (url.pathname === '/api/v1/finance/products') {
    debugEvent('upstream.report.item_price_analysis.product_search requested')
    response.end(
      JSON.stringify({
        success: true,
        data: {
          current_page: 1,
          last_page: 1,
          per_page: 100,
          total: 1,
          data: [{ id: 51, code: 'PAINT-EXACT', name: 'Fixture Paint' }],
        },
      }),
    )
    return
  }

  if (url.pathname === '/api/v1/finance/products/51') {
    debugEvent('upstream.report.item_price_analysis.product_detail requested')
    response.end(
      JSON.stringify({
        success: true,
        data: {
          id: 51,
          code: 'PAINT-EXACT',
          name: 'Fixture Paint',
          price: '150000.00',
          base_price: '90000.00',
          avg_base_price: '95000.00',
          is_sell: 1,
          is_purchase: 1,
          is_track: 1,
          unit: { id: 3, name: 'Can' },
          last_sale_transaction: {
            trans_date: '2026-08-25',
            contact_name: 'Private fixture customer',
          },
        },
      }),
    )
    return
  }

  if (url.pathname === '/api/v1/finance/products/last_prices') {
    debugEvent('upstream.report.item_price_analysis.latest_sell requested')
    response.end(
      JSON.stringify({
        success: true,
        data: [{ id: 51, last_sell_price: '140000.00' }],
      }),
    )
    return
  }

  if (url.pathname === '/api/v1/finance/products/last_buy_prices') {
    debugEvent('upstream.report.item_price_analysis.latest_purchase requested')
    response.end(
      JSON.stringify({
        success: true,
        data: { 51: { last_buy_price: '88000.00' } },
      }),
    )
    return
  }

  if (url.pathname === '/api/v1/finance/products/51/transactions') {
    debugEvent('upstream.report.item_price_analysis.purchase_transactions requested')
    response.end(
      JSON.stringify({
        success: true,
        data: {
          current_page: 1,
          last_page: 1,
          per_page: 100,
          total: 1,
          data: [
            {
              id: 601,
              trans_type_id: 3,
              trans_date: '2026-08-20',
              price: '88000.00',
            },
          ],
        },
      }),
    )
    return
  }

  if (url.pathname === '/api/v1/finance/products/51/profitability') {
    debugEvent('upstream.report.item_price_analysis.profitability requested')
    response.end(
      JSON.stringify({
        success: true,
        data: {
          product_id: 51,
          qty: '10',
          total_sales: '1400000.00',
          total_hpp: '880000.00',
          product: { id: 51, name: 'Fixture Paint', code: 'PAINT-EXACT' },
          total_profit: '520000.00',
          profit_margin: '37.142857',
          avg_sales: '140000.00',
          avg_hpp: '88000.00',
          method: 'inventory',
          date_from: '2026-08-01',
          date_to: '2026-08-31',
        },
      }),
    )
    return
  }

  if (
    url.pathname === '/api/v1/finance/invoices' &&
    url.searchParams.get('search') === 'INV/FIXTURE/500'
  ) {
    debugEvent('upstream.get.document_number.search requested')
    response.end(
      JSON.stringify({
        success: true,
        data: {
          current_page: 1,
          last_page: 1,
          per_page: 100,
          total: 2,
          data: [
            { id: 501, ref_number: 'INV/FIXTURE/500-OLD' },
            { id: 500, ref_number: 'INV/FIXTURE/500' },
          ],
        },
      }),
    )
    return
  }

  if (url.pathname === '/api/v1/finance/invoices/500') {
    debugEvent('upstream.get.sales_invoice.detail requested')
    response.end(
      JSON.stringify({
        success: true,
        data: {
          id: 500,
          ref_number: 'INV/FIXTURE/500',
          trans_type_id: 5,
          trans_date: '2026-08-20',
          due_date: '2026-09-20',
          shipping_date: '2026-08-19',
          contact: {
            id: 44,
            name: 'Private Fixture Person',
            company: 'Private Fixture Company',
            email: 'private-lineage@example.invalid',
          },
          amount_after_tax: '1110.00',
          due: '610.00',
          memo: 'Private Fixture Project',
          status_id: 3,
          print_url: fixturePrintLocator,
          items: [],
          parent_tran: {
            id: 300,
            ref_number: 'DO/FIXTURE/300',
            trans_type_id: 7,
          },
          relations: [
            { id: 100, ref_number: 'QU/FIXTURE/100', trans_type_id: 4 },
            { id: 200, ref_number: 'SO/FIXTURE/200', trans_type_id: 6 },
            { id: 300, ref_number: 'DO/FIXTURE/300', trans_type_id: 7 },
            {
              id: 600,
              ref_number: 'IP/FIXTURE/600',
              trans_type_id: 17,
              trans_date: '2026-08-25',
              amount_after_tax: '500.00',
            },
          ],
        },
      }),
    )
    return
  }

  if (
    url.pathname ===
    `/api/v1/finance/invoices/500/download/${fixturePrintLocator}`
  ) {
    debugEvent(`upstream.get.sales_invoice.print_document requested (${fixturePdf.byteLength} bytes)`)
    response.setHeader('content-type', 'application/pdf')
    response.setHeader('content-length', String(fixturePdf.byteLength))
    response.end(fixturePdf)
    return
  }

  if (url.pathname === '/api/v1/finance/invoices/500/transactions') {
    debugEvent('upstream.get.sales_invoice.payment_events requested')
    response.end(
      JSON.stringify({
        success: true,
        data: [
          {
            id: 600,
            business_tran_id: 500,
            trans_type_id: 17,
            trans_date: '2026-08-25',
            amount_after_tax: '500.00',
            status_id: 3,
            bank_account_id: 77,
            payment_type_id: null,
            bank_account: { id: 77, name: 'Fixture Bank' },
          },
        ],
      }),
    )
    return
  }

  if (url.pathname === '/api/v1/finance/purchaseInvoices/700') {
    debugEvent('upstream.get.purchase_invoice.detail requested')
    response.end(
      JSON.stringify({
        success: true,
        data: {
          id: 700,
          ref_number: 'PI/FIXTURE/700',
          trans_type_id: 3,
          trans_date: '2026-08-20',
          due_date: '2026-09-20',
          shipping_date: '2026-08-19',
          contact: {
            id: 44,
            name: 'Private Fixture Vendor',
            company: 'Private Fixture Supplier',
            email: 'private-purchase-lineage@example.invalid',
          },
          amount_after_tax: '1110.00',
          due: '610.00',
          memo: 'Private Fixture Purchase Project',
          status_id: 3,
          items: [],
          parent_tran: {
            id: 600,
            ref_number: 'PD/FIXTURE/600',
            trans_type_id: 8,
          },
          relations: [
            { id: 400, ref_number: 'PQ/FIXTURE/400', trans_type_id: 63 },
            { id: 500, ref_number: 'PO/FIXTURE/500', trans_type_id: 2 },
            { id: 600, ref_number: 'PD/FIXTURE/600', trans_type_id: 8 },
            {
              id: 800,
              ref_number: 'PP/FIXTURE/800',
              trans_type_id: 16,
              trans_date: '2026-08-25',
              amount_after_tax: '500.00',
            },
          ],
          transactions: [
            {
              id: 800,
              business_tran_id: 700,
              trans_type_id: 16,
              trans_date: '2026-08-25',
              amount_after_tax: '500.00',
              status_id: 3,
              bank_account_id: 77,
              payment_type_id: null,
              bank_account: { id: 77, name: 'Fixture Purchase Bank' },
            },
          ],
        },
      }),
    )
    return
  }

  if (url.pathname === '/api/v1/finance/purchaseQuotes') {
    debugEvent('upstream.query.purchase_quote requested')
    response.end(
      JSON.stringify({
        success: true,
        data: {
          current_page: 1,
          last_page: 1,
          per_page: Number(url.searchParams.get('per_page')),
          total: 1,
          data: [
            {
              id: 400,
              ref_number: 'PQ/FIXTURE/400',
              trans_type_id: 63,
              trans_date: '2026-08-10',
              due_date: '2026-09-10',
              contact: {
                id: 44,
                name: 'Private Fixture Vendor',
                company: 'Private Fixture Supplier',
                email: 'private-purchase-quote@example.invalid',
              },
              amount_after_tax: '1000.00',
              memo: 'Private Fixture Purchase Quote',
              status_id: 5,
            },
          ],
        },
      }),
    )
    return
  }

  if (url.pathname === '/api/v1/finance/purchaseQuotes/400') {
    debugEvent('upstream.get.purchase_quote.detail requested')
    response.end(
      JSON.stringify({
        success: true,
        data: {
          id: 400,
          ref_number: 'PQ/FIXTURE/400',
          trans_type_id: 63,
          trans_date: '2026-08-10',
          due_date: '2026-09-10',
          contact: {
            id: 44,
            name: 'Private Fixture Vendor',
            company: 'Private Fixture Supplier',
            email: 'private-purchase-quote@example.invalid',
          },
          amount_after_tax: '1000.00',
          memo: 'Private Fixture Purchase Quote',
          status_id: 5,
          items: [],
        },
      }),
    )
    return
  }

  response.writeHead(404).end(JSON.stringify({ success: false }))
})

await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
const { port } = upstream.address() as AddressInfo
const stateDirectory = mkdtempSync(join(tmpdir(), 'kledo-mcp-inspector-'))

const gateway = createKledoHttpGateway({
  baseUrl: new URL(`http://127.0.0.1:${port}/api/v1/`),
  token: 'synthetic-inspector-token',
  tenant: 'synthetic-inspector-tenant',
  allowInsecureLoopback: true,
  identityCatalogPath: join(stateDirectory, 'identity-catalog.sqlite'),
  diagnostic: ({ event }) => debugEvent(event),
  now: () => new Date('2026-08-27T01:00:00.000Z'),
})

debugEvent('fixture ready')

const handle = serveStdio(() => createKledoMcpServer({ gateway }), {
  legacy: 'serve',
  transport: createKledoStdioTransport(),
  onerror: () => {
    process.stderr.write('[kledo-debug] MCP transport error\n')
  },
})

let closing = false
const close = (): void => {
  if (closing) return
  closing = true
  void handle.close().finally(() => {
    upstream.close(() => {
      rmSync(stateDirectory, { recursive: true, force: true })
      process.exitCode = 0
    })
  })
}

process.once('SIGINT', close)
process.once('SIGTERM', close)
process.stdin.once('end', close)
