import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createKledoHttpGateway } from '../../src/kledo/http-gateway.js'

describe('Kledo identity warm-up', () => {
  const closeables: Array<() => Promise<void>> = []
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.allSettled(closeables.splice(0).map((close) => close()))
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    )
  })

  it('fetches sanitized reference catalogs and keeps salesperson routing warm after restart', async () => {
    const requestedUrls: string[] = []
    const upstream = createServer((request, response) => {
      requestedUrls.push(request.url ?? '')
      response.setHeader('content-type', 'application/json')
      if (request.url === '/api/v1/users') {
        response.end(
          JSON.stringify({
            success: true,
            data: {
              data: [
                {
                  id: 7,
                  name: 'Warm Seller',
                  email: 'private@example.invalid',
                  is_active: true,
                },
                {
                  id: 8,
                  name: 'Second Seller',
                  email: 'second@example.invalid',
                  is_active: false,
                },
              ],
              roles: [],
              total_finance_user: 2,
            },
          }),
        )
        return
      }
      const url = new URL(request.url ?? '/', 'http://fixture.local')
      if (url.pathname === '/api/v1/finance/contacts') {
        const page = Number(url.searchParams.get('page'))
        const contacts =
          page === 1
            ? [
                {
                  id: 101,
                  name: 'Vendor Employee Contact',
                  company: 'PT Vendor Employee',
                  type_ids: [1, 2],
                  is_archive: 0,
                  finance_contact_emails: [{ email: 'customer@example.invalid' }],
                  phone: '+62000000000',
                  address: 'private address',
                  npwp: 'private-tax-id',
                },
                {
                  id: 102,
                  name: 'Archived Vendor Customer',
                  company: null,
                  type_ids: [1, 3],
                  is_archive: 1,
                },
              ]
            : [
                {
                  id: 103,
                  name: 'Vendor Other Contact',
                  company: null,
                  type_ids: [1, 4],
                  is_archive: false,
                },
                {
                  id: 104,
                  name: 'Investor Contact',
                  company: null,
                  type_ids: [5],
                  is_archive: false,
                },
              ]
        response.end(
          JSON.stringify({
            success: true,
            data: {
              current_page: page,
              last_page: 2,
              per_page: 2,
              total: 4,
              data: contacts,
            },
          }),
        )
        return
      }
      if (url.pathname === '/api/v1/finance/contactGroups') {
        response.end(
          JSON.stringify({
            success: true,
            data: [
              { id: 9, code: 'KEY', name: 'Key accounts' },
              { id: 10, code: 'FIELD', name: 'Field accounts' },
            ],
          }),
        )
        return
      }
      if (url.pathname === '/api/v1/finance/products') {
        response.end(
          JSON.stringify({
            success: true,
            data: {
              current_page: 1,
              last_page: 1,
              per_page: 100,
              total: 2,
              data: [
                { id: 201, name: 'Service One', is_archive: 0, private_cost: '500' },
                { id: 202, name: 'Archived Product', is_archive: 1 },
              ],
            },
          }),
        )
        return
      }
      if (url.pathname === '/api/v1/finance/productCategories') {
        response.end(
          JSON.stringify({
            success: true,
            data: [
              {
                id: 301,
                name: 'Services',
                parent_id: null,
                children: [{ id: 302, name: 'Installation', parent_id: 301, children: [] }],
              },
            ],
          }),
        )
        return
      }
      if (url.pathname === '/api/v1/finance/warehouses') {
        response.end(
          JSON.stringify({
            success: true,
            data: { data: [{ id: 401, name: 'Main Warehouse', is_archive: false }] },
          }),
        )
        return
      }
      if (url.pathname === '/api/v1/finance/units') {
        response.end(
          JSON.stringify({
            success: true,
            data: {
              current_page: 1,
              last_page: 1,
              per_page: 100,
              total: 2,
              data: [
                { id: 501, name: 'Piece', deleted_at: null },
                { id: 502, name: 'Hour', deleted_at: null },
              ],
            },
          }),
        )
        return
      }
      if (url.pathname === '/api/v1/finance/accounts') {
        response.end(
          JSON.stringify({
            success: true,
            data: {
              current_page: 1,
              last_page: 1,
              per_page: 100,
              total: 2,
              data: [
                { id: 601, name: 'Cash', is_archive: 0, balance: 'private-balance' },
                { id: 602, name: 'Bank', is_archive: 0, balance: 'private-balance' },
              ],
            },
          }),
        )
        return
      }
      response.end(
        JSON.stringify({
          success: true,
          data: [
            {
              sales_id: 7,
              sales: { id: 7, name: 'Warm Seller' },
              total_amount_after_tax: '125000000.00',
              total_count: 42,
              total_commission: '0.00',
            },
          ],
        }),
      )
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    const { port } = upstream.address() as AddressInfo
    closeables.push(
      () =>
        new Promise<void>((resolve, reject) =>
          upstream.close((error) => (error ? reject(error) : resolve())),
        ),
    )

    const stateDirectory = await mkdtemp(join(tmpdir(), 'kledo-mcp-warmup-'))
    temporaryDirectories.push(stateDirectory)
    const identityCatalogPath = join(stateDirectory, 'identity-catalog.sqlite')
    const gatewayOptions = {
      baseUrl: new URL(`http://127.0.0.1:${port}/api/v1/`),
      token: 'fixture-secret',
      allowInsecureLoopback: true,
      identityCatalogPath,
      now: () => new Date('2026-08-27T01:00:00.000Z'),
    } as const

    const gateway = createKledoHttpGateway(gatewayOptions)
    await expect(gateway.warmIdentityCatalog()).resolves.toEqual({
      counts: {
        salesperson: 2,
        contact: 4,
        customer: 1,
        vendor: 3,
        employee: 1,
        investor: 1,
        other_contact: 1,
        contact_type: 5,
        contact_group: 2,
        product: 2,
        product_category: 2,
        warehouse: 1,
        unit: 2,
        account: 2,
      },
      fetchedAt: '2026-08-27T01:00:00.000Z',
    })
    expect(requestedUrls).toEqual([
      '/api/v1/users',
      '/api/v1/finance/contacts?per_page=100&page=1',
      '/api/v1/finance/contacts?per_page=100&page=2',
      '/api/v1/finance/contactGroups',
      '/api/v1/finance/products?per_page=100&page=1',
      '/api/v1/finance/productCategories',
      '/api/v1/finance/warehouses',
      '/api/v1/finance/units?per_page=100&page=1',
      '/api/v1/finance/accounts?per_page=100&page=1',
    ])

    const { DatabaseSync } = await import('node:sqlite')
    const database = new DatabaseSync(identityCatalogPath, { readOnly: true })
    try {
      expect(
        database
          .prepare(
            `SELECT entity_type, COUNT(*) AS total, SUM(active) AS active
             FROM identity_records
             GROUP BY entity_type
             ORDER BY entity_type`,
          )
          .all()
          .map((record) => ({ ...record })),
      ).toEqual([
        { entity_type: 'account', total: 2, active: 2 },
        { entity_type: 'contact', total: 4, active: 3 },
        { entity_type: 'contact_group', total: 2, active: 2 },
        { entity_type: 'contact_type', total: 5, active: 5 },
        { entity_type: 'customer', total: 1, active: 0 },
        { entity_type: 'employee', total: 1, active: 1 },
        { entity_type: 'investor', total: 1, active: 1 },
        { entity_type: 'other_contact', total: 1, active: 1 },
        { entity_type: 'product', total: 2, active: 1 },
        { entity_type: 'product_category', total: 2, active: 2 },
        { entity_type: 'salesperson', total: 2, active: 1 },
        { entity_type: 'unit', total: 2, active: 2 },
        { entity_type: 'vendor', total: 3, active: 2 },
        { entity_type: 'warehouse', total: 1, active: 1 },
      ])
      expect(
        database
          .prepare(
            `SELECT entity_type, external_id, display_name
             FROM identity_records
             WHERE entity_type IN (
               'customer', 'vendor', 'employee', 'investor', 'other_contact', 'contact_type'
             )
             ORDER BY entity_type, external_id`,
          )
          .all()
          .map((record) => ({ ...record })),
      ).toEqual([
        { entity_type: 'contact_type', external_id: '1', display_name: 'Vendor' },
        { entity_type: 'contact_type', external_id: '2', display_name: 'Employee' },
        { entity_type: 'contact_type', external_id: '3', display_name: 'Customer' },
        { entity_type: 'contact_type', external_id: '4', display_name: 'Other' },
        { entity_type: 'contact_type', external_id: '5', display_name: 'Investor' },
        {
          entity_type: 'customer',
          external_id: '102',
          display_name: 'Archived Vendor Customer',
        },
        {
          entity_type: 'employee',
          external_id: '101',
          display_name: 'PT Vendor Employee',
        },
        {
          entity_type: 'investor',
          external_id: '104',
          display_name: 'Investor Contact',
        },
        {
          entity_type: 'other_contact',
          external_id: '103',
          display_name: 'Vendor Other Contact',
        },
        { entity_type: 'vendor', external_id: '101', display_name: 'PT Vendor Employee' },
        {
          entity_type: 'vendor',
          external_id: '102',
          display_name: 'Archived Vendor Customer',
        },
        {
          entity_type: 'vendor',
          external_id: '103',
          display_name: 'Vendor Other Contact',
        },
      ])
    } finally {
      database.close()
    }

    const databaseBytes = await readFile(identityCatalogPath)
    expect(databaseBytes.includes(Buffer.from('private@example.invalid'))).toBe(false)
    expect(databaseBytes.includes(Buffer.from('customer@example.invalid'))).toBe(false)
    expect(databaseBytes.includes(Buffer.from('+62000000000'))).toBe(false)
    expect(databaseBytes.includes(Buffer.from('private address'))).toBe(false)
    expect(databaseBytes.includes(Buffer.from('private-tax-id'))).toBe(false)
    expect(databaseBytes.includes(Buffer.from('private-balance'))).toBe(false)
    expect(databaseBytes.includes(Buffer.from('fixture-secret'))).toBe(false)

    const restartedGateway = createKledoHttpGateway(gatewayOptions)
    await restartedGateway.report({
      report: 'sales_by_person',
      period: { from: '2026-07-01', to: '2026-07-31' },
      dateBasis: 'trans_date',
      salesPersonName: 'warm seller',
      pageSize: 20,
    })
    expect(requestedUrls).toEqual([
      '/api/v1/users',
      '/api/v1/finance/contacts?per_page=100&page=1',
      '/api/v1/finance/contacts?per_page=100&page=2',
      '/api/v1/finance/contactGroups',
      '/api/v1/finance/products?per_page=100&page=1',
      '/api/v1/finance/productCategories',
      '/api/v1/finance/warehouses',
      '/api/v1/finance/units?per_page=100&page=1',
      '/api/v1/finance/accounts?per_page=100&page=1',
      '/api/v1/reportings/salesPerPerson?date_from=2026-07-01&date_to=2026-07-31&date_filter=trans_date&sales_id=7',
    ])
  })
})
