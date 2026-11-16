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

// Kledo's list fills sales_person from the previous row when sales_id has no
// matching user, so 602 carries a leaked salesperson that is not its own.
const listRows = [
  order(601, { sales_id: 90001, sales_person: { id: 90001, name: 'Sales Contoh Satu' } }),
  order(602, { sales_id: 90003, sales_person: { id: 90001, name: 'Sales Contoh Satu' } }),
  order(603, { sales_id: 90004 }),
  order(604, {}),
]

const detailById: Record<string, object> = {
  '601': order(601, { sales_id: 90001, sales: { id: 90001, name: 'Sales Contoh Satu' } }),
  '602': order(602, { sales_id: 90003, sales: null }),
  '603': order(603, { sales_id: 90004 }),
  '604': order(604, {}),
  '605': order(605, { sales_id: 90003, sales: { id: 90001, name: 'Sales Contoh Satu' } }),
}

describe('salesPerson follows sales_id in both kledo_query and kledo_get', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  const connect = async () => {
    const upstream = createServer((request, response) => {
      const url = request.url ?? ''
      const detail = /^\/api\/v1\/finance\/orders\/(\d+)$/.exec(url)
      let data: object | undefined
      if (detail) {
        data = detailById[detail[1] ?? '']
      } else if (url.startsWith('/api/v1/finance/orders?')) {
        data = { current_page: 1, last_page: 1, per_page: 10, total: listRows.length, data: listRows }
      }
      if (!data) {
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
    return client
  }

  const queried = async (client: Client) => {
    const result = await client.callTool({
      name: 'kledo_query',
      arguments: { entity: 'sales_order', pageSize: 10 },
    })
    expect(result.isError).not.toBe(true)
    const items = (result.structuredContent as { items: Array<{ id: string; salesPerson: unknown }> }).items
    return Object.fromEntries(items.map((item) => [item.id, item.salesPerson]))
  }

  const got = async (client: Client, id: string) => {
    const result = await client.callTool({
      name: 'kledo_get',
      arguments: { entity: 'sales_order', id },
    })
    expect(result.isError).not.toBe(true)
    return (result.structuredContent as { record: { salesPerson: unknown } }).record.salesPerson
  }

  it('returns the same salesPerson from query and get for every order', async () => {
    const client = await connect()
    const fromQuery = await queried(client)
    const expected: Record<string, unknown> = {
      '601': { id: '90001', name: 'Sales Contoh Satu' },
      '602': null,
      '603': null,
      '604': null,
    }
    expect(fromQuery).toEqual(expected)
    for (const id of Object.keys(expected)) {
      expect(await got(client, id)).toEqual(expected[id])
    }
  })

  it('ignores a salesperson object whose id is not the sales_id', async () => {
    const client = await connect()
    expect(await got(client, '605')).toBeNull()
  })
})
