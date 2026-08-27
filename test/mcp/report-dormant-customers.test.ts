import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import { createKledoHttpGateway } from '../../src/kledo/http-gateway.js'
import { createKledoMcpServer } from '../../src/server/create-server.js'

const traceEnabled = process.env.KLEDO_TEST_TRACE === '1'

function traceStep(label: string, detail: string): void {
  if (!traceEnabled) return
  process.stdout.write(`[trace] ${label.padEnd(16)} ${detail}\n`)
}

describe('kledo_report dormant customers', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  it('finds historical customers absent from the inactivity window', async () => {
    const requestedUrls: string[] = []
    const diagnostics: string[] = []
    const upstream = createServer((request, response) => {
      const requestUrl = request.url ?? ''
      requestedUrls.push(requestUrl)
      const url = new URL(requestUrl, 'http://fixture.local')
      const historical = url.searchParams.get('date_to') === '2026-05-29'
      const upstreamPage = Number(url.searchParams.get('page') ?? '1')
      traceStep(
        'Kledo API',
        historical
          ? `historical income window page ${upstreamPage} requested`
          : 'recent income window requested',
      )
      const fillerRows = Array.from({ length: 98 }, (_, index) => {
        const id = 1000 + index
        return {
          contact_id: id,
          amount: '50.00',
          total_transactions: 1,
          contact: { id, name: `Filler ${index + 1}`, company: null },
        }
      })
      const historicalRows = [
        {
          contact_id: 101,
          amount: '3000.00',
          total_transactions: 3,
          contact: { id: 101, name: 'Ari', company: 'Alpha Fixture' },
        },
        {
          contact_id: 202,
          amount: '2000.00',
          total_transactions: 2,
          contact: { id: 202, name: 'Bela', company: 'Beta Fixture' },
        },
        ...fillerRows,
        {
          contact_id: 303,
          amount: '1000.00',
          total_transactions: 1,
          contact: { id: 303, name: null, company: 'Gamma Fixture' },
        },
      ]
      const recentRows = [
        {
          contact_id: 202,
          amount: '500.00',
          total_transactions: 1,
          contact: { id: 202, name: 'Bela', company: 'Beta Fixture' },
        },
        ...fillerRows,
      ]
      const allRows = historical ? historicalRows : recentRows
      const rows = allRows.slice((upstreamPage - 1) * 100, upstreamPage * 100)

      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          data: {
            current_page: upstreamPage,
            last_page: historical ? 2 : 1,
            per_page: 100,
            total: allRows.length,
            data: rows,
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
      now: () => new Date('2026-08-27T10:00:00.000Z'),
      diagnostic: ({ event }) => {
        diagnostics.push(event)
        traceStep('MCP adapter', event)
      },
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

    traceStep('MCP client', 'kledo_report(report="dormant_customers")')
    const firstPage = await client.callTool({
      name: 'kledo_report',
      arguments: {
        report: 'dormant_customers',
        asOf: '2026-08-27',
        inactiveDays: 90,
        historyDays: 365,
        pageSize: 1,
      },
    })

    expect(firstPage.isError).not.toBe(true)
    expect(firstPage.structuredContent).toMatchObject({
      report: 'dormant_customers',
      parameters: {
        asOf: '2026-08-27',
        inactiveDays: 90,
        historyDays: 365,
        inactivityCutoff: '2026-05-29',
        historicalPeriod: { from: '2025-05-30', to: '2026-05-29' },
        recentPeriod: { from: '2026-05-30', to: '2026-08-27' },
        pageSize: 1,
      },
      data: {
        candidates: [
          {
            customer: {
              id: '101',
              displayName: 'Alpha Fixture',
              companyName: 'Alpha Fixture',
              personName: 'Ari',
            },
            historicalIncome: { amount: '3000.00', currency: null },
            historicalTransactionCount: 3,
          },
        ],
      },
      pageInfo: {
        nextCursor: expect.any(String),
        hasMore: true,
        total: 2,
      },
      meta: {
        source: 'kledo_native_report',
        complete: false,
        warnings: expect.arrayContaining([
          expect.stringMatching(/not proof.*relationship.*ended/i),
          expect.stringMatching(/exact last.*date.*unavailable/i),
          expect.stringMatching(/contact status.*outreach/i),
        ]),
      },
    })
    expect(firstPage.structuredContent).not.toHaveProperty(
      'data.candidates.0.lastPurchaseDate',
    )
    traceStep('MCP result', '2 candidates; active/contact consent remains human-reviewed')

    expect(requestedUrls).toEqual([
      '/api/v1/reportings/incomePerCustomer?date_from=2025-05-30&date_to=2026-05-29&per_page=100&page=1',
      '/api/v1/reportings/incomePerCustomer?date_from=2025-05-30&date_to=2026-05-29&per_page=100&page=2',
      '/api/v1/reportings/incomePerCustomer?date_from=2026-05-30&date_to=2026-08-27&per_page=100&page=1',
    ])

    const cursor = (firstPage.structuredContent as { pageInfo: { nextCursor: string } })
      .pageInfo.nextCursor
    const secondPage = await client.callTool({
      name: 'kledo_report',
      arguments: {
        report: 'dormant_customers',
        asOf: '2026-08-27',
        inactiveDays: 90,
        historyDays: 365,
        pageSize: 1,
        cursor,
      },
    })

    expect(secondPage.isError).not.toBe(true)
    expect(secondPage.structuredContent).toMatchObject({
      data: {
        candidates: [
          {
            customer: { id: '303', displayName: 'Gamma Fixture' },
            historicalIncome: { amount: '1000.00', currency: null },
            historicalTransactionCount: 1,
          },
        ],
      },
      pageInfo: { hasMore: false, total: 2 },
      meta: { complete: true },
    })
    expect(requestedUrls).toHaveLength(6)
    expect(diagnostics).toEqual([
      'report.dormant_customers.historical.request',
      'report.dormant_customers.historical.request',
      'report.dormant_customers.recent.request',
      'report.dormant_customers.historical.request',
      'report.dormant_customers.historical.request',
      'report.dormant_customers.recent.request',
    ])
    traceStep('DONE', 'two windows, ranking, warnings, and local cursor verified')
  })
})
