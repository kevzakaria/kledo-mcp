import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import { createKledoHttpGateway } from '../../src/kledo/http-gateway.js'
import { createKledoMcpServer } from '../../src/server/create-server.js'

describe('kledo_get sales order', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  it('normalizes salesPerson from the detail "sales" field and strips private tag fields', async () => {
    const upstream = createServer((request, response) => {
      if (request.url !== '/api/v1/finance/orders/501') {
        response.writeHead(404).end()
        return
      }
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          data: {
            id: 501,
            ref_number: 'SO/2026/010',
            trans_date: '2026-08-01',
            due_date: '2026-08-31',
            shipping_date: null,
            contact: { id: 44, name: 'Alya', company: 'PT Maju Jaya' },
            sales_id: 352181,
            sales: { id: 352181, name: 'Elmo Abu Abdillah' },
            tags: [
              {
                id: 1,
                name: 'Penjualan Material',
                color: '#000000',
                owner_id: 145707,
                local_id: 'fixture-private-local-id',
                is_archive: 0,
                is_system_reserved: 0,
              },
            ],
            unbilled_amount: '250000.00',
            amount_after_tax: '1500000.00',
            due: '500000.00',
            memo: 'Routine installation',
            status_id: 5,
            updated_at: '2026-08-20T03:04:05Z',
            items: [],
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
      name: 'kledo_get',
      arguments: { entity: 'sales_order', id: '501' },
    })

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toEqual({
      entity: 'sales_order',
      record: {
        kind: 'sales_order',
        id: '501',
        reference: 'SO/2026/010',
        transactionDate: '2026-08-01',
        dueDate: '2026-08-31',
        shippingDate: null,
        statusId: '5',
        party: {
          id: '44',
          displayName: 'PT Maju Jaya',
          companyName: 'PT Maju Jaya',
          personName: 'Alya',
        },
        salesPerson: { id: '352181', name: 'Elmo Abu Abdillah' },
        tags: [{ id: '1', name: 'Penjualan Material' }],
        memo: 'Routine installation',
        total: { amount: '1500000.00', currency: null },
        remaining: { amount: '500000.00', currency: null },
        unbilled: { amount: '250000.00', currency: null },
        paymentState: 'partially_paid',
        sourceUpdatedAt: '2026-08-20T03:04:05Z',
      },
      truncation: { lineItems: false },
      meta: {
        fetchedAt: '2026-08-27T01:00:00.000Z',
        tenant: 'fixture-tenant',
        warnings: [],
      },
    })
  })

  it('returns a null salesPerson when sales_id is present without a salesperson object, matching Sales Invoice detail parity', async () => {
    const upstream = createServer((request, response) => {
      if (request.url !== '/api/v1/finance/orders/502') {
        response.writeHead(404).end()
        return
      }
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          data: {
            id: 502,
            ref_number: 'SO/2026/011',
            trans_date: '2026-08-02',
            due_date: null,
            shipping_date: null,
            contact: { id: 45, name: 'Bima', company: null },
            sales_id: 352182,
            amount_after_tax: 250000,
            due: 0,
            memo: null,
            status_id: 5,
            updated_at: null,
            items: [],
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
      arguments: { entity: 'sales_order', id: '502' },
    })

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      record: {
        salesPerson: null,
        tags: [],
      },
    })
  })

  it('rejects a malformed Sales Order tag from Kledo with a safe schema error', async () => {
    const upstream = createServer((request, response) => {
      if (request.url !== '/api/v1/finance/orders/501') {
        response.writeHead(404).end()
        return
      }
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          data: {
            id: 501,
            ref_number: 'SO/2026/010',
            trans_date: '2026-08-01',
            contact: { id: 44, name: 'Alya', company: 'PT Maju Jaya' },
            sales_id: 352181,
            sales: { id: 352181, name: 'Elmo Abu Abdillah' },
            tags: [{ id: 1 }],
            amount_after_tax: '1500000.00',
            memo: 'Routine installation',
            status_id: 5,
            items: [],
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
      arguments: { entity: 'sales_order', id: '501' },
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
  })

  it('projects salesPerson and tags through fields for kledo_get sales_order', async () => {
    const upstream = createServer((request, response) => {
      if (request.url !== '/api/v1/finance/orders/501') {
        response.writeHead(404).end()
        return
      }
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          data: {
            id: 501,
            ref_number: 'SO/2026/010',
            trans_date: '2026-08-01',
            contact: { id: 44, name: 'Alya', company: 'PT Maju Jaya' },
            sales_id: 352181,
            sales: { id: 352181, name: 'Elmo Abu Abdillah' },
            tags: [{ id: 1, name: 'Penjualan Material' }],
            amount_after_tax: '1500000.00',
            memo: 'Routine installation',
            status_id: 5,
            items: [],
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
      arguments: { entity: 'sales_order', id: '501', fields: ['salesPerson', 'tags'] },
    })

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      record: {
        kind: 'sales_order',
        id: '501',
        salesPerson: { id: '352181', name: 'Elmo Abu Abdillah' },
        tags: [{ id: '1', name: 'Penjualan Material' }],
      },
    })
    const record = (result.structuredContent as { record: object }).record
    expect(record).not.toHaveProperty('party')
    expect(record).not.toHaveProperty('memo')
    expect(record).not.toHaveProperty('total')
  })
})
