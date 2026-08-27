import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import { createKledoHttpGateway } from '../../src/kledo/http-gateway.js'
import { createKledoMcpServer } from '../../src/server/create-server.js'

describe('kledo_report native non-paginated catalog', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  it('maps every non-paginated public report to its exact allowlisted GET endpoint', async () => {
    const requests: Array<{ method?: string; url?: string; authorization?: string }> = []
    const upstream = createServer((request, response) => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
      })
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          data: { fixture: new URL(request.url ?? '/', 'http://fixture.local').pathname },
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
        input: { report: 'executive_summary', month: '2026-08' },
        url: '/api/v1/reportings/executiveSummary?month=2026-08',
      },
      {
        input: {
          report: 'balance_sheet',
          asOf: '2026-08-31',
          comparison: { interval: 'monthly', periods: 2 },
        },
        url: '/api/v1/reportings/balanceSheet?date=2026-08-31&type=monthly&compare=2',
      },
      {
        input: {
          report: 'cash_flow',
          period: { from: '2026-08-01', to: '2026-08-31' },
          method: 'direct',
        },
        url: '/api/v1/reportings/cashFlow?method=direct&date_from=2026-08-01&date_to=2026-08-31',
      },
      {
        input: {
          report: 'bank_summary',
          period: { from: '2026-08-01', to: '2026-08-31' },
        },
        url: '/api/v1/reportings/bankSummary?date_from=2026-08-01&date_to=2026-08-31',
      },
      {
        input: {
          report: 'sales_by_period',
          period: { from: '2026-08-01', to: '2026-08-31' },
          interval: 'month',
          unitId: '1',
          contactIds: ['44', '45'],
          warehouseIds: ['2'],
          salesPersonIds: ['7'],
        },
        url:
          '/api/v1/reportings/salesPerPeriod?unit_id=1&daterange=monthly&custom_daterange=1&date_from=2026-08-01&date_to=2026-08-31&warehouse_id=2&contacts_id=44%2C45&sales_id=7',
      },
      {
        input: {
          report: 'purchases_by_period',
          period: { from: '2026-08-01', to: '2026-08-31' },
          interval: 'day',
          unitId: '1',
        },
        url:
          '/api/v1/reportings/purchasesPerPeriod?unit_id=1&daterange=daily&custom_daterange=1&date_from=2026-08-01&date_to=2026-08-31',
      },
    ] as const

    for (const testCase of cases) {
      const result = await client.callTool({
        name: 'kledo_report',
        arguments: testCase.input,
      })
      expect(result.isError, testCase.input.report).not.toBe(true)
      expect(result.structuredContent, testCase.input.report).toMatchObject({
        report: testCase.input.report,
        data: { fixture: testCase.url.split('?')[0] },
        meta: {
          source: 'kledo_native_report',
          complete: true,
          warnings: [],
        },
      })
    }

    expect(requests).toEqual(
      cases.map((testCase) => ({
        method: 'GET',
        url: testCase.url,
        authorization: 'Bearer fixture-secret',
      })),
    )
  })
})
