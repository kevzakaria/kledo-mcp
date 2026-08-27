import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import { createKledoHttpGateway } from '../../src/kledo/http-gateway.js'
import { createKledoMcpServer } from '../../src/server/create-server.js'

describe('kledo_report native paginated catalog', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  it('maps every paginated report and returns bounded native rows', async () => {
    const requestedUrls: string[] = []
    const upstream = createServer((request, response) => {
      requestedUrls.push(request.url ?? '')
      const url = new URL(request.url ?? '/', 'http://fixture.local')
      const path = url.pathname
      const page = Number(url.searchParams.get('page') ?? '1')
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          data: {
            current_page: page,
            last_page: 2,
            per_page: 2,
            total: 3,
            data:
              page === 1
                ? [
                    { fixture: path, amount: '1000.00' },
                    { fixture: path, amount: '2000.00' },
                  ]
                : [{ fixture: path, amount: '3000.00' }],
          },
        }),
      )
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
      token: 'fixture-secret',
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

    const cases = [
      {
        input: {
          report: 'aged_receivable',
          asOf: '2026-08-31',
          warehouseIds: ['2', '3'],
          salesPersonIds: ['7'],
          pageSize: 2,
        },
        url:
          '/api/v1/reportings/agedReceivable?date=2026-08-31&per_page=2&page=1&warehouse_id=2%2C3&sales_id=7',
      },
      {
        input: {
          report: 'aged_payable',
          asOf: '2026-08-31',
          warehouseIds: ['2'],
          pageSize: 2,
        },
        url:
          '/api/v1/reportings/agedPayable?date=2026-08-31&per_page=2&page=1&warehouse_id=2',
      },
      {
        input: {
          report: 'sales_by_product',
          period: { from: '2026-08-01', to: '2026-08-31' },
          productIds: ['5', '6'],
          contactIds: ['44'],
          warehouseIds: ['2'],
          salesPersonIds: ['7'],
          limit: 2,
        },
        url:
          '/api/v1/reportings/salesPerProduct?date_from=2026-08-01&date_to=2026-08-31&product_ids=5%2C6&per_page=2&page=1&warehouse_id=2&sales_id=7&contacts_id=44',
      },
      {
        input: {
          report: 'income_by_customer',
          period: { from: '2026-08-01', to: '2026-08-31' },
          contactIds: ['44'],
          groupIds: ['9'],
          warehouseIds: ['2'],
          salesPersonIds: ['7'],
          limit: 2,
        },
        url:
          '/api/v1/reportings/incomePerCustomer?date_from=2026-08-01&date_to=2026-08-31&per_page=2&page=1&warehouse_id=2&sales_id=7&group_ids=9&contact_ids=44',
      },
    ] as const

    let agedReceivableCursor = ''
    for (const testCase of cases) {
      const result = await client.callTool({
        name: 'kledo_report',
        arguments: testCase.input,
      })
      expect(result.isError, testCase.input.report).not.toBe(true)
      expect(result.structuredContent, testCase.input.report).toMatchObject({
        report: testCase.input.report,
        data: [
          { fixture: testCase.url.split('?')[0], amount: '1000.00' },
          { fixture: testCase.url.split('?')[0], amount: '2000.00' },
        ],
        pageInfo: {
          nextCursor: expect.any(String),
          hasMore: true,
          total: 3,
        },
        meta: { complete: false, source: 'kledo_native_report' },
      })
      if (testCase.input.report === 'aged_receivable') {
        agedReceivableCursor = (
          result.structuredContent as { pageInfo: { nextCursor: string } }
        ).pageInfo.nextCursor
      }
    }

    expect(requestedUrls).toEqual(cases.map((testCase) => testCase.url))

    const secondPage = await client.callTool({
      name: 'kledo_report',
      arguments: {
        report: 'aged_receivable',
        asOf: '2026-08-31',
        warehouseIds: ['2', '3'],
        salesPersonIds: ['7'],
        pageSize: 2,
        cursor: agedReceivableCursor,
      },
    })
    expect(secondPage.isError).not.toBe(true)
    expect(secondPage.structuredContent).toMatchObject({
      pageInfo: { hasMore: false, total: 3 },
      meta: { complete: true },
    })
    expect(requestedUrls.at(-1)).toBe(
      '/api/v1/reportings/agedReceivable?date=2026-08-31&per_page=2&page=2&warehouse_id=2%2C3&sales_id=7',
    )
  })
})
