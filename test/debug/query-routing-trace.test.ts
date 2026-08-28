import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import { createKledoHttpGateway } from '../../src/kledo/http-gateway.js'
import { createKledoMcpServer } from '../../src/server/create-server.js'

const trace = (message: string): void => {
  if (process.env.KLEDO_TEST_TRACE === '1') console.log(`[query-routing] ${message}`)
}

describe('Kledo query routing contract', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  it('replays the Sales Order, Invoice, and Product list queries through MCP', async () => {
    const requestedUrls: string[] = []
    const upstream = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://fixture.local')
      requestedUrls.push(request.url ?? '')
      response.setHeader('content-type', 'application/json')

      const documents = {
        '/api/v1/finance/orders': {
          id: 601,
          ref_number: 'SO/FIXTURE/001',
          trans_date: '2026-08-27',
          due_date: '2026-08-27',
          contact: { id: 44, name: 'Fixture Customer', company: 'PT Fixture' },
          amount_after_tax: '125000.00',
          due: '0.00',
          unbilled_amount: '125000.00',
          status_id: 2,
        },
        '/api/v1/finance/invoices': {
          id: 701,
          ref_number: 'INV/FIXTURE/001',
          trans_date: '2026-08-27',
          due_date: '2026-09-27',
          contact: { id: 44, name: 'Fixture Customer', company: 'PT Fixture' },
          amount_after_tax: '150000.00',
          due: '150000.00',
          status_id: 1,
        },
      } as const

      if (url.pathname in documents) {
        const item = documents[url.pathname as keyof typeof documents]
        response.end(
          JSON.stringify({
            success: true,
            data: {
              current_page: 1,
              last_page: 1,
              per_page: 100,
              total: 1,
              data: [item],
            },
          }),
        )
        return
      }

      if (url.pathname === '/api/v1/finance/products') {
        response.end(
          JSON.stringify({
            success: true,
            data: {
              current_page: 1,
              last_page: 1,
              per_page: 5,
              total: 1,
              data: [
                {
                  id: 801,
                  code: 'MAT-FIXTURE-001',
                  name: 'Fixture Material',
                  is_sell: 1,
                  is_purchase: 1,
                  is_track: 1,
                  is_archive: 0,
                },
              ],
            },
          }),
        )
        return
      }

      response.writeHead(404).end(JSON.stringify({ success: false }))
    })
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
      token: 'synthetic-query-routing-token',
      allowInsecureLoopback: true,
      now: () => new Date('2026-08-27T01:00:00.000Z'),
    })
    const client = new Client(
      { name: 'kledo-query-routing-test', version: '0.1.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    )
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = serveStdio(() => createKledoMcpServer({ gateway }), {
      legacy: 'reject',
      transport: serverTransport,
    })
    closeables.push(client, server)
    await client.connect(clientTransport)

    const periodFilter = {
      field: 'transactionDate',
      op: 'between',
      value: { from: '2025-08-27', to: '2026-08-27' },
    }

    trace('MCP sales_order -> finance/orders')
    const salesOrders = await client.callTool({
      name: 'kledo_query',
      arguments: { entity: 'sales_order', filters: [periodFilter], pageSize: 100 },
    })
    expect(salesOrders.isError).not.toBe(true)
    expect(salesOrders.structuredContent).toMatchObject({
      entity: 'sales_order',
      items: [{ id: '601', reference: 'SO/FIXTURE/001' }],
      pageInfo: { hasMore: false, total: 1 },
    })

    trace('MCP sales_invoice -> finance/invoices')
    const invoices = await client.callTool({
      name: 'kledo_query',
      arguments: { entity: 'sales_invoice', filters: [periodFilter], pageSize: 100 },
    })
    expect(invoices.isError).not.toBe(true)
    expect(invoices.structuredContent).toMatchObject({
      entity: 'sales_invoice',
      items: [{ id: '701', reference: 'INV/FIXTURE/001' }],
      pageInfo: { hasMore: false, total: 1 },
    })

    trace('MCP product -> finance/products')
    const products = await client.callTool({
      name: 'kledo_query',
      arguments: {
        entity: 'product',
        filters: [{ field: 'archived', op: 'eq', value: false }],
        pageSize: 5,
      },
    })
    expect(products.isError).not.toBe(true)
    expect(products.structuredContent).toMatchObject({
      entity: 'product',
      items: [{ id: '801', code: 'MAT-FIXTURE-001', name: 'Fixture Material' }],
      pageInfo: { hasMore: false, total: 1 },
    })

    expect(requestedUrls).toEqual([
      '/api/v1/finance/orders?date_from=2025-08-27&date_to=2026-08-27&per_page=100&page=1',
      '/api/v1/finance/invoices?date_from=2025-08-27&date_to=2026-08-27&per_page=100&page=1',
      '/api/v1/finance/products?include_archive=0&per_page=5',
    ])
  })
})
