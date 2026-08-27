import { createServer, type RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import { createKledoHttpGateway } from '../../src/kledo/http-gateway.js'
import { createKledoMcpServer } from '../../src/server/create-server.js'

const traceEnabled = process.env.KLEDO_TEST_TRACE === '1'

function traceStep(label: string, detail: string): void {
  if (!traceEnabled) return
  process.stdout.write(`[trace] ${label.padEnd(18)} ${detail}\n`)
}

describe('kledo_report item price analysis', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  async function connectClient(handler: RequestListener): Promise<Client> {
    const upstream = createServer(handler)
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    const { port } = upstream.address() as AddressInfo
    closeables.push({
      close: () =>
        new Promise<void>((resolve, reject) =>
          upstream.close((error) => (error ? reject(error) : resolve())),
        ),
    })

    const gateway = createKledoHttpGateway({
      baseUrl: new URL(`http://127.0.0.1:${port}/api/v1/`),
      token: 'fixture-secret',
      tenant: 'fixture-tenant',
      allowInsecureLoopback: true,
      now: () => new Date('2026-08-27T01:00:00.000Z'),
    })
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
    return client
  }

  it('fails safely when a product name matches multiple SKUs', async () => {
    const requestedUrls: string[] = []
    const client = await connectClient((request, response) => {
      requestedUrls.push(request.url ?? '')
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          data: {
            current_page: 1,
            last_page: 1,
            per_page: 100,
            total: 2,
            data: [
              { id: 51, code: 'PAINT-A', name: 'Fixture Weather Interior' },
              { id: 52, code: 'PAINT-B', name: 'Fixture Weather Exterior' },
            ],
          },
        }),
      )
    })

    const result = await client.callTool({
      name: 'kledo_report',
      arguments: {
        report: 'item_price_analysis',
        productName: 'Fixture Weather',
        period: { from: '2026-08-01', to: '2026-08-31' },
      },
    })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('AMBIGUOUS')
    expect(JSON.stringify(result)).not.toContain('PAINT-A')
    expect(JSON.stringify(result)).not.toContain('PAINT-B')
    expect(requestedUrls).toEqual([
      '/api/v1/finance/products?search=Fixture+Weather&include_archive=0&per_page=100&page=1',
    ])
  })

  it('keeps catalog prices, latest transaction prices, and period margin distinct', async () => {
    const requestedUrls: string[] = []
    const client = await connectClient((request, response) => {
      requestedUrls.push(request.url ?? '')
      const url = new URL(request.url ?? '/', 'http://fixture.invalid')
      const sourceLabel = new Map([
        ['/api/v1/finance/products', 'resolve one exact SKU'],
        ['/api/v1/finance/products/51', 'read catalog prices and product flags'],
        ['/api/v1/finance/products/last_prices', 'read latest sold unit price'],
        ['/api/v1/finance/products/last_buy_prices', 'read latest purchased unit price'],
        [
          '/api/v1/finance/products/51/transactions',
          'corroborate latest Purchase Invoice date',
        ],
        ['/api/v1/finance/products/51/profitability', 'read period sales, HPP, and margin'],
      ]).get(url.pathname)
      if (sourceLabel) traceStep('Kledo fixture API', sourceLabel)
      response.setHeader('content-type', 'application/json')

      if (url.pathname === '/api/v1/finance/products') {
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
                company_name: null,
              },
            },
          }),
        )
        return
      }
      if (url.pathname === '/api/v1/finance/products/last_prices') {
        response.end(
          JSON.stringify({
            success: true,
            data: [{ id: 51, last_sell_price: '140000.00', last_sell_price_contact: null }],
          }),
        )
        return
      }
      if (url.pathname === '/api/v1/finance/products/last_buy_prices') {
        response.end(
          JSON.stringify({
            success: true,
            data: {
              51: { last_buy_price: '88000.00', last_buy_price_contact: 7 },
            },
          }),
        )
        return
      }
      if (url.pathname === '/api/v1/finance/products/51/transactions') {
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
        response.end(
          JSON.stringify({
            success: true,
            data: {
              product_id: 51,
              qty: '10',
              total_sales: '1400000.00',
              total_hpp: '880000.00',
              product: {
                id: 51,
                name: 'Fixture Paint',
                code: 'PAINT-EXACT',
                avg_base_price: '95000.00',
                is_track: 1,
                bundle_type_id: 0,
              },
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

      response.statusCode = 404
      response.end(JSON.stringify({ success: false }))
    })

    traceStep('MCP client', 'kledo_report(report=item_price_analysis, exact productCode)')
    const result = await client.callTool({
      name: 'kledo_report',
      arguments: {
        report: 'item_price_analysis',
        productCode: 'PAINT-EXACT',
        period: { from: '2026-08-01', to: '2026-08-31' },
        profitabilityMethod: 'inventory',
      },
    })

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toEqual({
      report: 'item_price_analysis',
      parameters: {
        productSelector: { code: 'PAINT-EXACT' },
        period: { from: '2026-08-01', to: '2026-08-31' },
        profitabilityMethod: 'inventory',
      },
      data: {
        product: {
          id: '51',
          code: 'PAINT-EXACT',
          name: 'Fixture Paint',
          unit: { id: '3', name: 'Can' },
          canSell: true,
          canPurchase: true,
          tracked: true,
        },
        catalogPrices: {
          salePrice: { amount: '150000.00', currency: null },
          basePurchasePrice: { amount: '90000.00', currency: null },
          averageInventoryCost: { amount: '95000.00', currency: null },
        },
        latestTransactionPrices: {
          soldUnitPrice: { amount: '140000.00', currency: null },
          soldTransactionDate: '2026-08-25',
          purchasedUnitPrice: { amount: '88000.00', currency: null },
          purchaseTransactionDate: '2026-08-20',
        },
        profitability: {
          soldQuantity: '10',
          totalSales: { amount: '1400000.00', currency: null },
          totalCostOfGoodsSold: { amount: '880000.00', currency: null },
          grossProfit: { amount: '520000.00', currency: null },
          grossMarginPercent: '37.142857',
          averageSoldUnitPrice: { amount: '140000.00', currency: null },
          averageCostOfGoodsSoldPerUnit: { amount: '88000.00', currency: null },
        },
      },
      provenance: {
        productResolution: '/finance/products',
        catalogPrices: '/finance/products/:id',
        latestSoldUnitPrice: '/finance/products/last_prices',
        latestPurchasedUnitPrice: '/finance/products/last_buy_prices',
        latestPurchaseTransaction: '/finance/products/:id/transactions',
        profitability: '/finance/products/:id/profitability',
      },
      meta: {
        fetchedAt: '2026-08-27T01:00:00.000Z',
        tenant: 'fixture-tenant',
        source: 'kledo_semantic_adapter',
        complete: true,
        warnings: [
          'Catalog prices are product settings; they are not evidence of a completed sale or purchase.',
          "The latest purchase date is corroborated against Kledo's product transactions filtered to Purchase Invoices.",
          "Period profitability uses Kledo's product profitability and HPP calculation for the requested method.",
        ],
      },
    })
    expect(JSON.stringify(result)).not.toContain('Private fixture customer')
    traceStep(
      'MCP result',
      'catalog | latest sell | latest purchase | period profitability kept distinct',
    )
    expect(requestedUrls[0]).toBe(
      '/api/v1/finance/products?search=PAINT-EXACT&include_archive=0&per_page=100&page=1',
    )
    expect(requestedUrls.slice(1).sort()).toEqual([
      '/api/v1/finance/products/51',
      '/api/v1/finance/products/last_prices?ids=51',
      '/api/v1/finance/products/last_buy_prices?ids=51',
      '/api/v1/finance/products/51/transactions?trans_type_ids=3&sort_by=trans_date&order_by=desc&per_page=100&page=1',
      '/api/v1/finance/products/51/profitability?date_from=2026-08-01&date_to=2026-08-31&method=inventory',
    ].sort())
  })
})
