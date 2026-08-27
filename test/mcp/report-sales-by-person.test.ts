import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, type RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

describe('kledo_report sales by person', () => {
  const closeables: Array<{ close(): Promise<void> }> = []
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    )
  })

  async function connectClient(
    handler: RequestListener,
    options: { identityCatalogPath?: string; tenant?: string; token?: string } = {},
  ): Promise<Client> {
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
      token: options.token ?? 'fixture-secret',
      ...(options.tenant ? { tenant: options.tenant } : {}),
      allowInsecureLoopback: true,
      ...(options.identityCatalogPath
        ? { identityCatalogPath: options.identityCatalogPath }
        : {}),
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

  it('uses the native salesperson report with transaction dates and one upstream request', async () => {
    const requestedUrls: string[] = []
    const upstream = createServer((request, response) => {
      requestedUrls.push(request.url ?? '')
      response.setHeader('content-type', 'application/json')
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
        report: 'sales_by_person',
        period: { from: '2026-07-01', to: '2026-07-31' },
        salesPersonId: '7',
        pageSize: 20,
      },
    })

    expect(result.isError).not.toBe(true)
    expect(requestedUrls).toEqual([
      '/api/v1/reportings/salesPerPerson?date_from=2026-07-01&date_to=2026-07-31&date_filter=trans_date&sales_id=7',
    ])
    expect(result.structuredContent).toEqual({
      report: 'sales_by_person',
      parameters: {
        period: { from: '2026-07-01', to: '2026-07-31' },
        dateBasis: 'trans_date',
        salesperson: { id: '7', name: 'Fixture Seller' },
        pageSize: 20,
      },
      data: {
        rows: [
          {
            salesperson: { id: '7', name: 'Fixture Seller' },
            sales: { amount: '125000000.00', currency: null },
            salesCount: 42,
            commission: { amount: '0.00', currency: null },
          },
        ],
      },
      pageInfo: { hasMore: false, total: 1 },
      meta: {
        fetchedAt: '2026-08-27T01:00:00.000Z',
        tenant: 'fixture-tenant',
        source: 'kledo_native_report',
        complete: true,
        warnings: [],
      },
    })
  })

  it('adapts the current flat Kledo response and exposes sales count without calling it quantity', async () => {
    const requestedUrls: string[] = []
    const client = await connectClient(
      (request, response) => {
        requestedUrls.push(request.url ?? '')
        response.setHeader('content-type', 'application/json')
        response.end(
          JSON.stringify({
            success: true,
            data: [
              {
                sales_id: 7,
                total_amount_after_tax: 125000000,
                total_count: 3,
                total_commission: 2500000,
                sales: {
                  id: 7,
                  name: 'Fixture Seller',
                  email: 'private@example.invalid',
                },
              },
            ],
          }),
        )
      },
      { tenant: 'fixture-tenant' },
    )

    const result = await client.callTool({
      name: 'kledo_report',
      arguments: {
        report: 'sales_by_person',
        period: { from: '2026-07-01', to: '2026-07-31' },
        salesPersonId: '7',
        pageSize: 20,
      },
    })

    expect(result.isError).not.toBe(true)
    expect(requestedUrls).toEqual([
      '/api/v1/reportings/salesPerPerson?date_from=2026-07-01&date_to=2026-07-31&date_filter=trans_date&sales_id=7',
    ])
    expect(result.structuredContent).toEqual({
      report: 'sales_by_person',
      parameters: {
        period: { from: '2026-07-01', to: '2026-07-31' },
        dateBasis: 'trans_date',
        salesperson: { id: '7', name: 'Fixture Seller' },
        pageSize: 20,
      },
      data: {
        rows: [
          {
            salesperson: { id: '7', name: 'Fixture Seller' },
            sales: { amount: '125000000', currency: null },
            salesCount: 3,
            commission: { amount: '2500000', currency: null },
          },
        ],
      },
      pageInfo: { hasMore: false, total: 1 },
      meta: {
        fetchedAt: '2026-08-27T01:00:00.000Z',
        tenant: 'fixture-tenant',
        source: 'kledo_native_report',
        complete: true,
        warnings: [],
      },
    })
    expect(JSON.stringify(result)).not.toContain('private@example.invalid')
    expect(JSON.stringify(result)).not.toContain('quantity')
  })

  it('resolves a salesperson name case-insensitively and reuses the bounded cache', async () => {
    const requestedUrls: string[] = []
    const upstream = createServer((request, response) => {
      requestedUrls.push(request.url ?? '')
      response.setHeader('content-type', 'application/json')
      if (request.url === '/api/v1/users') {
        response.end(
          JSON.stringify({
            success: true,
            data: [
              { id: 7, name: 'Fixture Seller', email: 'private@example.invalid' },
              { id: 8, name: 'Another Seller', email: 'other@example.invalid' },
            ],
          }),
        )
        return
      }
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

    const call = () =>
      client.callTool({
        name: 'kledo_report',
        arguments: {
          report: 'sales_by_person',
          period: { from: '2026-07-01', to: '2026-07-31' },
          salesPersonName: '  fixture SELLER ',
          pageSize: 20,
        },
      })

    const coldResult = await call()
    expect(coldResult.isError).not.toBe(true)
    expect(requestedUrls).toEqual([
      '/api/v1/users',
      '/api/v1/reportings/salesPerPerson?date_from=2026-07-01&date_to=2026-07-31&date_filter=trans_date&sales_id=7',
    ])
    expect(coldResult.structuredContent).toMatchObject({
      parameters: { salesperson: { id: '7', name: 'Fixture Seller' } },
    })
    expect(JSON.stringify(coldResult)).not.toContain('private@example.invalid')

    const warmResult = await call()
    expect(warmResult.isError).not.toBe(true)
    expect(requestedUrls).toEqual([
      '/api/v1/users',
      '/api/v1/reportings/salesPerPerson?date_from=2026-07-01&date_to=2026-07-31&date_filter=trans_date&sales_id=7',
      '/api/v1/reportings/salesPerPerson?date_from=2026-07-01&date_to=2026-07-31&date_filter=trans_date&sales_id=7',
    ])
    expect(JSON.stringify(warmResult)).not.toContain('private@example.invalid')
  })

  it('reuses a tenant-scoped salesperson mapping after the gateway restarts', async () => {
    const requestedUrls: string[] = []
    const diagnosticEvents: string[] = []
    const upstream = createServer((request, response) => {
      requestedUrls.push(request.url ?? '')
      response.setHeader('content-type', 'application/json')
      if (request.url === '/api/v1/users') {
        traceStep('Kledo API', 'GET /users')
        response.end(
          JSON.stringify({
            success: true,
            data: [{ id: 7, name: 'Persistent Seller', email: 'private@example.invalid' }],
          }),
        )
        return
      }
      traceStep('Kledo API', `GET ${request.url ?? ''}`)
      response.end(
        JSON.stringify({
          success: true,
          data: [
            {
              sales_id: 7,
              sales: { id: 7, name: 'Persistent Seller' },
              total_amount_after_tax: '125000000.00',
              total_count: 42,
              total_commission: '0.00',
            },
          ],
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

    const stateDirectory = await mkdtemp(join(tmpdir(), 'kledo-mcp-identity-'))
    temporaryDirectories.push(stateDirectory)
    const identityCatalogPath = join(stateDirectory, 'identity-catalog.sqlite')

    const connectGateway = async (): Promise<Client> => {
      const gateway = createKledoHttpGateway({
        baseUrl: new URL(`http://127.0.0.1:${port}/api/v1/`),
        token: 'fixture-secret',
        tenant: 'fixture-tenant',
        allowInsecureLoopback: true,
        identityCatalogPath,
        diagnostic: ({ event }) => diagnosticEvents.push(event),
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

    const call = (client: Client) =>
      client.callTool({
        name: 'kledo_report',
        arguments: {
          report: 'sales_by_person',
          period: { from: '2026-07-01', to: '2026-07-31' },
          salesPersonName: 'persistent seller',
          pageSize: 20,
        },
      })

    traceStep('PHASE 1 COLD', 'new MCP process, SQLite is empty')
    traceStep('MCP client', 'kledo_report(salesPersonName="persistent seller")')
    const firstClient = await connectGateway()
    const firstResult = await call(firstClient)
    expect(firstResult.isError).not.toBe(true)
    traceStep('MCP result', 'resolved salesperson id=7')
    await firstClient.close()

    const { DatabaseSync } = await import('node:sqlite')
    const catalogDatabase = new DatabaseSync(identityCatalogPath, { readOnly: true })
    try {
      const records = catalogDatabase
        .prepare(
          `SELECT entity_type, external_id, display_name, normalized_name, active,
                  source_updated_at
           FROM identity_records`,
        )
        .all()
        .map((record) => ({ ...record }))
      expect(records).toEqual([
        {
          entity_type: 'salesperson',
          external_id: '7',
          display_name: 'Persistent Seller',
          normalized_name: 'persistent seller',
          active: 1,
          source_updated_at: null,
        },
      ])
      traceStep('SQLite write', 'stored salesperson id=7, name="Persistent Seller"')
    } finally {
      catalogDatabase.close()
    }

    const catalogBytes = await readFile(identityCatalogPath)
    expect(catalogBytes.includes(Buffer.from('private@example.invalid'))).toBe(false)
    expect(catalogBytes.includes(Buffer.from('fixture-secret'))).toBe(false)

    traceStep('PHASE 2 WARM', 'restart MCP process, reuse the same SQLite file')
    traceStep('MCP client', 'kledo_report(salesPersonName="persistent seller")')
    const secondClient = await connectGateway()
    const secondResult = await call(secondClient)
    expect(secondResult.isError).not.toBe(true)

    expect(requestedUrls).toEqual([
      '/api/v1/users',
      '/api/v1/reportings/salesPerPerson?date_from=2026-07-01&date_to=2026-07-31&date_filter=trans_date&sales_id=7',
      '/api/v1/reportings/salesPerPerson?date_from=2026-07-01&date_to=2026-07-31&date_filter=trans_date&sales_id=7',
    ])
    expect(JSON.stringify(secondResult)).not.toContain('private@example.invalid')
    traceStep('SQLite lookup', 'hit id=7; no second GET /users')
    traceStep('ASSERT', 'cold requests=2, warm requests=1')

    traceStep('PHASE 3 MISS', 'unknown name refreshes /users exactly once')
    const unknownResult = await secondClient.callTool({
      name: 'kledo_report',
      arguments: {
        report: 'sales_by_person',
        period: { from: '2026-07-01', to: '2026-07-31' },
        salesPersonName: 'new seller',
        pageSize: 20,
      },
    })
    expect(unknownResult.isError).toBe(true)
    expect(JSON.stringify(unknownResult)).toContain('NOT_FOUND')
    expect(requestedUrls).toEqual([
      '/api/v1/users',
      '/api/v1/reportings/salesPerPerson?date_from=2026-07-01&date_to=2026-07-31&date_filter=trans_date&sales_id=7',
      '/api/v1/reportings/salesPerPerson?date_from=2026-07-01&date_to=2026-07-31&date_filter=trans_date&sales_id=7',
      '/api/v1/users',
    ])
    traceStep('ASSERT', 'unknown name returned NOT_FOUND after one refresh')
    traceStep('DONE', 'restart persistence and safe refresh verified')

    expect(diagnosticEvents).toEqual([
      'identity.sqlite.snapshot_miss',
      'identity.upstream.refresh',
      'identity.sqlite.write',
      'report.sales_by_person.request',
      'identity.sqlite.hit',
      'report.sales_by_person.request',
      'identity.sqlite.name_miss',
      'identity.upstream.refresh',
      'identity.sqlite.write',
    ])
    const serializedDiagnostics = JSON.stringify(diagnosticEvents)
    expect(serializedDiagnostics).not.toContain('fixture-secret')
    expect(serializedDiagnostics).not.toContain('Persistent Seller')
    expect(serializedDiagnostics).not.toContain('private@example.invalid')
    expect(serializedDiagnostics).not.toContain('sales_id=7')
  })

  it('falls back to live resolution with a safe warning when SQLite is unavailable', async () => {
    const requestedUrls: string[] = []
    const stateDirectory = await mkdtemp(join(tmpdir(), 'kledo-mcp-identity-'))
    temporaryDirectories.push(stateDirectory)

    const client = await connectClient(
      (request, response) => {
        requestedUrls.push(request.url ?? '')
        response.setHeader('content-type', 'application/json')
        if (request.url === '/api/v1/users') {
          response.end(
            JSON.stringify({
              success: true,
              data: [{ id: 7, name: 'Live Seller', email: 'private@example.invalid' }],
            }),
          )
          return
        }
        response.end(
          JSON.stringify({
            success: true,
            data: [
              {
                sales_id: 7,
                sales: { id: 7, name: 'Live Seller' },
                total_amount_after_tax: '125000000.00',
                total_count: 42,
                total_commission: '0.00',
              },
            ],
          }),
        )
      },
      {
        tenant: 'fixture-tenant',
        identityCatalogPath: stateDirectory,
      },
    )

    const result = await client.callTool({
      name: 'kledo_report',
      arguments: {
        report: 'sales_by_person',
        period: { from: '2026-07-01', to: '2026-07-31' },
        salesPersonName: 'live seller',
        pageSize: 20,
      },
    })

    expect(result.isError).not.toBe(true)
    expect(requestedUrls).toEqual([
      '/api/v1/users',
      '/api/v1/reportings/salesPerPerson?date_from=2026-07-01&date_to=2026-07-31&date_filter=trans_date&sales_id=7',
    ])
    expect(result.structuredContent).toMatchObject({
      parameters: { salesperson: { id: '7', name: 'Live Seller' } },
      meta: {
        warnings: ['Local identity catalog unavailable; salesperson was resolved from Kledo'],
      },
    })
    expect(JSON.stringify(result)).not.toContain(stateDirectory)
    expect(JSON.stringify(result)).not.toContain('fixture-secret')
    expect(JSON.stringify(result)).not.toContain('private@example.invalid')
  })

  it('never reuses a salesperson mapping across tenant credential scopes', async () => {
    const requestedUrls: string[] = []
    const upstream = createServer((request, response) => {
      requestedUrls.push(request.url ?? '')
      response.setHeader('content-type', 'application/json')
      const secondTenant = request.headers.authorization === 'Bearer second-tenant-secret'
      const salesperson = secondTenant
        ? { id: 8, name: 'Shared Seller' }
        : { id: 7, name: 'Shared Seller' }
      if (request.url === '/api/v1/users') {
        response.end(JSON.stringify({ success: true, data: [salesperson] }))
        return
      }
      response.end(
        JSON.stringify({
          success: true,
          data: [
            {
              sales_id: salesperson.id,
              sales: salesperson,
              total_amount_after_tax: '125000000.00',
              total_count: 42,
              total_commission: '0.00',
            },
          ],
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

    const stateDirectory = await mkdtemp(join(tmpdir(), 'kledo-mcp-identity-'))
    temporaryDirectories.push(stateDirectory)
    const identityCatalogPath = join(stateDirectory, 'identity-catalog.sqlite')

    const connectGateway = async (token: string): Promise<Client> => {
      const gateway = createKledoHttpGateway({
        baseUrl: new URL(`http://127.0.0.1:${port}/api/v1/`),
        token,
        tenant: 'shared-display-label',
        allowInsecureLoopback: true,
        identityCatalogPath,
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

    const call = (client: Client) =>
      client.callTool({
        name: 'kledo_report',
        arguments: {
          report: 'sales_by_person',
          period: { from: '2026-07-01', to: '2026-07-31' },
          salesPersonName: 'shared seller',
          pageSize: 20,
        },
      })

    const firstResult = await call(await connectGateway('first-tenant-secret'))
    const secondResult = await call(await connectGateway('second-tenant-secret'))

    expect(firstResult.structuredContent).toMatchObject({
      parameters: { salesperson: { id: '7' } },
    })
    expect(secondResult.structuredContent).toMatchObject({
      parameters: { salesperson: { id: '8' } },
    })
    expect(requestedUrls).toEqual([
      '/api/v1/users',
      '/api/v1/reportings/salesPerPerson?date_from=2026-07-01&date_to=2026-07-31&date_filter=trans_date&sales_id=7',
      '/api/v1/users',
      '/api/v1/reportings/salesPerPerson?date_from=2026-07-01&date_to=2026-07-31&date_filter=trans_date&sales_id=8',
    ])
    expect(JSON.stringify(firstResult)).not.toContain('tenant-secret')
    expect(JSON.stringify(secondResult)).not.toContain('tenant-secret')
  })

  it('uses shipping_date only when explicitly selected', async () => {
    const requestedUrls: string[] = []
    const client = await connectClient((request, response) => {
      requestedUrls.push(request.url ?? '')
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          data: [],
        }),
      )
    })

    const result = await client.callTool({
      name: 'kledo_report',
      arguments: {
        report: 'sales_by_person',
        period: { from: '2026-07-01', to: '2026-07-31' },
        dateBasis: 'shipping_date',
        pageSize: 20,
      },
    })

    expect(result.isError).not.toBe(true)
    expect(requestedUrls).toEqual([
      '/api/v1/reportings/salesPerPerson?date_from=2026-07-01&date_to=2026-07-31&date_filter=shipping_date',
    ])
    expect(result.structuredContent).toMatchObject({
      parameters: { dateBasis: 'shipping_date' },
    })
  })

  it('fails safely when a salesperson name has no exact match', async () => {
    const requestedUrls: string[] = []
    const client = await connectClient((request, response) => {
      requestedUrls.push(request.url ?? '')
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          data: [{ id: 8, name: 'Another Seller', email: 'other@example.invalid' }],
        }),
      )
    })

    const result = await client.callTool({
      name: 'kledo_report',
      arguments: {
        report: 'sales_by_person',
        period: { from: '2026-07-01', to: '2026-07-31' },
        salesPersonName: 'Missing Seller',
        pageSize: 20,
      },
    })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('NOT_FOUND')
    expect(JSON.stringify(result)).not.toContain('other@example.invalid')
    expect(requestedUrls).toEqual(['/api/v1/users'])
  })

  it('fails as ambiguous when multiple users have the same exact name', async () => {
    const requestedUrls: string[] = []
    const client = await connectClient((request, response) => {
      requestedUrls.push(request.url ?? '')
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          data: [
            { id: 7, name: 'Duplicate Seller', email: 'first@example.invalid' },
            { id: 8, name: 'duplicate seller', email: 'second@example.invalid' },
          ],
        }),
      )
    })

    const result = await client.callTool({
      name: 'kledo_report',
      arguments: {
        report: 'sales_by_person',
        period: { from: '2026-07-01', to: '2026-07-31' },
        salesPersonName: 'Duplicate Seller',
        pageSize: 20,
      },
    })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('INVALID_ARGUMENT')
    expect(JSON.stringify(result)).not.toContain('example.invalid')
    expect(requestedUrls).toEqual(['/api/v1/users'])
  })

  it('maps an invalid user catalog payload to SCHEMA_MISMATCH', async () => {
    const requestedUrls: string[] = []
    const client = await connectClient((request, response) => {
      requestedUrls.push(request.url ?? '')
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          data: [{ id: 'not-a-kledo-id', name: 'Invalid Seller' }],
        }),
      )
    })

    const result = await client.callTool({
      name: 'kledo_report',
      arguments: {
        report: 'sales_by_person',
        period: { from: '2026-07-01', to: '2026-07-31' },
        salesPersonName: 'Invalid Seller',
        pageSize: 20,
      },
    })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('SCHEMA_MISMATCH')
    expect(JSON.stringify(result)).not.toContain('not-a-kledo-id')
    expect(requestedUrls).toEqual(['/api/v1/users'])
  })

  it('rejects an ID and name together before making an upstream request', async () => {
    let requestCount = 0
    const client = await connectClient((_request, response) => {
      requestCount += 1
      response.writeHead(500).end()
    })

    const result = await client.callTool({
      name: 'kledo_report',
      arguments: {
        report: 'sales_by_person',
        period: { from: '2026-07-01', to: '2026-07-31' },
        salesPersonId: '7',
        salesPersonName: 'Fixture Seller',
        pageSize: 20,
      },
    })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('mutually exclusive')
    expect(requestCount).toBe(0)
  })

  it('maps an unexpected upstream report shape to SCHEMA_MISMATCH', async () => {
    let requestCount = 0
    const client = await connectClient((_request, response) => {
      requestCount += 1
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ success: true, data: [{ amount: '100.00' }] }))
    })

    const result = await client.callTool({
      name: 'kledo_report',
      arguments: {
        report: 'sales_by_person',
        period: { from: '2026-07-01', to: '2026-07-31' },
        salesPersonId: '7',
        pageSize: 20,
      },
    })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('SCHEMA_MISMATCH')
    expect(requestCount).toBe(1)
  })

  it('returns signed continuation and accurate completeness without detail calls', async () => {
    const requestedUrls: string[] = []
    const client = await connectClient((request, response) => {
      requestedUrls.push(request.url ?? '')
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          data: [
            {
              sales_id: 7,
              sales: { id: 7, name: 'First Seller' },
              total_amount_after_tax: '100.00',
              total_count: 1,
              total_commission: '0.00',
            },
            {
              sales_id: 8,
              sales: { id: 8, name: 'Second Seller' },
              total_amount_after_tax: '200.00',
              total_count: 2,
              total_commission: '0.00',
            },
            {
              sales_id: 9,
              sales: { id: 9, name: 'Third Seller' },
              total_amount_after_tax: '300.00',
              total_count: 3,
              total_commission: '0.00',
            },
          ],
        }),
      )
    })

    const firstPage = await client.callTool({
      name: 'kledo_report',
      arguments: {
        report: 'sales_by_person',
        period: { from: '2026-07-01', to: '2026-07-31' },
        pageSize: 2,
      },
    })
    expect(firstPage.isError).not.toBe(true)
    expect(firstPage.structuredContent).toMatchObject({
      data: { rows: [{ salesperson: { id: '7' } }, { salesperson: { id: '8' } }] },
      pageInfo: { nextCursor: expect.any(String), hasMore: true, total: 3 },
      meta: { complete: false },
    })

    const cursor = (firstPage.structuredContent as { pageInfo: { nextCursor: string } }).pageInfo
      .nextCursor
    const secondPage = await client.callTool({
      name: 'kledo_report',
      arguments: {
        report: 'sales_by_person',
        period: { from: '2026-07-01', to: '2026-07-31' },
        pageSize: 2,
        cursor,
      },
    })
    expect(secondPage.isError).not.toBe(true)
    expect(secondPage.structuredContent).toMatchObject({
      data: { rows: [{ salesperson: { id: '9' } }] },
      pageInfo: { hasMore: false, total: 3 },
      meta: { complete: true },
    })
    expect(requestedUrls).toEqual([
      '/api/v1/reportings/salesPerPerson?date_from=2026-07-01&date_to=2026-07-31&date_filter=trans_date',
      '/api/v1/reportings/salesPerPerson?date_from=2026-07-01&date_to=2026-07-31&date_filter=trans_date',
    ])
  })
})
