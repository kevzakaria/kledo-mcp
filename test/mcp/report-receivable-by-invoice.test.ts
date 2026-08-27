import { createServer, type RequestListener } from 'node:http'
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

const due = (values: Partial<Record<'-3' | '-2' | '-1' | '0' | '1' | '2' | '3' | '4', string>>) => ({
  '-3': '0.00',
  '-2': '0.00',
  '-1': '0.00',
  '0': '0.00',
  '1': '0.00',
  '2': '0.00',
  '3': '0.00',
  '4': '0.00',
  ...values,
})

const summaryDue = (
  values: Partial<Record<'-2' | '-1' | '0' | '1' | '2' | '3' | '4', string>>,
) => {
  const { '-3': _invoiceAmount, ...summary } = due(values)
  return summary
}

describe('kledo_report receivable by invoice', () => {
  const closeables: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((closeable) => closeable.close()))
  })

  async function connectClient(handler: RequestListener): Promise<Client> {
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
    return client
  }

  it('returns invoice numbers and API memo as the Web UI project/reference field', async () => {
    const requestedUrls: string[] = []
    const client = await connectClient((request, response) => {
      requestedUrls.push(request.url ?? '')
      const url = new URL(request.url ?? '/', 'http://fixture.invalid')
      response.setHeader('content-type', 'application/json')

      if (url.pathname === '/api/v1/reportings/agedReceivable') {
        traceStep('Kledo fixture API', 'customer-level receivable totals')
        response.end(
          JSON.stringify({
            success: true,
            data: {
              current_page: 1,
              last_page: 1,
              per_page: 2,
              total: 2,
              data: [
                {
                  id: 44,
                  name: 'Fixture Person',
                  company: 'Fixture Customer Ltd',
                  due: summaryDue({ '-1': '1250.00', '0': '1250.00' }),
                },
                {
                  id: 45,
                  name: 'Second Fixture',
                  company: null,
                  due: summaryDue({ '-2': '300.00', '-1': '300.00' }),
                },
              ],
            },
          }),
        )
        return
      }

      const contactId = url.pathname.split('/').at(-1)
      if (url.pathname.startsWith('/api/v1/reportings/agedReceivableDetail/')) {
        traceStep('Kledo fixture API', 'complete invoice drill-down for one customer')
        const firstCustomer = contactId === '44'
        const totalDue = firstCustomer
          ? due({ '-3': '1500.00', '-1': '1250.00', '0': '1250.00' })
          : due({ '-3': '300.00', '-2': '300.00', '-1': '300.00' })
        response.end(
          JSON.stringify({
            success: true,
            data: {
              current_page: 1,
              last_page: 1,
              per_page: 100,
              total: 1,
              total_due: totalDue,
              contact: {
                id: Number(contactId),
                name: firstCustomer ? 'Fixture Person' : 'Second Fixture',
                company: firstCustomer ? 'Fixture Customer Ltd' : null,
                email: 'private-fixture@example.invalid',
                phone: 'private-fixture-phone',
              },
              data: [
                {
                  id: firstCustomer ? 501 : 502,
                  trans_date: '2026-08-01',
                  due_date: '2026-08-20',
                  ref_number: firstCustomer ? 'INV/FIXTURE/501' : 'INV/FIXTURE/502',
                  memo: firstCustomer ? 'Fixture Project Alpha' : null,
                  due: totalDue,
                  age_due: 7,
                  age_trans: 26,
                },
              ],
            },
          }),
        )
        return
      }

      response.statusCode = 404
      response.end(JSON.stringify({ success: false }))
    })

    traceStep('MCP client', 'kledo_report(report=receivable_by_invoice)')
    const result = await client.callTool({
      name: 'kledo_report',
      arguments: {
        report: 'receivable_by_invoice',
        asOf: '2026-08-27',
        pageSize: 2,
      },
    })

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toEqual({
      report: 'receivable_by_invoice',
      parameters: {
        asOf: '2026-08-27',
        periodType: 'monthly',
        pageSize: 2,
      },
      data: {
        customers: [
          {
            customer: {
              id: '44',
              displayName: 'Fixture Customer Ltd',
              companyName: 'Fixture Customer Ltd',
              personName: 'Fixture Person',
            },
            totals: {
              invoiceAmount: { amount: '1500.00', currency: null },
              outstanding: { amount: '1250.00', currency: null },
              notYetDue: { amount: '0.00', currency: null },
              overdue: {
                lessThanOneMonth: { amount: '1250.00', currency: null },
                oneToTwoMonths: { amount: '0.00', currency: null },
                twoToThreeMonths: { amount: '0.00', currency: null },
                threeToFourMonths: { amount: '0.00', currency: null },
                moreThanFourMonths: { amount: '0.00', currency: null },
              },
            },
            invoices: [
              {
                id: '501',
                invoiceNumber: 'INV/FIXTURE/501',
                transactionDate: '2026-08-01',
                dueDate: '2026-08-20',
                projectReference: 'Fixture Project Alpha',
                invoiceAmount: { amount: '1500.00', currency: null },
                outstanding: { amount: '1250.00', currency: null },
                notYetDue: { amount: '0.00', currency: null },
                transactionAgeDays: 26,
                dueAgeDays: 7,
              },
            ],
          },
          expect.objectContaining({
            customer: expect.objectContaining({ id: '45' }),
            invoices: [expect.objectContaining({ projectReference: null })],
          }),
        ],
      },
      pageInfo: { hasMore: false, total: 2 },
      provenance: {
        customerTotals: '/reportings/agedReceivable',
        invoiceBreakdown: '/reportings/agedReceivableDetail/:contactId',
        projectReference: { apiField: 'memo', webUiField: 'Reference' },
      },
      meta: {
        fetchedAt: '2026-08-27T01:00:00.000Z',
        tenant: 'fixture-tenant',
        source: 'kledo_semantic_adapter',
        complete: true,
        warnings: [
          "projectReference is Kledo's memo field, displayed as Reference in the Web UI.",
          'Each returned customer includes the complete invoice drill-down reported by Kledo for the selected as-of date.',
        ],
      },
    })
    expect(JSON.stringify(result)).not.toContain('private-fixture@example.invalid')
    expect(JSON.stringify(result)).not.toContain('private-fixture-phone')
    traceStep('MCP result', 'customer -> invoice -> projectReference, with provenance')
    expect(requestedUrls).toEqual([
      '/api/v1/reportings/agedReceivable?date=2026-08-27&period_type=monthly&per_page=2&page=1',
      '/api/v1/reportings/agedReceivableDetail/44?date=2026-08-27&period_type=monthly&per_page=100&page=1',
      '/api/v1/reportings/agedReceivableDetail/45?date=2026-08-27&period_type=monthly&per_page=100&page=1',
    ])
  })

  it('keeps a customer page visibly incomplete until its signed cursor is followed', async () => {
    const client = await connectClient((request, response) => {
      const url = new URL(request.url ?? '/', 'http://fixture.invalid')
      response.setHeader('content-type', 'application/json')
      if (url.pathname === '/api/v1/reportings/agedReceivable') {
        const page = Number(url.searchParams.get('page'))
        const contactId = page === 1 ? 44 : 45
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
                  id: contactId,
                  name: `Fixture ${contactId}`,
                  company: null,
                  due: summaryDue({ '-1': '100.00', '0': '100.00' }),
                },
              ],
            },
          }),
        )
        return
      }

      if (url.pathname.startsWith('/api/v1/reportings/agedReceivableDetail/')) {
        const contactId = Number(url.pathname.split('/').at(-1))
        const totals = due({ '-3': '100.00', '-1': '100.00', '0': '100.00' })
        response.end(
          JSON.stringify({
            success: true,
            data: {
              current_page: 1,
              last_page: 1,
              per_page: 100,
              total: 1,
              total_due: totals,
              contact: { id: contactId, name: `Fixture ${contactId}`, company: null },
              data: [
                {
                  id: 500 + contactId,
                  trans_date: '2026-08-01',
                  due_date: '2026-08-20',
                  ref_number: `INV/FIXTURE/${contactId}`,
                  memo: null,
                  due: totals,
                  age_due: 7,
                  age_trans: 26,
                },
              ],
            },
          }),
        )
        return
      }
      response.statusCode = 404
      response.end(JSON.stringify({ success: false }))
    })

    const first = await client.callTool({
      name: 'kledo_report',
      arguments: { report: 'receivable_by_invoice', asOf: '2026-08-27', pageSize: 1 },
    })
    expect(first.isError).not.toBe(true)
    expect(first.structuredContent).toMatchObject({
      data: { customers: [{ customer: { id: '44' } }] },
      pageInfo: { hasMore: true, total: 2, nextCursor: expect.any(String) },
      meta: {
        complete: false,
        warnings: expect.arrayContaining([
          'More customer pages remain; follow nextCursor before presenting a company-wide receivable list.',
        ]),
      },
    })
    const cursor = (first.structuredContent as { pageInfo: { nextCursor: string } }).pageInfo
      .nextCursor

    const second = await client.callTool({
      name: 'kledo_report',
      arguments: {
        report: 'receivable_by_invoice',
        asOf: '2026-08-27',
        pageSize: 1,
        cursor,
      },
    })
    expect(second.isError).not.toBe(true)
    expect(second.structuredContent).toMatchObject({
      data: { customers: [{ customer: { id: '45' } }] },
      pageInfo: { hasMore: false, total: 2 },
      meta: { complete: true },
    })
  })
})
