import { z } from 'zod'

import { compareDecimals, decimalString } from '../domain/decimal.js'
import type { JsonValue } from '../domain/json.js'
import type { KledoEntity, KledoQueryInput } from '../tools/schemas.js'
import { KledoError } from './errors.js'

type Filter = NonNullable<KledoQueryInput['filters']>[number]

const transactions = new Set<KledoEntity>([
  'sales_invoice',
  'purchase_invoice',
  'sales_order',
  'purchase_order',
  'sales_delivery',
  'purchase_delivery',
  'sales_quote',
  'purchase_quote',
  'bank_transaction',
  'expense',
])
const partyTransactions = new Set<KledoEntity>([
  'sales_invoice',
  'purchase_invoice',
  'sales_order',
  'purchase_order',
  'sales_delivery',
  'purchase_delivery',
  'sales_quote',
  'purchase_quote',
  'expense',
])
const productTransactions = new Set<KledoEntity>(partyTransactions)
const warehouseTransactions = new Set<KledoEntity>([
  'purchase_invoice',
  'sales_order',
  'purchase_order',
  'sales_delivery',
  'purchase_delivery',
  'sales_quote',
  'purchase_quote',
])
const salesTransactions = new Set<KledoEntity>(['sales_order', 'sales_delivery', 'sales_quote'])
const dueDateTransactions = new Set<KledoEntity>([
  'sales_invoice',
  'purchase_invoice',
  'sales_order',
  'purchase_order',
  'purchase_quote',
])
const shippingDateTransactions = new Set<KledoEntity>([
  'sales_invoice',
  'purchase_invoice',
  'sales_order',
  'sales_delivery',
  'sales_quote',
])
const paymentDateTransactions = new Set<KledoEntity>([
  'sales_invoice',
  'purchase_invoice',
  'sales_order',
  'purchase_order',
  'expense',
])
const amountTransactions = new Set<KledoEntity>([
  'sales_invoice',
  'purchase_invoice',
  'sales_order',
  'purchase_order',
  'sales_delivery',
  'sales_quote',
  'purchase_quote',
  'bank_transaction',
  'expense',
])

const commonDocumentFields = [
  'reference',
  'transactionDate',
  'dueDate',
  'shippingDate',
  'party',
  'memo',
  'statusId',
  'total',
  'remaining',
  'paymentState',
  'unbilled',
  'sourceUpdatedAt',
  'bankAccount',
  'transactionType',
]

const projectedFields: Record<KledoEntity, Set<string>> = {
  sales_invoice: new Set(commonDocumentFields),
  purchase_invoice: new Set(commonDocumentFields),
  sales_order: new Set(commonDocumentFields),
  purchase_order: new Set(commonDocumentFields),
  sales_delivery: new Set(commonDocumentFields),
  purchase_delivery: new Set(commonDocumentFields),
  sales_quote: new Set(commonDocumentFields),
  purchase_quote: new Set(commonDocumentFields),
  bank_transaction: new Set(commonDocumentFields),
  expense: new Set(commonDocumentFields),
  contact: new Set(['displayName', 'companyName', 'personName', 'groupId', 'typeIds', 'archived']),
  product: new Set([
    'code',
    'name',
    'category',
    'canSell',
    'canPurchase',
    'tracked',
    'basePrice',
    'salePrice',
  ]),
  account: new Set(['code', 'name', 'category', 'balance', 'archived']),
  warehouse: new Set(['name', 'archived']),
  unit: new Set(['name']),
}

const commonTransactionSort: Record<string, string> = {
  transactionDate: 'trans_date',
  statusId: 'status_id',
  dueDate: 'due_date',
  total: 'amount_after_tax',
  memo: 'memo',
  reference: 'ref_number',
}

const sortFields: Record<KledoEntity, Record<string, string>> = {
  sales_invoice: { ...commonTransactionSort, remaining: 'due', paymentDate: 'payment_date' },
  purchase_invoice: { ...commonTransactionSort, remaining: 'due', paymentDate: 'payment_date' },
  sales_order: commonTransactionSort,
  purchase_order: commonTransactionSort,
  sales_delivery: commonTransactionSort,
  purchase_delivery: commonTransactionSort,
  sales_quote: commonTransactionSort,
  purchase_quote: commonTransactionSort,
  bank_transaction: {
    transactionDate: 'trans_date',
    memo: 'memo',
    statusId: 'status_id',
  },
  expense: {
    transactionDate: 'trans_date',
    statusId: 'status_id',
    remaining: 'due',
    total: 'amount_after_tax',
    reference: 'ref_number',
  },
  contact: {
    name: 'name',
    company: 'company',
    payable: 'payable',
    receivable: 'receivable',
  },
  product: {
    name: 'name',
    code: 'code',
    category: 'category_name',
    basePrice: 'base_price',
    salePrice: 'price',
  },
  account: { name: 'name', code: 'ref_code', category: 'finance_account_category_id' },
  warehouse: {},
  unit: {},
}

function invalid(input: KledoQueryInput, filter: Filter): never {
  throw new KledoError(
    'INVALID_ARGUMENT',
    `Unsupported ${input.entity} filter: ${filter.field} ${filter.op}`,
  )
}

function scalarIds(input: KledoQueryInput, filter: Filter, allowIn = false): string {
  const scalarId = (value: unknown): string | undefined => {
    if (typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value)) return value
    return undefined
  }

  if (filter.op === 'eq') {
    const value = scalarId(filter.value)
    if (value !== undefined) return value
  }
  if (
    allowIn &&
    filter.op === 'in' &&
    Array.isArray(filter.value) &&
    filter.value.length > 0 &&
    filter.value.every((value) => scalarId(value) !== undefined)
  ) {
    return filter.value.map((value) => scalarId(value)).join(',')
  }
  return invalid(input, filter)
}

function booleanFlag(input: KledoQueryInput, filter: Filter): string {
  if (filter.op !== 'eq' || typeof filter.value !== 'boolean') return invalid(input, filter)
  return filter.value ? '1' : '0'
}

function dateValue(input: KledoQueryInput, filter: Filter, value: unknown): string {
  const parsed = z.string().date().safeParse(value)
  return parsed.success ? parsed.data : invalid(input, filter)
}

function applyRange(
  input: KledoQueryInput,
  filter: Filter,
  url: URL,
  fromName: string,
  toName: string,
  normalize: (input: KledoQueryInput, filter: Filter, value: unknown) => string,
  ordered?: (from: string, to: string) => boolean,
): void {
  if (filter.op === 'eq') {
    const value = normalize(input, filter, filter.value)
    url.searchParams.set(fromName, value)
    url.searchParams.set(toName, value)
    return
  }
  if (filter.op === 'gte') {
    url.searchParams.set(fromName, normalize(input, filter, filter.value))
    return
  }
  if (filter.op === 'lte') {
    url.searchParams.set(toName, normalize(input, filter, filter.value))
    return
  }
  if (
    filter.op === 'between' &&
    typeof filter.value === 'object' &&
    filter.value !== null &&
    !Array.isArray(filter.value) &&
    filter.value.from !== undefined &&
    filter.value.to !== undefined
  ) {
    const from = normalize(input, filter, filter.value.from)
    const to = normalize(input, filter, filter.value.to)
    if (ordered && !ordered(from, to)) invalid(input, filter)
    url.searchParams.set(fromName, from)
    url.searchParams.set(toName, to)
    return
  }
  invalid(input, filter)
}

function amountValue(input: KledoQueryInput, filter: Filter, value: unknown): string {
  if (typeof value !== 'string') return invalid(input, filter)
  try {
    return decimalString(value)
  } catch {
    return invalid(input, filter)
  }
}

function applyFilter(input: KledoQueryInput, filter: Filter, url: URL): void {
  if (filter.field === 'contactId' && partyTransactions.has(input.entity)) {
    url.searchParams.set('contact_id', scalarIds(input, filter))
    return
  }
  if (filter.field === 'statusId' && transactions.has(input.entity)) {
    const parameter = input.entity === 'sales_order' && filter.op === 'in' ? 'status_ids' : 'status_id'
    url.searchParams.set(parameter, scalarIds(input, filter, input.entity === 'sales_order'))
    return
  }
  if (filter.field === 'productId' && productTransactions.has(input.entity)) {
    url.searchParams.set('product_id', scalarIds(input, filter, true))
    return
  }
  if (filter.field === 'warehouseId' && warehouseTransactions.has(input.entity)) {
    url.searchParams.set(
      'warehouse_id',
      scalarIds(input, filter, input.entity !== 'sales_delivery'),
    )
    return
  }
  if (filter.field === 'salesPersonId' && salesTransactions.has(input.entity)) {
    url.searchParams.set('sales_id', scalarIds(input, filter))
    return
  }
  if (filter.field === 'bankAccountId' && input.entity === 'bank_transaction') {
    url.searchParams.set('bank_account_id', scalarIds(input, filter))
    return
  }
  if (filter.field === 'transactionType' && input.entity === 'bank_transaction') {
    url.searchParams.set('trans_type_ids', scalarIds(input, filter, true))
    return
  }
  if (filter.field === 'typeId' && input.entity === 'contact') {
    url.searchParams.set('type_id', scalarIds(input, filter))
    return
  }
  if (filter.field === 'groupId' && input.entity === 'contact') {
    url.searchParams.set('group_id', scalarIds(input, filter))
    return
  }
  if (filter.field === 'categoryId' && input.entity === 'product') {
    url.searchParams.set('cat_ids', scalarIds(input, filter, true))
    return
  }
  if (filter.field === 'categoryId' && input.entity === 'account') {
    url.searchParams.set('finance_account_category_id', scalarIds(input, filter))
    return
  }
  if (filter.field === 'archived' && ['contact', 'product', 'account'].includes(input.entity)) {
    url.searchParams.set('include_archive', booleanFlag(input, filter))
    return
  }
  if (filter.field === 'canSell' && input.entity === 'product') {
    url.searchParams.set('is_sell', booleanFlag(input, filter))
    return
  }
  if (filter.field === 'canPurchase' && input.entity === 'product') {
    url.searchParams.set('is_purchase', booleanFlag(input, filter))
    return
  }
  if (filter.field === 'tracked' && input.entity === 'product') {
    url.searchParams.set('is_track', booleanFlag(input, filter))
    return
  }
  if (filter.field === 'transactionDate' && transactions.has(input.entity)) {
    applyRange(input, filter, url, 'date_from', 'date_to', dateValue, (from, to) => from <= to)
    return
  }
  if (filter.field === 'dueDate' && dueDateTransactions.has(input.entity)) {
    applyRange(input, filter, url, 'due_date_from', 'due_date_to', dateValue, (from, to) => from <= to)
    return
  }
  if (filter.field === 'shippingDate' && shippingDateTransactions.has(input.entity)) {
    applyRange(input, filter, url, 'shipping_date_from', 'shipping_date_to', dateValue, (from, to) => from <= to)
    return
  }
  if (filter.field === 'paymentDate' && paymentDateTransactions.has(input.entity)) {
    applyRange(input, filter, url, 'payment_date_from', 'payment_date_to', dateValue, (from, to) => from <= to)
    return
  }
  if (filter.field === 'amount' && amountTransactions.has(input.entity)) {
    const fromName = input.entity === 'bank_transaction' ? 'amount_from' : 'amount_gte'
    const toName = input.entity === 'bank_transaction' ? 'amount_to' : 'amount_lte'
    applyRange(
      input,
      filter,
      url,
      fromName,
      toName,
      amountValue,
      (from, to) => compareDecimals(from, to) <= 0,
    )
    return
  }
  invalid(input, filter)
}

export function applyQueryOptions(input: KledoQueryInput, url: URL): void {
  validateFields(input.entity, input.fields)
  for (const filter of input.filters ?? []) applyFilter(input, filter, url)
  const sort = input.sort?.[0]
  if (sort) {
    const upstreamField = sortFields[input.entity][sort.field]
    if (!upstreamField) {
      throw new KledoError('INVALID_ARGUMENT', `Unsupported ${input.entity} sort: ${sort.field}`)
    }
    url.searchParams.set('sort_by', upstreamField)
    url.searchParams.set('order_by', sort.direction)
  }
  if (input.entity === 'bank_transaction' && !url.searchParams.has('bank_account_id')) {
    throw new KledoError('INVALID_ARGUMENT', 'bank_transaction requires bankAccountId eq filter')
  }
}

export function projectQueryItem(
  input: KledoQueryInput,
  item: Record<string, JsonValue>,
): Record<string, JsonValue> {
  return projectFields(input.entity, input.fields, item)
}

export function validateFields(entity: KledoEntity, fields: string[] | undefined): void {
  for (const field of fields ?? []) {
    if (field !== 'kind' && field !== 'id' && !projectedFields[entity].has(field)) {
      throw new KledoError('INVALID_ARGUMENT', `Unsupported ${entity} field: ${field}`)
    }
  }
}

export function projectFields(
  entity: KledoEntity,
  fields: string[] | undefined,
  item: Record<string, JsonValue>,
): Record<string, JsonValue> {
  validateFields(entity, fields)
  if (!fields?.length) return item
  const kind = item.kind
  const id = item.id
  if (typeof kind !== 'string' || typeof id !== 'string') {
    throw new KledoError('SCHEMA_MISMATCH', 'Normalized Kledo record is missing kind or id')
  }
  const projected: Record<string, JsonValue> = { kind, id }
  for (const field of fields) {
    const value = item[field]
    if (value !== undefined) projected[field] = value
  }
  return projected
}
