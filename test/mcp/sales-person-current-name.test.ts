import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it } from 'vitest'

import { createKledoHttpGateway } from '../../src/kledo/http-gateway.js'
import { createKledoMcpServer } from '../../src/server/create-server.js'

const order = (id: number, extra: object) => ({
  id,
  ref_number: `SO/2026/${id}`,
  trans_date: '2026-08-01',
  due_date: null,
  shipping_date: null,
  contact: { id: 44, name: 'Alya', company: 'PT Maju Jaya' },
  amount_after_tax: '1500000.00',
  memo: null,
  status_id: 5,
  updated_at: null,
  tags: [],
  ...extra,
})

// Kledo's list keeps the name a user had when the document was made; the
// detail and the user list carry the current name.
const listRows = [
  order(701, { sales_id: 90001, sales_person: { id: 90001, name: 'Nama Lama Sales' } }),
  order(702, { sales_id: 90002, sales_person: { id: 90002, name: 'Sales Contoh Dua' } }),
]
const detailById: Record<string, object> = {
  '701': order(701, { sales_id: 90001, sales: { id: 90001, name: 'Nama Baru' } }),
  '702': order(702, { sales_id: 90002, sales: { id: 90002, name: 'Sales Contoh Dua' } }),
}
const users = [
  { id: 90001, name: 'Nama Baru' },
  { id: 90002, name: 'Sales Contoh Dua' },
]

describe('salesPerson uses the current user name in kledo_query and kledo_get', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  const connect = async ({ usersReadable = true } = {}) => {
    const requestedPaths: string[] = []
    const upstream = createServer((request, response) => {
      const url = request.url ?? ''
      requestedPaths.push(new URL(url, 'http://fixture.local').pathname)
      const detail = /^\/api\/v1\/finance\/orders\/(\d+)$/.exec(url)
      let data: object | undefined
      if (detail) {
        data = detailById[detail[1] ?? '']
      } else if (url.startsWith('/api/v1/finance/orders?')) {
        data = { current_page: 1, last_page: 1, per_page: 10, total: listRows.length, data: listRows }
      } else if (url === '/api/v1/users' && usersReadable) {
        data = users
      }
      if (!data) {
        response.writeHead(usersReadable ? 404 : 403).end()
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
    return { client, requestedPaths }
  }

  type QueryContent = {
    items: Array<{ id: string; salesPerson?: unknown }>
    meta: { warnings: string[] }
  }

  const query = async (client: Client, fields?: string[]) => {
    const result = await client.callTool({
      name: 'kledo_query',
      arguments: { entity: 'sales_order', pageSize: 10, ...(fields ? { fields } : {}) },
    })
    expect(result.isError).not.toBe(true)
    return result.structuredContent as QueryContent
  }

  const got = async (client: Client, id: string) => {
    const result = await client.callTool({
      name: 'kledo_get',
      arguments: { entity: 'sales_order', id },
    })
    expect(result.isError).not.toBe(true)
    return (result.structuredContent as { record: { salesPerson: unknown } }).record.salesPerson
  }

  it('names a renamed user the same way in query and get', async () => {
    const { client, requestedPaths } = await connect()
    const first = await query(client)
    expect(first.meta.warnings).toEqual([])
    const fromQuery = Object.fromEntries(first.items.map((item) => [item.id, item.salesPerson]))
    expect(fromQuery).toEqual({
      '701': { id: '90001', name: 'Nama Baru' },
      '702': { id: '90002', name: 'Sales Contoh Dua' },
    })
    for (const id of ['701', '702']) {
      expect(await got(client, id)).toEqual(fromQuery[id])
    }

    await query(client)
    expect(requestedPaths.filter((path) => path === '/api/v1/users')).toHaveLength(1)
  })

  it('skips the user list when salesPerson is not requested', async () => {
    const { client, requestedPaths } = await connect()
    await query(client, ['reference'])
    expect(requestedPaths).not.toContain('/api/v1/users')
  })

  it('falls back to the list name with a warning when users cannot be read', async () => {
    const { client } = await connect({ usersReadable: false })
    const result = await query(client)
    expect(result.items[0]?.salesPerson).toEqual({ id: '90001', name: 'Nama Lama Sales' })
    expect(result.meta.warnings).toEqual([
      'Kledo users could not be read, so salesPerson names are as the document list shows them and may be a former name',
    ])
  })
})
