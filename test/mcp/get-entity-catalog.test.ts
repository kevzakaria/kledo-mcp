import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import { createKledoHttpGateway } from '../../src/kledo/http-gateway.js'
import { createKledoMcpServer } from '../../src/server/create-server.js'

const documentFixture = {
  id: 101,
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
  items: [],
}

const fixturesByPath: Record<string, object> = {
  '/api/v1/finance/invoices/101': documentFixture,
  '/api/v1/finance/purchaseInvoices/101': documentFixture,
  '/api/v1/finance/orders/101': documentFixture,
  '/api/v1/finance/purchaseOrders/101': documentFixture,
  '/api/v1/finance/deliveries/101': documentFixture,
  '/api/v1/finance/purchaseDeliveries/101': documentFixture,
  '/api/v1/finance/quotes/101': documentFixture,
  '/api/v1/finance/contacts/101': {
    id: 101,
    name: 'Alya',
    company: 'PT Maju Jaya',
    group_id: 9,
    type_ids: [1],
    is_archive: 0,
    email: 'private@example.invalid',
    address: 'private address',
  },
  '/api/v1/finance/products/101': {
    id: 101,
    code: 'SRV-01',
    name: 'Fixture service',
    is_sell: 1,
    is_purchase: 0,
    is_track: 0,
  },
  '/api/v1/finance/accounts/101': {
    id: 101,
    ref_code: '4-10000',
    name: 'Fixture revenue',
    is_archive: 0,
  },
  '/api/v1/finance/bankTrans/101': documentFixture,
  '/api/v1/finance/expenses/101': documentFixture,
  '/api/v1/finance/warehouses/101': { id: 101, name: 'Main warehouse', is_archive: 0 },
}

describe('kledo_get entity catalog', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  it('routes every advertised detail entity to its exact allowlisted GET path', async () => {
    const requestedUrls: string[] = []
    const upstream = createServer((request, response) => {
      requestedUrls.push(request.url ?? '')
      const item = fixturesByPath[request.url ?? '']
      if (!item || request.method !== 'GET') {
        response.writeHead(404).end()
        return
      }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ success: true, data: item }))
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
      ['sales_invoice', '/api/v1/finance/invoices/101'],
      ['purchase_invoice', '/api/v1/finance/purchaseInvoices/101'],
      ['sales_order', '/api/v1/finance/orders/101'],
      ['purchase_order', '/api/v1/finance/purchaseOrders/101'],
      ['sales_delivery', '/api/v1/finance/deliveries/101'],
      ['purchase_delivery', '/api/v1/finance/purchaseDeliveries/101'],
      ['sales_quote', '/api/v1/finance/quotes/101'],
      ['contact', '/api/v1/finance/contacts/101'],
      ['product', '/api/v1/finance/products/101'],
      ['account', '/api/v1/finance/accounts/101'],
      ['bank_transaction', '/api/v1/finance/bankTrans/101'],
      ['expense', '/api/v1/finance/expenses/101'],
      ['warehouse', '/api/v1/finance/warehouses/101'],
    ] as const

    for (const [entity] of cases) {
      const result = await client.callTool({
        name: 'kledo_get',
        arguments: {
          entity,
          id: '101',
          ...(entity === 'contact' ? { fields: ['displayName'] } : {}),
          ...(['sales_invoice', 'purchase_invoice'].includes(entity)
            ? { fields: ['shippingDate', 'statusId'] }
            : {}),
        },
      })
      expect(result.isError, entity).not.toBe(true)
      expect(result.structuredContent, entity).toMatchObject({
        entity,
        record: { kind: entity, id: '101' },
        truncation: { lineItems: false },
        meta: { warnings: [] },
      })
      if (entity === 'contact') {
        expect(result.structuredContent).toMatchObject({
          record: { kind: 'contact', id: '101', displayName: 'PT Maju Jaya' },
        })
        expect((result.structuredContent as { record: object }).record).not.toHaveProperty(
          'companyName',
        )
        expect(JSON.stringify(result.structuredContent)).not.toContain('private@')
        expect(JSON.stringify(result.structuredContent)).not.toContain('private address')
      }
      if (entity === 'sales_invoice' || entity === 'purchase_invoice') {
        expect(result.structuredContent, entity).toMatchObject({
          record: { shippingDate: '2026-08-15', statusId: '3' },
        })
      }
    }

    expect(requestedUrls).toEqual(cases.map(([, url]) => url))
  })
})
