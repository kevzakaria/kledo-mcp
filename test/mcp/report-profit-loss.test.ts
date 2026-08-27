import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import { createKledoHttpGateway } from '../../src/kledo/http-gateway.js'
import { createKledoMcpServer } from '../../src/server/create-server.js'

describe('kledo_report profit and loss', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  it('calls the native report with canonical period parameters and structured output', async () => {
    const upstream = createServer((request, response) => {
      if (
        request.url !==
          '/api/v1/reportings/profitLoss?date_from=2026-08-01&date_to=2026-08-31&type=custom&custom_compare_date_from=2026-07-01&custom_compare_date_to=2026-07-31' ||
        request.headers.authorization !== 'Bearer fixture-secret'
      ) {
        response.writeHead(404).end()
        return
      }

      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          message: 'Report generated',
          data: {
            total: {
              trading_income: '125000000.00',
              cost_of_sales: '75000000.00',
              gross_profit: '50000000.00',
            },
            accounts: [
              {
                id: 401,
                name: 'Fixture revenue',
                ref_code: '4-10000',
                net: '125000000.00',
              },
            ],
          },
          _cache_meta: {
            cached_at: 1787792300,
            cached_at_iso: '2026-08-27T00:58:20Z',
            from_cache: true,
            cache_age_seconds: 100,
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

    const result = await client.callTool({
      name: 'kledo_report',
      arguments: {
        report: 'profit_loss',
        period: { from: '2026-08-01', to: '2026-08-31' },
        comparePeriod: { from: '2026-07-01', to: '2026-07-31' },
      },
    })

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toEqual({
      report: 'profit_loss',
      parameters: {
        period: { from: '2026-08-01', to: '2026-08-31' },
        comparePeriod: { from: '2026-07-01', to: '2026-07-31' },
      },
      data: {
        total: {
          trading_income: '125000000.00',
          cost_of_sales: '75000000.00',
          gross_profit: '50000000.00',
        },
        accounts: [
          {
            id: 401,
            name: 'Fixture revenue',
            ref_code: '4-10000',
            net: '125000000.00',
          },
        ],
      },
      meta: {
        fetchedAt: '2026-08-27T01:00:00.000Z',
        tenant: 'fixture-tenant',
        source: 'kledo_native_report',
        complete: true,
        warnings: ['Kledo returned cached report data (100 seconds old)'],
      },
    })
  })

  it('rejects a missing period before making an upstream request', async () => {
    let requestCount = 0
    const upstream = createServer((_request, response) => {
      requestCount += 1
      response.writeHead(500).end()
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

    const result = await client.callTool({
      name: 'kledo_report',
      arguments: { report: 'profit_loss' },
    })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('period')
    expect(requestCount).toBe(0)
  })

  it('rejects report-incompatible parameters before making an upstream request', async () => {
    let requestCount = 0
    const upstream = createServer((_request, response) => {
      requestCount += 1
      response.writeHead(500).end()
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

    const result = await client.callTool({
      name: 'kledo_report',
      arguments: {
        report: 'executive_summary',
        month: '2026-08',
        period: { from: '2026-08-01', to: '2026-08-31' },
      },
    })

    expect(result.isError).toBe(true)
    expect(requestCount).toBe(0)
  })
})
