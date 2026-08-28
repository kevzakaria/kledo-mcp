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
  process.stdout.write(`[trace] ${label.padEnd(20)} ${detail}\n`)
}

describe('kledo_get by human-visible Document Number', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  it('returns the exact Sales Invoice when Kledo search also returns a fuzzy candidate', async () => {
    const requestedUrls: string[] = []
    const upstream = createServer((request, response) => {
      requestedUrls.push(request.url ?? '')
      if (request.headers.authorization !== 'Bearer fixture-secret') {
        response.writeHead(404).end()
        return
      }

      response.setHeader('content-type', 'application/json')
      const url = new URL(request.url ?? '/', 'http://fixture.local')
      if (url.pathname === '/api/v1/finance/invoices' && url.searchParams.get('page') === '1') {
        traceStep('Kledo fixture API', 'fuzzy search returns 2 candidates')
        expect(url.searchParams.get('search')).toBe('INV/FIXTURE/462')
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
                  id: 461,
                  ref_number: 'INV/FIXTURE/4620',
                  trans_date: '2026-08-20',
                  due_date: null,
                  contact: { id: 44, name: 'Fixture', company: 'PT Fixture' },
                  amount_after_tax: '100.00',
                  due: '100.00',
                  memo: null,
                },
                {
                  id: 462,
                  ref_number: 'INV/FIXTURE/462',
                  trans_date: '2026-08-21',
                  due_date: '2026-09-20',
                  contact: { id: 44, name: 'Fixture', company: 'PT Fixture' },
                  amount_after_tax: '1250000.00',
                  due: '0',
                  memo: 'Project fixture',
                },
              ],
            },
          }),
        )
        return
      }

      if (url.pathname === '/api/v1/finance/invoices/462') {
        traceStep('Kledo fixture API', 'detail fetch uses hidden numeric ID 462')
        response.end(
          JSON.stringify({
            success: true,
            data: {
              id: 462,
              ref_number: 'INV/FIXTURE/462',
              trans_date: '2026-08-21',
              due_date: '2026-09-20',
              contact: { id: 44, name: 'Fixture', company: 'PT Fixture' },
              amount_after_tax: '1250000.00',
              due: '0',
              memo: 'Project fixture',
              updated_at: '2026-08-27T08:00:00Z',
              items: [],
              relations: [
                {
                  id: 900,
                  ref_number: 'IP/FIXTURE/900',
                  trans_type_id: 17,
                  trans_date: '2026-08-27',
                  amount_after_tax: '1250000.00',
                },
              ],
            },
          }),
        )
        return
      }

      if (url.pathname === '/api/v1/finance/invoices/462/transactions') {
        traceStep('Kledo fixture API', 'payment events use the same hidden ID')
        response.end(
          JSON.stringify({
            success: true,
            data: [
              {
                id: 900,
                business_tran_id: 462,
                trans_type_id: 17,
                trans_date: '2026-08-27',
                amount_after_tax: '1250000.00',
                status_id: 3,
                bank_account_id: 77,
                bank_account: { id: 77, name: 'Bank Fixture' },
                payment_type_id: null,
              },
            ],
          }),
        )
        return
      }

      response.writeHead(404).end()
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
      now: () => new Date('2026-08-28T08:30:00.000Z'),
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

    traceStep('MCP client', 'kledo_get(documentNumber="INV/FIXTURE/462")')
    const result = await client.callTool({
      name: 'kledo_get',
      arguments: {
        entity: 'sales_invoice',
        documentNumber: 'INV/FIXTURE/462',
        include: ['payment_events'],
      },
    })

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      entity: 'sales_invoice',
      record: {
        id: '462',
        reference: 'INV/FIXTURE/462',
        remaining: { amount: '0' },
        paymentState: 'paid',
        sourceUpdatedAt: '2026-08-27T08:00:00Z',
      },
      paymentEvents: [
        {
          id: '900',
          invoiceId: '462',
          number: 'IP/FIXTURE/900',
          transactionDate: '2026-08-27',
          amount: { amount: '1250000.00' },
        },
      ],
    })
    expect(requestedUrls).toEqual([
      '/api/v1/finance/invoices?search=INV%2FFIXTURE%2F462&per_page=100&page=1',
      '/api/v1/finance/invoices/462',
      '/api/v1/finance/invoices/462/transactions',
    ])
    traceStep('MCP result', 'paid invoice + source update + IP event; ID stayed internal')
  })

  it('routes every advertised commercial Document Number through its entity-specific path', async () => {
    const fixtures = [
      {
        entity: 'sales_quote',
        path: '/api/v1/finance/quotes',
        id: 401,
        documentNumber: 'QU/FIXTURE/401',
      },
      {
        entity: 'sales_order',
        path: '/api/v1/finance/orders',
        id: 402,
        documentNumber: 'SO/FIXTURE/402',
      },
      {
        entity: 'sales_delivery',
        path: '/api/v1/finance/deliveries',
        id: 403,
        documentNumber: 'DO/FIXTURE/403',
      },
      {
        entity: 'sales_invoice',
        path: '/api/v1/finance/invoices',
        id: 404,
        documentNumber: 'INV/FIXTURE/404',
      },
      {
        entity: 'purchase_quote',
        path: '/api/v1/finance/purchaseQuotes',
        id: 405,
        documentNumber: 'PQ/FIXTURE/405',
      },
      {
        entity: 'purchase_order',
        path: '/api/v1/finance/purchaseOrders',
        id: 406,
        documentNumber: 'PO/FIXTURE/406',
      },
      {
        entity: 'purchase_delivery',
        path: '/api/v1/finance/purchaseDeliveries',
        id: 407,
        documentNumber: 'PD/FIXTURE/407',
      },
      {
        entity: 'purchase_invoice',
        path: '/api/v1/finance/purchaseInvoices',
        id: 408,
        documentNumber: 'PI/FIXTURE/408',
      },
    ] as const
    const requestedUrls: string[] = []
    const upstream = createServer((request, response) => {
      requestedUrls.push(request.url ?? '')
      if (request.headers.authorization !== 'Bearer fixture-secret') {
        response.writeHead(404).end()
        return
      }
      response.setHeader('content-type', 'application/json')
      const url = new URL(request.url ?? '/', 'http://fixture.local')
      const fixture = fixtures.find(
        ({ path, id }) => url.pathname === path || url.pathname === `${path}/${id}`,
      )
      if (!fixture) {
        response.writeHead(404).end()
        return
      }
      const document = {
        id: fixture.id,
        ref_number: fixture.documentNumber,
        trans_date: '2026-08-22',
        due_date: null,
        contact: { id: 44, name: 'Fixture', company: 'PT Fixture' },
        amount_after_tax: '2500000.00',
        due: '2500000.00',
        memo: 'Project fixture',
        items: [],
        relations: [],
        transactions: [],
      }
      if (url.pathname === fixture.path) {
        expect(url.searchParams.get('search')).toBe(fixture.documentNumber)
        response.end(
          JSON.stringify({
            success: true,
            data: {
              current_page: 1,
              last_page: 1,
              per_page: 100,
              total: 1,
              data: [document],
            },
          }),
        )
        return
      }
      response.end(JSON.stringify({ success: true, data: document }))
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

    for (const fixture of fixtures) {
      const result = await client.callTool({
        name: 'kledo_get',
        arguments: {
          entity: fixture.entity,
          documentNumber: fixture.documentNumber,
        },
      })

      expect(result.isError, fixture.entity).not.toBe(true)
      expect(result.structuredContent, fixture.entity).toMatchObject({
        entity: fixture.entity,
        record: { id: String(fixture.id), reference: fixture.documentNumber },
      })
    }
    expect(requestedUrls).toHaveLength(fixtures.length * 2)
  })

  it('fails safely when an exact Document Number is missing, duplicated, or unbounded', async () => {
    const upstream = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      const url = new URL(request.url ?? '/', 'http://fixture.local')
      const documentNumber = url.searchParams.get('search')
      const rows =
        documentNumber === 'INV/UNBOUNDED'
          ? Array.from({ length: 100 }, (_, index) => ({
              id: 10_000 + index,
              ref_number: `INV/UNBOUNDED/${index}`,
            }))
          : documentNumber === 'INV/DUPLICATE'
          ? [
              { id: 1, ref_number: 'INV/DUPLICATE' },
              { id: 2, ref_number: 'INV/DUPLICATE' },
            ]
          : documentNumber === 'INV/MISSING'
            ? [{ id: 3, ref_number: 'INV/MISSING-BUT-FUZZY' }]
            : []
      response.end(
        JSON.stringify({
          success: true,
          data: {
            current_page: 1,
            last_page: documentNumber === 'INV/UNBOUNDED' ? 101 : 1,
            per_page: 100,
            total: documentNumber === 'INV/UNBOUNDED' ? 10_001 : rows.length,
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

    for (const [documentNumber, code, message] of [
      [
        'INV/MISSING',
        'NOT_FOUND',
        'No Kledo document exactly matched the supplied Document Number',
      ],
      [
        'INV/DUPLICATE',
        'AMBIGUOUS',
        'Multiple Kledo documents exactly matched the supplied Document Number',
      ],
      ['INV/UNBOUNDED', 'SCHEMA_MISMATCH', 'Kledo returned too many documents to resolve safely'],
    ] as const) {
      const result = await client.callTool({
        name: 'kledo_get',
        arguments: { entity: 'sales_invoice', documentNumber },
      })
      expect(result, documentNumber).toMatchObject({
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({ code, message, retryable: false }),
          },
        ],
      })
    }
  })

  it('rejects an unsupported include before resolving the Document Number upstream', async () => {
    let requestCount = 0
    const upstream = createServer((_request, response) => {
      requestCount += 1
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          data: {
            current_page: 1,
            last_page: 1,
            per_page: 100,
            total: 1,
            data: [{ id: 606, ref_number: 'SO/FIXTURE/606' }],
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
      name: 'kledo_get',
      arguments: {
        entity: 'sales_order',
        documentNumber: 'SO/FIXTURE/606',
        include: ['payment_events'],
      },
    })

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            code: 'INVALID_ARGUMENT',
            message: 'sales_order does not support payment_events',
            retryable: false,
          }),
        },
      ],
    })
    expect(requestCount).toBe(0)
  })
})
