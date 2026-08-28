import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import { createKledoHttpGateway } from '../../src/kledo/http-gateway.js'
import { createKledoMcpServer } from '../../src/server/create-server.js'

const documentFixture = {
  id: '9223372036854775807',
  ref_number: 'DOC/2026/001',
  trans_date: '2026-08-01',
  due_date: '2026-08-31',
  shipping_date: '2026-08-15',
  contact: { id: 44, name: 'Alya', company: 'PT Maju Jaya' },
  amount_after_tax: '1500000.00',
  due: '500000.00',
  memo: 'Fixture memo',
  status_id: 3,
  updated_at: '2026-08-20T03:04:05Z',
}

const fixturesByPath: Record<string, object> = {
  '/api/v1/finance/invoices': documentFixture,
  '/api/v1/finance/purchaseInvoices': documentFixture,
  '/api/v1/finance/orders': { ...documentFixture, unbilled_amount: '250000.00' },
  '/api/v1/finance/purchaseOrders': documentFixture,
  '/api/v1/finance/deliveries': documentFixture,
  '/api/v1/finance/purchaseDeliveries': documentFixture,
  '/api/v1/finance/quotes': documentFixture,
  '/api/v1/finance/purchaseQuotes': documentFixture,
  '/api/v1/finance/contacts': {
    id: 44,
    name: 'Alya',
    company: 'PT Maju Jaya',
    group_id: 9,
    type_ids: [1, 3],
    is_archive: 0,
    email: 'private@example.invalid',
    phone: '+62000000000',
    address: 'private address',
    npwp: 'private-tax-id',
  },
  '/api/v1/finance/products': {
    id: 71,
    code: 'SRV-01',
    name: 'Fixture service',
    product_category: { id: 8, name: 'Services' },
    is_sell: true,
    is_purchase: false,
    is_track: false,
    base_price: '500000.00',
    price: '750000.00',
  },
  '/api/v1/finance/accounts': {
    id: 401,
    ref_code: '4-10000',
    name: 'Fixture revenue',
    finance_account_category: { id: 4, name: 'Revenue' },
    balance: '125000000.00',
    is_archive: 0,
  },
  '/api/v1/finance/bankTrans': {
    ...documentFixture,
    bank_account: { id: 77, name: 'Fixture bank' },
    trans_type: 'Receipt',
  },
  '/api/v1/finance/expenses': documentFixture,
  '/api/v1/finance/warehouses': { id: 2, name: 'Main warehouse', is_archive: 0 },
  '/api/v1/finance/units': { id: 1, name: 'Piece' },
}

const malformedFlagCases = [
  {
    name: 'archived',
    entity: 'contact',
    path: '/api/v1/finance/contacts',
    fixture: { id: 1, name: 'Fixture', company: null, is_archive: 2 },
  },
  {
    name: 'canSell',
    entity: 'product',
    path: '/api/v1/finance/products',
    fixture: { id: 1, name: 'Fixture', is_sell: 2, is_purchase: 0, is_track: 0 },
  },
  {
    name: 'canPurchase',
    entity: 'product',
    path: '/api/v1/finance/products',
    fixture: { id: 1, name: 'Fixture', is_sell: 1, is_purchase: 2, is_track: 0 },
  },
  {
    name: 'tracked',
    entity: 'product',
    path: '/api/v1/finance/products',
    fixture: { id: 1, name: 'Fixture', is_sell: 1, is_purchase: 0, is_track: 2 },
  },
] as const

describe('kledo_query entity catalog', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  it('routes and normalizes every advertised entity without exposing contact PII', async () => {
    const requestedUrls: string[] = []
    const upstream = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://fixture.local')
      requestedUrls.push(request.url ?? '')
      const item = fixturesByPath[url.pathname]
      if (!item || request.method !== 'GET') {
        response.writeHead(404).end()
        return
      }
      const data =
        url.pathname === '/api/v1/finance/warehouses'
          ? [item]
          : {
              current_page: 1,
              last_page: 1,
              per_page: 2,
              total: 1,
              data: [item],
            }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ success: true, data }))
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
      ['sales_invoice', '/api/v1/finance/invoices?per_page=2&page=1'],
      ['purchase_invoice', '/api/v1/finance/purchaseInvoices?per_page=2&page=1'],
      ['sales_order', '/api/v1/finance/orders?per_page=2&page=1'],
      ['purchase_order', '/api/v1/finance/purchaseOrders?per_page=2&page=1'],
      ['sales_delivery', '/api/v1/finance/deliveries?per_page=2&page=1'],
      ['purchase_delivery', '/api/v1/finance/purchaseDeliveries?per_page=2&page=1'],
      ['sales_quote', '/api/v1/finance/quotes?per_page=2&page=1'],
      ['purchase_quote', '/api/v1/finance/purchaseQuotes?per_page=2&page=1'],
      ['contact', '/api/v1/finance/contacts?per_page=2&page=1'],
      ['product', '/api/v1/finance/products?per_page=2'],
      ['account', '/api/v1/finance/accounts?per_page=2&page=1'],
      [
        'bank_transaction',
        '/api/v1/finance/bankTrans?bank_account_id=77&per_page=2&page=1',
      ],
      ['expense', '/api/v1/finance/expenses?per_page=2&page=1'],
      ['warehouse', '/api/v1/finance/warehouses'],
      ['unit', '/api/v1/finance/units?per_page=2'],
    ] as const

    for (const [entity] of cases) {
      const result = await client.callTool({
        name: 'kledo_query',
        arguments: {
          entity,
          pageSize: 2,
          ...(['sales_invoice', 'purchase_invoice'].includes(entity)
            ? { fields: ['shippingDate', 'statusId'] }
            : {}),
          ...(entity === 'bank_transaction'
            ? { filters: [{ field: 'bankAccountId', op: 'eq', value: '77' }] }
            : {}),
        },
      })
      expect(result.isError, entity).not.toBe(true)
      expect(result.structuredContent, entity).toMatchObject({
        entity,
        items: [{ kind: entity, id: expect.any(String) }],
        pageInfo: { hasMore: false, total: 1 },
        meta: { complete: true },
      })
      if (entity === 'contact') {
        const serialized = JSON.stringify(result.structuredContent)
        expect(serialized).not.toContain('private@')
        expect(serialized).not.toContain('private-tax-id')
        expect(serialized).not.toContain('private address')
      }
      if (entity === 'sales_invoice' || entity === 'purchase_invoice') {
        expect(result.structuredContent, entity).toMatchObject({
          items: [{ shippingDate: '2026-08-15', statusId: '3' }],
        })
      }
    }

    expect(requestedUrls).toEqual(cases.map(([, url]) => url))
  })

  it('accepts the nested warehouse envelope, bounds it locally, and reports incompleteness', async () => {
    const upstream = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          data: {
            data: [
              { id: 1, name: 'One' },
              { id: 2, name: 'Two' },
              { id: 3, name: 'Three' },
            ],
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
      name: 'kledo_query',
      arguments: { entity: 'warehouse', pageSize: 1 },
    })

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      entity: 'warehouse',
      items: [{ kind: 'warehouse', id: '1', name: 'One' }],
      pageInfo: { hasMore: true, total: 3 },
      meta: {
        complete: false,
        warnings: ['Kledo does not document cursor continuation for this entity'],
      },
    })
    expect(result.structuredContent).not.toHaveProperty('pageInfo.nextCursor')
  })

  it.each(malformedFlagCases)(
    'rejects a non-binary numeric $name flag from Kledo',
    async ({ entity, path, fixture }) => {
      const upstream = createServer((request, response) => {
        if (new URL(request.url ?? '/', 'http://fixture.local').pathname !== path) {
          response.writeHead(404).end()
          return
        }
        response.setHeader('content-type', 'application/json')
        response.end(
          JSON.stringify({
            success: true,
            data: {
              current_page: 1,
              last_page: 1,
              per_page: 1,
              total: 1,
              data: [fixture],
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
        name: 'kledo_query',
        arguments: { entity, pageSize: 1 },
      })

      expect(result).toMatchObject({
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              code: 'SCHEMA_MISMATCH',
              message: 'Kledo returned data in an unexpected format',
              retryable: false,
            }),
          },
        ],
      })
    },
  )
})
