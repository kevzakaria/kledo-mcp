import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import { createKledoHttpGateway } from '../../src/kledo/http-gateway.js'
import { createKledoMcpServer } from '../../src/server/create-server.js'

describe('kledo_get transaction includes', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  it('normalizes bounded line items and relation IDs already present in transaction detail', async () => {
    const requestedUrls: string[] = []
    const upstream = createServer((request, response) => {
      requestedUrls.push(request.url ?? '')
      const common = {
        id: 101,
        ref_number: 'DOC/2026/001',
        trans_date: '2026-08-01',
        due_date: null,
        shipping_date: '2026-08-15',
        contact: { id: 44, name: 'Alya', company: 'PT Maju Jaya' },
        amount_after_tax: '1500000.00',
        memo: null,
        status_id: 3,
        updated_at: null,
      }
      let data: object
      if (request.url === '/api/v1/finance/purchaseOrders/101') {
        data = {
          ...common,
          items: [
            {
              id: 501,
              desc: 'Fixture material',
              qty: '2.0000',
              unit_name: 'Piece',
              price: '500000.00',
              amount_after_tax: '1110000.00',
              product: { id: 71, code: 'MAT-01', name: 'Material' },
            },
            {
              id: 502,
              desc: 'Second item',
              qty: 1,
              unit_name: null,
              product: null,
            },
          ],
        }
      } else if (request.url === '/api/v1/finance/deliveries/101') {
        data = {
          ...common,
          items: [],
          parent_tran: { id: 99, ref_number: 'SO/2026/099', trans_type_id: 6 },
        }
      } else {
        response.writeHead(404).end()
        return
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

    const purchaseOrder = await client.callTool({
      name: 'kledo_get',
      arguments: {
        entity: 'purchase_order',
        id: '101',
        include: ['line_items'],
        lineItemLimit: 1,
      },
    })
    expect(purchaseOrder.isError).not.toBe(true)
    expect(purchaseOrder.structuredContent).toMatchObject({
      lineItems: [
        {
          id: '501',
          description: 'Fixture material',
          quantity: '2.0000',
          unit: 'Piece',
          unitPrice: { amount: '500000.00', currency: null },
          total: { amount: '1110000.00', currency: null },
          product: { id: '71', code: 'MAT-01', name: 'Material' },
        },
      ],
      truncation: { lineItems: true, omittedCount: 1 },
    })

    const delivery = await client.callTool({
      name: 'kledo_get',
      arguments: { entity: 'sales_delivery', id: '101', include: ['relation_ids'] },
    })
    expect(delivery.isError).not.toBe(true)
    expect(delivery.structuredContent).toMatchObject({
      relations: [{ relation: 'derived_from', entity: 'sales_order', id: '99' }],
      truncation: { lineItems: false },
    })
    expect(requestedUrls).toEqual([
      '/api/v1/finance/purchaseOrders/101',
      '/api/v1/finance/deliveries/101',
    ])
  })
})
