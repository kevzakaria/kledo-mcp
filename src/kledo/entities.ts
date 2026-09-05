import { z } from 'zod'

import { compareDecimals, decimalString } from '../domain/decimal.js'
import type { JsonValue } from '../domain/json.js'
import type { KledoEntity } from '../tools/schemas.js'

export const exactIdSchema = z.union([
  z.string().regex(/^\d+$/),
  z.number().int().nonnegative().refine(Number.isSafeInteger),
])
export const decimalSchema = z.union([
  z.string().regex(/^-?\d+(?:\.\d+)?$/),
  z
    .number()
    .finite()
    .refine((value) => Math.abs(value) <= Number.MAX_SAFE_INTEGER)
    .refine((value) => !String(value).toLowerCase().includes('e')),
])

const rawFlagSchema = z.union([z.boolean(), z.literal(0), z.literal(1)])

const rawContactSchema = z
  .object({
    id: exactIdSchema,
    name: z.string().nullable().optional(),
    company: z.string().nullable().optional(),
  })
  .passthrough()

const rawSalesPersonSchema = z
  .object({
    id: exactIdSchema,
    name: z.string(),
  })
  .passthrough()

const rawTagSchema = z
  .object({
    id: exactIdSchema,
    name: z.string(),
  })
  .passthrough()

const rawSalesMetadataSchema = z
  .object({
    sales_id: exactIdSchema.nullable().optional(),
    sales: rawSalesPersonSchema.nullable().optional(),
    sales_person: rawSalesPersonSchema.nullable().optional(),
    tags: z.array(rawTagSchema).default([]),
  })
  .passthrough()

const rawDocumentSchema = z
  .object({
    id: exactIdSchema,
    ref_number: z.string().nullable().optional(),
    trans_date: z.string().nullable().optional(),
    due_date: z.string().nullable().optional(),
    shipping_date: z.string().nullable().optional(),
    contact: rawContactSchema.nullable().optional(),
    amount_after_tax: decimalSchema.nullable().optional(),
    due: decimalSchema.nullable().optional(),
    unbilled_amount: decimalSchema.nullable().optional(),
    memo: z.string().nullable().optional(),
    status_id: exactIdSchema.nullable().optional(),
    updated_at: z.string().nullable().optional(),
    bank_account: z
      .object({ id: exactIdSchema, name: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
    trans_type: z.string().nullable().optional(),
  })
  .passthrough()

const rawContactRecordSchema = rawContactSchema.extend({
  group_id: exactIdSchema.nullable().optional(),
  type_ids: z.array(exactIdSchema).optional(),
  is_archive: rawFlagSchema.nullable().optional(),
})

const rawProductSchema = z
  .object({
    id: exactIdSchema,
    code: z.string().nullable().optional(),
    name: z.string(),
    product_category: z
      .object({ id: exactIdSchema, name: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
    is_sell: rawFlagSchema.nullable().optional(),
    is_purchase: rawFlagSchema.nullable().optional(),
    is_track: rawFlagSchema.nullable().optional(),
    base_price: decimalSchema.nullable().optional(),
    price: decimalSchema.nullable().optional(),
  })
  .passthrough()

const rawAccountSchema = z
  .object({
    id: exactIdSchema,
    ref_code: z.string().nullable().optional(),
    name: z.string(),
    finance_account_category: z
      .object({ id: exactIdSchema, name: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
    balance: decimalSchema.nullable().optional(),
    is_archive: rawFlagSchema.nullable().optional(),
  })
  .passthrough()

const rawNamedRecordSchema = z
  .object({
    id: exactIdSchema,
    name: z.string(),
    is_archive: rawFlagSchema.nullable().optional(),
  })
  .passthrough()

const rawGenericLineItemSchema = z
  .object({
    id: exactIdSchema.nullable().optional(),
    desc: z.string().nullable().optional(),
    qty: decimalSchema,
    unit_name: z.string().nullable().optional(),
    price: decimalSchema.nullable().optional(),
    subtotal: decimalSchema.nullable().optional(),
    amount_after_tax: decimalSchema.nullable().optional(),
    tax: decimalSchema.nullable().optional(),
    product: z
      .object({
        id: exactIdSchema,
        code: z.string().nullable().optional(),
        name: z.string(),
      })
      .passthrough()
      .nullable()
      .optional(),
    item_tax: z
      .object({
        id: exactIdSchema,
        name: z.string(),
        percent: decimalSchema,
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough()

const rawRelationRecordSchema = z
  .object({ id: exactIdSchema })
  .passthrough()
  .nullable()
  .optional()

const rawTransactionDetailExtrasSchema = z
  .object({
    items: z.array(rawGenericLineItemSchema).default([]),
    parent_tran: z
      .object({ id: exactIdSchema, trans_type_id: exactIdSchema.nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
    order: rawRelationRecordSchema,
    purchase_order: rawRelationRecordSchema,
    quote: rawRelationRecordSchema,
  })
  .passthrough()

export type EntityPagination = 'page' | 'single_page' | 'none'

export interface EntityDefinition {
  path: string
  detailPath: string | null
  pagination: EntityPagination
  supportsSearch: boolean
}

export const entityDefinitions: Record<KledoEntity, EntityDefinition> = {
  sales_invoice: {
    path: 'finance/invoices',
    detailPath: 'finance/invoices',
    pagination: 'page',
    supportsSearch: true,
  },
  purchase_invoice: {
    path: 'finance/purchaseInvoices',
    detailPath: 'finance/purchaseInvoices',
    pagination: 'page',
    supportsSearch: true,
  },
  sales_order: {
    path: 'finance/orders',
    detailPath: 'finance/orders',
    pagination: 'page',
    supportsSearch: true,
  },
  purchase_order: {
    path: 'finance/purchaseOrders',
    detailPath: 'finance/purchaseOrders',
    pagination: 'page',
    supportsSearch: true,
  },
  sales_delivery: {
    path: 'finance/deliveries',
    detailPath: 'finance/deliveries',
    pagination: 'page',
    supportsSearch: true,
  },
  purchase_delivery: {
    path: 'finance/purchaseDeliveries',
    detailPath: 'finance/purchaseDeliveries',
    pagination: 'page',
    supportsSearch: true,
  },
  sales_quote: {
    path: 'finance/quotes',
    detailPath: 'finance/quotes',
    pagination: 'page',
    supportsSearch: true,
  },
  purchase_quote: {
    path: 'finance/purchaseQuotes',
    detailPath: 'finance/purchaseQuotes',
    pagination: 'page',
    supportsSearch: true,
  },
  contact: {
    path: 'finance/contacts',
    detailPath: 'finance/contacts',
    pagination: 'page',
    supportsSearch: true,
  },
  product: {
    path: 'finance/products',
    detailPath: 'finance/products',
    pagination: 'single_page',
    supportsSearch: true,
  },
  account: {
    path: 'finance/accounts',
    detailPath: 'finance/accounts',
    pagination: 'page',
    supportsSearch: true,
  },
  bank_transaction: {
    path: 'finance/bankTrans',
    detailPath: 'finance/bankTrans',
    pagination: 'page',
    supportsSearch: true,
  },
  expense: {
    path: 'finance/expenses',
    detailPath: 'finance/expenses',
    pagination: 'page',
    supportsSearch: true,
  },
  warehouse: {
    path: 'finance/warehouses',
    detailPath: 'finance/warehouses',
    pagination: 'none',
    supportsSearch: false,
  },
  unit: {
    path: 'finance/units',
    detailPath: null,
    pagination: 'single_page',
    supportsSearch: false,
  },
}

export const transactionIncludeEntities = new Set<KledoEntity>([
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

function id(value: z.infer<typeof exactIdSchema>): string {
  return String(value)
}

function flag(value: boolean | number | null | undefined): boolean | null {
  if (value === null || value === undefined) return null
  return value === true || value === 1
}

interface CurrencyMetadata {
  code?: string
  id?: string
  name?: string
}

function currencyCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(normalized) ? normalized : undefined
}

function currencyName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function currencyId(value: unknown): string | undefined {
  const parsed = exactIdSchema.safeParse(value)
  return parsed.success ? id(parsed.data) : undefined
}

function currencyMetadata(source: unknown): CurrencyMetadata {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return {}
  const carrier = source as Record<string, unknown>
  const nested =
    typeof carrier.currency === 'object' &&
    carrier.currency !== null &&
    !Array.isArray(carrier.currency)
      ? (carrier.currency as Record<string, unknown>)
      : undefined

  const directId = currencyId(carrier.currency_id)
  const nestedId = currencyId(nested?.id ?? nested?.currency_id)
  const idsMatch = directId === undefined || nestedId === undefined || directId === nestedId
  const directCode = currencyCode(carrier.currency_code)
  const nestedCode =
    typeof carrier.currency === 'string'
      ? currencyCode(carrier.currency)
      : currencyCode(nested?.code ?? nested?.currency_code)
  const directName = currencyName(carrier.currency_name)
  const nestedName = currencyName(nested?.name ?? nested?.currency_name)

  return {
    id: directId ?? nestedId,
    code: directCode ?? (idsMatch ? nestedCode : undefined),
    name: directName ?? (idsMatch ? nestedName : undefined),
  }
}

export function normalizeMoney(
  value: unknown,
  source?: unknown,
  fallbackSource?: unknown,
): Record<string, JsonValue> {
  const amount = decimalSchema.parse(value)
  const primary = currencyMetadata(source)
  const fallback = currencyMetadata(fallbackSource)
  const primaryIsEmpty =
    primary.id === undefined && primary.code === undefined && primary.name === undefined
  const sameCurrency =
    (primary.id !== undefined && fallback.id === primary.id) ||
    (primary.code !== undefined && fallback.code === primary.code)
  const metadata = primaryIsEmpty
    ? fallback
    : sameCurrency
      ? {
          id: primary.id ?? fallback.id,
          code: primary.code ?? fallback.code,
          name: primary.name ?? fallback.name,
        }
      : primary

  return {
    amount: decimalString(amount),
    currency: metadata.code ?? null,
    ...(metadata.id === undefined ? {} : { currencyId: metadata.id }),
    ...(metadata.name === undefined ? {} : { currencyName: metadata.name }),
  }
}

function contactName(contact: z.infer<typeof rawContactSchema>): Record<string, JsonValue> {
  const companyName = contact.company?.trim() || null
  const personName = contact.name?.trim() || null
  return {
    id: id(contact.id),
    displayName: companyName || personName || 'Unknown contact',
    companyName,
    personName,
  }
}

export function normalizeSalesInvoiceMetadata(value: unknown): Record<string, JsonValue> {
  const metadata = rawSalesMetadataSchema.parse(value)
  return {
    salesPerson:
      metadata.sales_id === null ||
      metadata.sales_id === undefined ||
      metadata.sales === null ||
      metadata.sales === undefined
        ? null
        : {
            id: id(metadata.sales_id),
            name: metadata.sales.name,
          },
    tags: metadata.tags.map((tag) => ({ id: id(tag.id), name: tag.name })),
  }
}

function normalizeSalesMetadata(value: unknown): Record<string, JsonValue> {
  const metadata = rawSalesMetadataSchema.parse(value)
  const salesperson = metadata.sales_person ?? metadata.sales
  return {
    salesPerson: salesperson
      ? { id: id(salesperson.id), name: salesperson.name }
      : metadata.sales_id === null || metadata.sales_id === undefined
        ? null
        : { id: id(metadata.sales_id), name: null },
    tags: metadata.tags.map((tag) => ({ id: id(tag.id), name: tag.name })),
  }
}

const documentsWithSalesMetadata: Partial<Record<KledoEntity, true>> = {
  sales_invoice: true,
  sales_order: true,
}

function normalizeDocument(entity: KledoEntity, value: unknown): Record<string, JsonValue> {
  const document = rawDocumentSchema.parse(value)
  const result: Record<string, JsonValue> = {
    kind: entity,
    id: id(document.id),
    reference: document.ref_number ?? null,
    transactionDate: document.trans_date ?? null,
    dueDate: document.due_date ?? null,
    shippingDate: document.shipping_date ?? null,
    party: document.contact ? contactName(document.contact) : null,
    memo: document.memo ?? null,
    statusId:
      document.status_id === null || document.status_id === undefined ? null : id(document.status_id),
    sourceUpdatedAt: document.updated_at ?? null,
  }
  if (documentsWithSalesMetadata[entity]) {
    Object.assign(result, normalizeSalesMetadata(value))
  }
  if (document.amount_after_tax !== null && document.amount_after_tax !== undefined) {
    result.total = normalizeMoney(document.amount_after_tax, document)
  }
  if (document.due !== null && document.due !== undefined) {
    result.remaining = normalizeMoney(document.due, document)
    if (document.amount_after_tax !== null && document.amount_after_tax !== undefined) {
      const total = decimalString(document.amount_after_tax)
      const remaining = decimalString(document.due)
      result.paymentState =
        compareDecimals(remaining, '0') <= 0
          ? 'paid'
          : compareDecimals(remaining, total) >= 0
            ? 'unpaid'
            : 'partially_paid'
    }
  }
  if (document.unbilled_amount !== null && document.unbilled_amount !== undefined) {
    result.unbilled = normalizeMoney(document.unbilled_amount, document)
  }
  if (document.bank_account) {
    result.bankAccount = {
      id: id(document.bank_account.id),
      name: document.bank_account.name ?? null,
    }
  }
  if (document.trans_type !== null && document.trans_type !== undefined) {
    result.transactionType = document.trans_type
  }
  return result
}

export function normalizeEntityItem(
  entity: KledoEntity,
  value: unknown,
): Record<string, JsonValue> {
  switch (entity) {
    case 'contact': {
      const contact = rawContactRecordSchema.parse(value)
      return {
        kind: entity,
        ...contactName(contact),
        groupId: contact.group_id === null || contact.group_id === undefined ? null : id(contact.group_id),
        typeIds: (contact.type_ids ?? []).map(id),
        archived: flag(contact.is_archive),
      }
    }
    case 'product': {
      const product = rawProductSchema.parse(value)
      return {
        kind: entity,
        id: id(product.id),
        code: product.code ?? null,
        name: product.name,
        category: product.product_category
          ? { id: id(product.product_category.id), name: product.product_category.name ?? null }
          : null,
        canSell: flag(product.is_sell),
        canPurchase: flag(product.is_purchase),
        tracked: flag(product.is_track),
        basePrice:
          product.base_price === null || product.base_price === undefined
            ? null
            : normalizeMoney(product.base_price, product),
        salePrice:
          product.price === null || product.price === undefined
            ? null
            : normalizeMoney(product.price, product),
      }
    }
    case 'account': {
      const account = rawAccountSchema.parse(value)
      return {
        kind: entity,
        id: id(account.id),
        code: account.ref_code ?? null,
        name: account.name,
        category: account.finance_account_category
          ? {
              id: id(account.finance_account_category.id),
              name: account.finance_account_category.name ?? null,
            }
          : null,
        balance:
          account.balance === null || account.balance === undefined
            ? null
            : normalizeMoney(account.balance, account),
        archived: flag(account.is_archive),
      }
    }
    case 'warehouse':
    case 'unit': {
      const record = rawNamedRecordSchema.parse(value)
      return {
        kind: entity,
        id: id(record.id),
        name: record.name,
        ...(entity === 'warehouse' ? { archived: flag(record.is_archive) } : {}),
      }
    }
    default:
      return normalizeDocument(entity, value)
  }
}

export interface NormalizedTransactionExtras {
  lineItems: Array<Record<string, JsonValue>>
  relations: Array<{ relation: string; entity?: KledoEntity; id: string }>
}

export function normalizeTransactionExtras(
  entity: KledoEntity,
  value: unknown,
): NormalizedTransactionExtras {
  const detail = rawTransactionDetailExtrasSchema.parse(value)
  const lineItems = detail.items.map((item) => {
    const normalized: Record<string, JsonValue> = {
      id: item.id === null || item.id === undefined ? null : id(item.id),
      description: item.desc ?? null,
      quantity: decimalString(item.qty),
      unit: item.unit_name ?? null,
      product: item.product
        ? { id: id(item.product.id), code: item.product.code ?? null, name: item.product.name }
        : null,
    }
    if (item.price !== null && item.price !== undefined) {
      normalized.unitPrice = normalizeMoney(item.price, item, detail)
    }
    if (item.subtotal !== null && item.subtotal !== undefined) {
      normalized.subtotal = normalizeMoney(item.subtotal, item, detail)
    }
    if (item.amount_after_tax !== null && item.amount_after_tax !== undefined) {
      normalized.total = normalizeMoney(item.amount_after_tax, item, detail)
    }
    if (item.tax !== null && item.tax !== undefined) {
      normalized.tax = normalizeMoney(item.tax, item, detail)
    }
    if (item.item_tax) {
      normalized.taxRate = {
        id: id(item.item_tax.id),
        name: item.item_tax.name,
        percent: decimalString(item.item_tax.percent),
      }
    }
    return normalized
  })

  const relations: NormalizedTransactionExtras['relations'] = []
  const add = (target: z.infer<typeof rawRelationRecordSchema>, targetEntity: KledoEntity) => {
    if (!target) return
    const targetId = id(target.id)
    if (relations.some((relation) => relation.entity === targetEntity && relation.id === targetId)) return
    relations.push({ relation: 'derived_from', entity: targetEntity, id: targetId })
  }
  add(detail.order, 'sales_order')
  add(detail.purchase_order, 'purchase_order')
  add(detail.quote, 'sales_quote')
  if (detail.parent_tran) {
    const targetEntity: KledoEntity =
      entity === 'purchase_invoice' || entity === 'purchase_delivery'
        ? 'purchase_order'
        : 'sales_order'
    add(detail.parent_tran, targetEntity)
  }

  return { lineItems, relations }
}
