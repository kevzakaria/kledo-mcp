import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import { createKledoHttpGateway } from '../../src/kledo/http-gateway.js'
import { createKledoMcpServer } from '../../src/server/create-server.js'

describe('kledo_query sales invoices', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  it('returns a normalized, bounded page from a real Kledo list envelope', async () => {
    const upstream = createServer((request, response) => {
      if (
        request.url !== '/api/v1/finance/invoices?per_page=2&page=1' ||
        request.headers.authorization !== 'Bearer fixture-secret'
      ) {
        response.writeHead(404).end()
        return
      }

      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          data: {
            current_page: 1,
            last_page: 2,
            per_page: 2,
            total: 3,
            data: [
              {
                id: 101,
                ref_number: 'INV/2026/001',
                trans_date: '2026-08-01',
                due_date: '2026-08-31',
                shipping_date: '2026-08-15',
                contact: { id: 44, name: 'Alya', company: 'PT Maju Jaya' },
                sales_id: 352181,
                sales_person: { id: 352181, name: 'Elmo Abu Abdillah' },
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
                amount_after_tax: '1500000.00',
                due: '500000.00',
                memo: 'Routine installation',
                status_id: 3,
                updated_at: '2026-08-20T03:04:05Z',
              },
              {
                id: 102,
                ref_number: 'INV/2026/002',
                trans_date: '2026-08-02',
                due_date: null,
                shipping_date: null,
                contact: { id: 45, name: 'Bima', company: null },
                sales_id: 352182,
                amount_after_tax: 250000,
                due: 0,
                memo: null,
                status_id: 3,
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
      close: () => new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve()))),
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
      name: 'kledo_query',
      arguments: { entity: 'sales_invoice', pageSize: 2 },
    })

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toEqual({
      entity: 'sales_invoice',
      items: [
        {
          kind: 'sales_invoice',
          id: '101',
          reference: 'INV/2026/001',
          transactionDate: '2026-08-01',
          dueDate: '2026-08-31',
          shippingDate: '2026-08-15',
          statusId: '3',
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
          paymentState: 'partially_paid',
          sourceUpdatedAt: '2026-08-20T03:04:05Z',
        },
        {
          kind: 'sales_invoice',
          id: '102',
          reference: 'INV/2026/002',
          transactionDate: '2026-08-02',
          dueDate: null,
          shippingDate: null,
          statusId: '3',
          party: {
            id: '45',
            displayName: 'Bima',
            companyName: null,
            personName: 'Bima',
          },
          salesPerson: { id: '352182', name: null },
          tags: [],
          memo: null,
          total: { amount: '250000', currency: null },
          remaining: { amount: '0', currency: null },
          paymentState: 'paid',
          sourceUpdatedAt: null,
        },
      ],
      pageInfo: {
        nextCursor: expect.any(String),
        hasMore: true,
        total: 3,
      },
      meta: {
        fetchedAt: '2026-08-27T01:00:00.000Z',
        tenant: 'fixture-tenant',
        complete: false,
        warnings: [],
      },
    })
  })

  it('continues with an opaque cursor that stays bound to the original query', async () => {
    const requestedPages: number[] = []
    const maxProductIds = Array<string>(100).fill('10000000000000000000')
    const maximalBoundArguments = {
      entity: 'sales_invoice',
      search: 's'.repeat(200),
      filters: Array.from({ length: 12 }, () => ({
        field: 'productId',
        op: 'in',
        value: maxProductIds,
      })),
      sort: [{ field: 'transactionDate', direction: 'asc' }],
      fields: Array<string>(20).fill('reference'),
      pageSize: 1,
    }
    const upstream = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://fixture.local')
      const page = Number(url.searchParams.get('page'))
      requestedPages.push(page)

      if (
        url.pathname !== '/api/v1/finance/invoices' ||
        url.searchParams.get('per_page') !== '1' ||
        request.headers.authorization !== 'Bearer fixture-secret'
      ) {
        response.writeHead(404).end()
        return
      }

      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          success: true,
          data: {
            current_page: page,
            last_page: 2,
            per_page: 1,
            total: 2,
            data: [
              {
                id: page === 1 ? 201 : 202,
                ref_number: page === 1 ? 'INV/2026/201' : 'INV/2026/202',
                trans_date: '2026-08-01',
                due_date: null,
                contact: { id: 1, name: 'Fixture', company: null },
                amount_after_tax: '100',
                due: '100',
                memo: null,
                status_id: 1,
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
      close: () => new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve()))),
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

    const first = await client.callTool({
      name: 'kledo_query',
      arguments: {
        ...maximalBoundArguments,
      },
    })
    const firstPage = first.structuredContent as {
      pageInfo: { nextCursor: string }
    }
    const cursor = firstPage.pageInfo.nextCursor
    expect(cursor.length).toBeLessThanOrEqual(2048)
    const tamperedCursor = `${cursor[0] === 'A' ? 'B' : 'A'}${cursor.slice(1)}`
    const tampered = await client.callTool({
      name: 'kledo_query',
      arguments: {
        ...maximalBoundArguments,
        cursor: tamperedCursor,
      },
    })
    expect(tampered).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            code: 'INVALID_CURSOR',
            message: 'The continuation cursor is invalid or does not match',
            retryable: false,
          }),
        },
      ],
    })
    const mismatched = await client.callTool({
      name: 'kledo_query',
      arguments: {
        ...maximalBoundArguments,
        pageSize: 2,
        cursor,
      },
    })
    expect(mismatched.isError).toBe(true)
    expect(requestedPages).toEqual([1])

    const second = await client.callTool({
      name: 'kledo_query',
      arguments: {
        ...maximalBoundArguments,
        cursor,
      },
    })

    expect(second.isError).not.toBe(true)
    expect(second.structuredContent).toMatchObject({
      items: [{ id: '202', reference: 'INV/2026/202' }],
      pageInfo: { hasMore: false, total: 2 },
      meta: { complete: true },
    })
    expect((second.structuredContent as { pageInfo: object }).pageInfo).not.toHaveProperty(
      'nextCursor',
    )
    expect(requestedPages).toEqual([1, 2])
  })
})
