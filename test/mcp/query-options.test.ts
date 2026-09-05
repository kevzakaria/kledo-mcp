import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import { createKledoHttpGateway } from '../../src/kledo/http-gateway.js'
import { createKledoMcpServer } from '../../src/server/create-server.js'

describe('kledo_query options', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  it('translates allowlisted canonical filters/sort and projects normalized fields', async () => {
    const requestedUrls: string[] = []
    const upstream = createServer((request, response) => {
      requestedUrls.push(request.url ?? '')
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          data: {
            current_page: 1,
            last_page: 1,
            per_page: 5,
            total: 1,
            data: [
              {
                id: 101,
                ref_number: 'INV/2026/001',
                trans_date: '2026-08-01',
                due_date: '2026-08-31',
                contact: { id: 44, name: 'Alya', company: 'PT Maju Jaya' },
                sales_id: 90001,
                sales: { id: 90001, name: 'Sales Contoh Satu' },
                tags: [
                  {
                    id: 1,
                    name: 'Penjualan Material',
                    color: '#000000',
                    owner_id: 90002,
                    local_id: 'fixture-private-local-id',
                    is_archive: 0,
                    is_system_reserved: 0,
                  },
                ],
                amount_after_tax: '1500000.00',
                due: '500000.00',
                memo: 'Fixture memo',
                updated_at: null,
              },
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
      name: 'kledo_query',
      arguments: {
        entity: 'sales_invoice',
        search: 'PT Maju Jaya',
        filters: [
          { field: 'contactId', op: 'eq', value: '44' },
          { field: 'salesPersonId', op: 'eq', value: '90001' },
          { field: 'statusId', op: 'eq', value: '1' },
          {
            field: 'transactionDate',
            op: 'between',
            value: { from: '2026-08-01', to: '2026-08-31' },
          },
          { field: 'dueDate', op: 'lte', value: '2026-09-30' },
          { field: 'amount', op: 'gte', value: '1000.00' },
          { field: 'productId', op: 'in', value: ['5', '6'] },
        ],
        sort: [{ field: 'transactionDate', direction: 'desc' }],
        fields: [
          'reference',
          'transactionDate',
          'total',
          'paymentState',
          'salesPerson',
          'tags',
        ],
        pageSize: 5,
      },
    })

    expect(result.isError).not.toBe(true)
    expect(requestedUrls).toEqual([
      '/api/v1/finance/invoices?search=PT+Maju+Jaya&contact_id=44&sales_id=90001&status_id=1&date_from=2026-08-01&date_to=2026-08-31&due_date_to=2026-09-30&amount_gte=1000.00&product_id=5%2C6&sort_by=trans_date&order_by=desc&per_page=5&page=1',
    ])
    const structuredContent = result.structuredContent
    if (
      !structuredContent ||
      typeof structuredContent !== 'object' ||
      !('items' in structuredContent) ||
      !Array.isArray(structuredContent.items)
    ) {
      throw new Error('Expected projected invoice items')
    }
    const { items } = structuredContent
    expect(items[0]).toEqual({
      kind: 'sales_invoice',
      id: '101',
      reference: 'INV/2026/001',
      transactionDate: '2026-08-01',
      total: { amount: '1500000.00', currency: null },
      paymentState: 'partially_paid',
      salesPerson: { id: '90001', name: 'Sales Contoh Satu' },
      tags: [{ id: '1', name: 'Penjualan Material' }],
    })
    expect(items[0]).not.toHaveProperty('party')
    expect(items[0]).not.toHaveProperty('memo')
  })

  it('serializes comma lists only for ID filters documented as plural', async () => {
    const requestedUrls: string[] = []
    const documentFixture = {
      id: 101,
      ref_number: 'DOC/2026/001',
      trans_date: '2026-08-01',
      due_date: null,
      contact: { id: 44, name: 'Fixture', company: null },
      amount_after_tax: '100.00',
      due: '100.00',
      memo: null,
    }
    const upstream = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://fixture.local')
      requestedUrls.push(request.url ?? '')
      const item =
        url.pathname === '/api/v1/finance/products'
          ? { id: 5, code: 'FIX', name: 'Fixture product' }
          : documentFixture
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          data: {
            current_page: 1,
            last_page: 1,
            per_page: 2,
            total: 1,
            data: [item],
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

    const cases = [
      {
        arguments: {
          entity: 'sales_order',
          filters: [{ field: 'statusId', op: 'eq', value: '1' }],
          pageSize: 2,
        },
        url: '/api/v1/finance/orders?status_id=1&per_page=2&page=1',
      },
      {
        arguments: {
          entity: 'sales_order',
          filters: [
            { field: 'statusId', op: 'in', value: ['1', '3'] },
            { field: 'productId', op: 'in', value: ['5', '6'] },
            { field: 'warehouseId', op: 'in', value: ['2', '3'] },
          ],
          pageSize: 2,
        },
        url: '/api/v1/finance/orders?status_ids=1%2C3&product_id=5%2C6&warehouse_id=2%2C3&per_page=2&page=1',
      },
      {
        arguments: {
          entity: 'sales_invoice',
          filters: [{ field: 'salesPersonId', op: 'in', value: ['90001', '352182'] }],
          pageSize: 2,
        },
        url: '/api/v1/finance/invoices?sales_id=90001%2C352182&per_page=2&page=1',
      },
      {
        arguments: {
          entity: 'product',
          filters: [{ field: 'categoryId', op: 'in', value: ['8', '9'] }],
          pageSize: 2,
        },
        url: '/api/v1/finance/products?cat_ids=8%2C9&per_page=2',
      },
      {
        arguments: {
          entity: 'bank_transaction',
          filters: [
            { field: 'bankAccountId', op: 'eq', value: '77' },
            { field: 'transactionType', op: 'in', value: ['1', '2'] },
          ],
          pageSize: 2,
        },
        url: '/api/v1/finance/bankTrans?bank_account_id=77&trans_type_ids=1%2C2&per_page=2&page=1',
      },
      ...[
        ['purchase_invoice', 'purchaseInvoices'],
        ['purchase_order', 'purchaseOrders'],
        ['purchase_delivery', 'purchaseDeliveries'],
        ['sales_quote', 'quotes'],
        ['purchase_quote', 'purchaseQuotes'],
      ].map(([entity, path]) => ({
        arguments: {
          entity,
          filters: [{ field: 'warehouseId', op: 'in', value: ['2', '3'] }],
          pageSize: 2,
        },
        url: `/api/v1/finance/${path}?warehouse_id=2%2C3&per_page=2&page=1`,
      })),
    ]

    for (const testCase of cases) {
      const result = await client.callTool({ name: 'kledo_query', arguments: testCase.arguments })
      expect(result.isError, testCase.url).not.toBe(true)
    }
    expect(requestedUrls).toEqual(cases.map(({ url }) => url))
  })

  it('rejects numeric ID and amount filters at the MCP boundary without calling Kledo', async () => {
    let requestCount = 0
    const upstream = createServer((_request, response) => {
      requestCount += 1
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          data: { current_page: 1, last_page: 1, per_page: 20, total: 0, data: [] },
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

    // These safe integers are representative of non-integer JSON tokens that were
    // already rounded by JSON.parse before MCP input validation could inspect them.
    const alreadyRounded = 9_007_199_254_740_990
    for (const filter of [
      { field: 'contactId', op: 'eq', value: alreadyRounded },
      { field: 'amount', op: 'gte', value: alreadyRounded },
    ]) {
      const result = await client.callTool({
        name: 'kledo_query',
        arguments: { entity: 'sales_invoice', filters: [filter] },
      })
      expect(result).toMatchObject({
        isError: true,
        content: [
          {
            type: 'text',
            text: expect.stringMatching(/Input validation error.*quoted strings/i),
          },
        ],
      })
    }

    expect(requestCount).toBe(0)
  })

  it('rejects an entity-specific unsupported field before any HTTP request', async () => {
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
      name: 'kledo_query',
      arguments: {
        entity: 'contact',
        filters: [{ field: 'amount', op: 'gte', value: '1' }],
      },
    })

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            code: 'INVALID_ARGUMENT',
            message: 'Unsupported contact filter: amount gte',
            retryable: false,
          }),
        },
      ],
    })

    const expenseDueDate = await client.callTool({
      name: 'kledo_query',
      arguments: {
        entity: 'expense',
        filters: [{ field: 'dueDate', op: 'lte', value: '2026-09-30' }],
      },
    })
    expect(expenseDueDate).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            code: 'INVALID_ARGUMENT',
            message: 'Unsupported expense filter: dueDate lte',
            retryable: false,
          }),
        },
      ],
    })

    for (const [entity, field] of [
      ['bank_transaction', 'bankAccountId'],
      ['sales_order', 'salesPersonId'],
      ['sales_invoice', 'contactId'],
      ['sales_delivery', 'warehouseId'],
    ] as const) {
      const pluralId = await client.callTool({
        name: 'kledo_query',
        arguments: {
          entity,
          filters: [{ field, op: 'in', value: ['1', '2'] }],
        },
      })
      expect(pluralId, `${entity}.${field}`).toMatchObject({
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              code: 'INVALID_ARGUMENT',
              message: `Unsupported ${entity} filter: ${field} in`,
              retryable: false,
            }),
          },
        ],
      })
    }
    expect(requestCount).toBe(0)
  })
})
