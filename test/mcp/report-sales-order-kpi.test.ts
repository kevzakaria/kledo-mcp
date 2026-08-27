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
  process.stdout.write(`[trace] ${label.padEnd(20)} ${detail}\n`)
}

function orderRow(id: number) {
  return {
    id,
    trans_type_id: 6,
    trans_date: '2026-08-15',
    status_id: 5 + ((id - 1) % 3),
    sales_id: 7,
    contact: {
      id: 9000 + id,
      company: `Private fixture customer ${id}`,
    },
  }
}

describe('kledo_report sales order KPI', () => {
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

  it('sums every page-level Sales Order aggregate exactly for one salesperson', async () => {
    const requestedUrls: string[] = []
    const client = await connectClient((request, response) => {
      requestedUrls.push(request.url ?? '')
      const url = new URL(request.url ?? '/', 'http://fixture.invalid')
      response.setHeader('content-type', 'application/json')

      if (url.pathname === '/api/v1/users') {
        traceStep('Kledo fixture API', 'resolve exact salesperson name to ID')
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

      if (url.pathname === '/api/v1/finance/orders') {
        const page = Number(url.searchParams.get('page'))
        traceStep('Kledo fixture API', `Sales Order aggregate page ${page} of 2`)
        const firstPage = page === 1
        response.end(
          JSON.stringify({
            success: true,
            data: {
              current_page: page,
              last_page: 2,
              per_page: 100,
              total: 101,
              from: firstPage ? 1 : 101,
              to: firstPage ? 100 : 101,
              data: firstPage
                ? Array.from({ length: 100 }, (_, index) => orderRow(index + 1))
                : [orderRow(101)],
              grand_subtotal: firstPage
                ? {
                    qty: '100.25',
                    amount: '1000.10',
                    amount_after_tax: '1110.11',
                    due: '600.00',
                    unbilled_amount: '400.00',
                  }
                : {
                    qty: '1.5',
                    amount: '20.20',
                    amount_after_tax: '22.42',
                    due: '10.00',
                    unbilled_amount: '5.05',
                  },
            },
          }),
        )
        return
      }

      response.statusCode = 404
      response.end(JSON.stringify({ success: false }))
    })

    traceStep('MCP client', 'kledo_report(report=sales_order_kpi)')
    const result = await client.callTool({
      name: 'kledo_report',
      arguments: {
        report: 'sales_order_kpi',
        period: { from: '2026-08-01', to: '2026-08-31' },
        salesPersonName: 'Fixture Seller',
      },
    })

    expect(result.isError, JSON.stringify(result)).not.toBe(true)
    expect(requestedUrls).toEqual([
      '/api/v1/users',
      '/api/v1/finance/orders?trans_type_ids=6&status_ids=5%2C6%2C7&date_from=2026-08-01&date_to=2026-08-31&sales_id=7&per_page=100&page=1',
      '/api/v1/finance/orders?trans_type_ids=6&status_ids=5%2C6%2C7&date_from=2026-08-01&date_to=2026-08-31&sales_id=7&per_page=100&page=2',
    ])
    expect(result.structuredContent).toEqual({
      report: 'sales_order_kpi',
      parameters: {
        period: { from: '2026-08-01', to: '2026-08-31' },
        dateBasis: 'trans_date',
        salesperson: { id: '7', name: 'Fixture Seller' },
        statusPolicy: {
          name: 'booked',
          includedStatusIds: ['5', '6', '7'],
        },
      },
      data: {
        orderCount: 101,
        orderedQuantity: '101.75',
        netBookedOrderValue: { amount: '1020.30', currency: null },
        grossBookedOrderValue: { amount: '1132.53', currency: null },
        openOrderBacklog: { amount: '405.05', currency: null },
      },
      provenance: {
        orders: '/finance/orders',
        transactionType: { id: '6', label: 'Sales Order' },
        aggregateFields: {
          orderedQuantity: 'grand_subtotal.qty',
          netBookedOrderValue: 'grand_subtotal.amount',
          grossBookedOrderValue: 'grand_subtotal.amount_after_tax',
          openOrderBacklog: 'grand_subtotal.unbilled_amount',
        },
        aggregateScope: 'sum_of_all_page_grand_subtotals',
      },
      meta: {
        fetchedAt: '2026-08-27T01:00:00.000Z',
        tenant: 'fixture-tenant',
        source: 'kledo_semantic_adapter',
        complete: true,
        warnings: [
          'Booked order value is order intake; it is not revenue, invoice value, or collected cash.',
          'Open order backlog is Kledo unbilled order value; it is not accounts receivable.',
        ],
      },
    })
  })

  it('rejects an order outside the bounded period instead of returning a misleading KPI', async () => {
    const client = await connectClient((request, response) => {
      const url = new URL(request.url ?? '/', 'http://fixture.invalid')
      response.setHeader('content-type', 'application/json')
      if (url.pathname !== '/api/v1/finance/orders') {
        response.statusCode = 404
        response.end(JSON.stringify({ success: false }))
        return
      }
      response.end(
        JSON.stringify({
          success: true,
          data: {
            current_page: 1,
            last_page: 1,
            per_page: 100,
            total: 1,
            data: [{ ...orderRow(1), trans_date: '2026-07-31' }],
            grand_subtotal: {
              qty: '1',
              amount: '10.00',
              amount_after_tax: '11.10',
              due: '0.00',
              unbilled_amount: '0.00',
            },
          },
        }),
      )
    })

    const result = await client.callTool({
      name: 'kledo_report',
      arguments: {
        report: 'sales_order_kpi',
        period: { from: '2026-08-01', to: '2026-08-31' },
        salesPersonId: '7',
      },
    })

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({
          code: 'SCHEMA_MISMATCH',
          message: 'Kledo returned Sales Orders outside the requested KPI scope',
          retryable: false,
        }),
      },
    ])
  })
})
