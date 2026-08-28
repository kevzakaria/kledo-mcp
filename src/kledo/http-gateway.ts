import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import { z } from 'zod'

import { addDecimals, compareDecimals, decimalString } from '../domain/decimal.js'
import {
  documentLifecycleRank,
  documentTypeForTransactionTypeId,
  transactionTypeIdByDocumentType,
  type KledoDocumentType,
} from '../domain/document-lineage.js'
import type { JsonValue } from '../domain/json.js'
import {
  createSqliteTenantIdentityCatalog,
  identityEntityTypes,
  type IdentityEntityType,
} from '../identity/tenant-identity-catalog.js'
import {
  decimalSchema,
  entityDefinitions,
  exactIdSchema,
  normalizeEntityItem,
  normalizeMoney,
  normalizeTransactionExtras,
  transactionIncludeEntities,
} from './entities.js'
import { errorForHttpStatus, KledoError } from './errors.js'
import {
  KLEDO_DOCUMENT_RESOURCE,
  type KledoGateway,
  type KledoGetResult,
} from './gateway.js'
import {
  applyQueryOptions,
  projectFields,
  projectQueryItem,
  validateFields,
} from './query-options.js'
import type {
  KledoGetInput,
  KledoInvoicePayment,
  KledoPaymentEvent,
  KledoQueryInput,
  KledoQueryOutput,
  KledoReportInput,
  KledoReportOutput,
} from '../tools/schemas.js'
import {
  invoicePaymentOutputSchema,
  jsonValueSchema,
  kledoReportOutputSchema,
  paymentEventOutputSchema,
} from '../tools/schemas.js'

const rawContactSchema = z
  .object({
    id: exactIdSchema,
    name: z.string().nullable().optional(),
    company: z.string().nullable().optional(),
  })
  .passthrough()

const rawSalesInvoiceSchema = z
  .object({
    id: exactIdSchema,
    ref_number: z.string(),
    trans_date: z.string(),
    due_date: z.string().nullable(),
    shipping_date: z.string().nullable().optional(),
    contact: rawContactSchema,
    amount_after_tax: decimalSchema,
    due: decimalSchema,
    memo: z.string().nullable(),
    status_id: exactIdSchema.nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough()

const rawSalesInvoiceLineItemSchema = z
  .object({
    id: exactIdSchema,
    desc: z.string().nullable(),
    qty: decimalSchema,
    price: decimalSchema,
    amount: decimalSchema,
    amount_after_tax: decimalSchema,
    tax: decimalSchema,
    subtotal: decimalSchema,
    product: z
      .object({
        id: exactIdSchema,
        code: z.string().nullable(),
        name: z.string(),
      })
      .passthrough()
      .nullable(),
    item_tax: z
      .object({
        id: exactIdSchema,
        name: z.string(),
        percent: decimalSchema,
      })
      .passthrough()
      .nullable(),
  })
  .passthrough()

const rawDocumentRelationSchema = z
  .object({
    id: exactIdSchema.refine((value) => /^[1-9]\d{0,19}$/.test(String(value))),
    ref_number: z.string().trim().min(1),
    trans_type_id: exactIdSchema.refine((value) => /^[1-9]\d{0,19}$/.test(String(value))),
    trans_date: z.string().date().nullable().optional(),
    business_tran_id: exactIdSchema.nullable().optional(),
    amount_after_tax: decimalSchema.nullable().optional(),
  })
  .passthrough()

const rawSalesInvoiceDetailSchema = rawSalesInvoiceSchema.extend({
  trans_type_id: exactIdSchema.nullable().optional(),
  print_url: z.string().trim().min(1).max(2048).nullable().optional(),
  items: z.array(rawSalesInvoiceLineItemSchema).default([]),
  relations: z.array(rawDocumentRelationSchema).default([]),
  parent_tran: z
    .object({
      id: exactIdSchema,
      ref_number: z.string(),
      trans_type_id: exactIdSchema.nullable().optional(),
      trans_date: z.string().nullable().optional(),
    })
    .passthrough()
    .nullable()
    .optional(),
})

const rawPurchaseInvoiceDetailSchema = rawSalesInvoiceSchema.extend({
  trans_type_id: exactIdSchema.nullable().optional(),
  items: z.array(z.unknown()).default([]),
  relations: z.array(rawDocumentRelationSchema).default([]),
  transactions: z.array(z.unknown()).default([]),
  parent_tran: z
    .object({
      id: exactIdSchema,
      ref_number: z.string(),
      trans_type_id: exactIdSchema.nullable().optional(),
      trans_date: z.string().nullable().optional(),
    })
    .passthrough()
    .nullable()
    .optional(),
})

const rawInvoicePaymentIdSchema = exactIdSchema.refine(
  (value) => /^[1-9]\d{0,19}$/.test(String(value)),
)

const rawInvoiceTransactionDiscriminatorSchema = z
  .object({ trans_type_id: rawInvoicePaymentIdSchema })
  .passthrough()

const rawInvoicePaymentSchema = z
  .object({
    id: rawInvoicePaymentIdSchema,
    business_tran_id: rawInvoicePaymentIdSchema,
    trans_type_id: rawInvoicePaymentIdSchema,
    trans_date: z.string().date(),
    amount_after_tax: decimalSchema,
    status_id: rawInvoicePaymentIdSchema.nullable().optional(),
    bank_account_id: rawInvoicePaymentIdSchema.nullable().optional(),
    payment_type_id: rawInvoicePaymentIdSchema.nullable().optional(),
    bank_account: z
      .object({
        id: rawInvoicePaymentIdSchema,
        name: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough()

const rawEntityPageEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({
    current_page: z.number().int().positive(),
    last_page: z.number().int().positive(),
    per_page: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    data: z.array(z.unknown()),
  }),
})

const rawEntityArrayEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.union([
    z.array(z.unknown()),
    z.object({
      data: z.array(z.unknown()),
    }),
  ]),
})

const rawEntityDetailEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.unknown(),
})

const rawSalesInvoiceDetailEnvelopeSchema = z.object({
  success: z.literal(true),
  data: rawSalesInvoiceDetailSchema,
})

const rawPurchaseInvoiceDetailEnvelopeSchema = z.object({
  success: z.literal(true),
  data: rawPurchaseInvoiceDetailSchema,
})

const rawInvoicePaymentsEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.array(z.unknown()),
})

const rawNativeReportEnvelopeSchema = z
  .object({
    success: z.literal(true),
    data: jsonValueSchema,
    _cache_meta: z
      .object({
        from_cache: z.boolean(),
        cache_age_seconds: z.number().int().nonnegative(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

const rawNativeReportPageEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({
    current_page: z.number().int().positive(),
    last_page: z.number().int().positive(),
    per_page: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    data: z.array(jsonValueSchema),
  }),
})

const rawAgedReceivableDueSchema = z
  .object({
    '-3': decimalSchema,
    '-2': decimalSchema,
    '-1': decimalSchema,
    '0': decimalSchema,
    '1': decimalSchema,
    '2': decimalSchema,
    '3': decimalSchema,
    '4': decimalSchema,
  })
  .strict()

const rawAgedReceivableSummaryDueSchema = rawAgedReceivableDueSchema.omit({ '-3': true })

const rawAgedReceivableCustomerSchema = z
  .object({
    id: exactIdSchema.refine((value) => /^[1-9]\d{0,19}$/.test(String(value))),
    name: z.string().nullable().optional(),
    company: z.string().nullable().optional(),
    due: rawAgedReceivableSummaryDueSchema,
  })
  .passthrough()

const rawAgedReceivablePageEnvelopeSchema = z
  .object({
    success: z.literal(true),
    data: z
      .object({
        current_page: z.number().int().positive(),
        last_page: z.number().int().positive(),
        per_page: z.number().int().positive(),
        total: z.number().int().nonnegative(),
        data: z.array(rawAgedReceivableCustomerSchema),
      })
      .passthrough(),
  })
  .passthrough()

const rawAgedReceivableInvoiceSchema = z
  .object({
    id: exactIdSchema.refine((value) => /^[1-9]\d{0,19}$/.test(String(value))),
    trans_date: z.string().date(),
    due_date: z.string().date().nullable(),
    ref_number: z.string().trim().min(1),
    memo: z.string().nullable(),
    due: rawAgedReceivableDueSchema,
    age_due: z.number().int().safe(),
    age_trans: z.number().int().safe(),
  })
  .passthrough()

const rawAgedReceivableDetailEnvelopeSchema = z
  .object({
    success: z.literal(true),
    data: z
      .object({
        current_page: z.number().int().positive(),
        last_page: z.number().int().positive(),
        per_page: z.number().int().positive(),
        total: z.number().int().nonnegative(),
        total_due: rawAgedReceivableDueSchema,
        contact: rawContactSchema,
        data: z.array(rawAgedReceivableInvoiceSchema),
      })
      .passthrough(),
  })
  .passthrough()

const rawSalesByPersonRowSchema = z
  .object({
    sales_id: exactIdSchema.refine((value) => /^[1-9]\d{0,19}$/.test(String(value))),
    sales: z
      .object({
        id: exactIdSchema.refine((value) => /^[1-9]\d{0,19}$/.test(String(value))),
        name: z.string().trim().min(1),
      })
      .passthrough(),
    total_amount_after_tax: decimalSchema,
    total_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    total_commission: decimalSchema,
  })
  .passthrough()

const rawSalesByPersonEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.array(rawSalesByPersonRowSchema),
})

const rawSalesOrderKpiRowSchema = z
  .object({
    id: exactIdSchema.refine((value) => /^[1-9]\d{0,19}$/.test(String(value))),
    trans_type_id: exactIdSchema,
    trans_date: z.string().date(),
    status_id: exactIdSchema,
    sales_id: exactIdSchema.nullable().optional(),
  })
  .passthrough()

const rawSalesOrderPageAggregateSchema = z
  .object({
    qty: decimalSchema,
    amount: decimalSchema,
    amount_after_tax: decimalSchema,
    unbilled_amount: decimalSchema,
  })
  .passthrough()

const rawSalesOrderKpiPageEnvelopeSchema = z
  .object({
    success: z.literal(true),
    data: z
      .object({
        current_page: z.number().int().positive(),
        last_page: z.number().int().positive(),
        per_page: z.number().int().positive(),
        total: z.number().int().nonnegative(),
        data: z.array(rawSalesOrderKpiRowSchema),
        grand_subtotal: rawSalesOrderPageAggregateSchema,
      })
      .passthrough(),
  })
  .passthrough()

const rawIncomePerCustomerRowSchema = z
  .object({
    contact_id: exactIdSchema.refine((value) => /^[1-9]\d{0,19}$/.test(String(value))),
    amount: decimalSchema,
    total_transactions: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    contact: rawContactSchema,
  })
  .passthrough()

const rawIncomePerCustomerPageEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({
    current_page: z.number().int().positive(),
    last_page: z.number().int().positive(),
    per_page: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    data: z.array(rawIncomePerCustomerRowSchema),
  }),
})

const rawKledoUserSchema = z
  .object({
    id: exactIdSchema.refine((value) => /^[1-9]\d{0,19}$/.test(String(value))),
    name: z.string().trim().min(1),
    is_active: z.boolean().default(true),
  })
  .passthrough()

const rawUsersEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.union([
    z.array(rawKledoUserSchema),
    z
      .object({
        data: z.array(rawKledoUserSchema),
      })
      .passthrough(),
  ]),
})

const rawIdentityContactSchema = z
  .object({
    id: exactIdSchema.refine((value) => /^[1-9]\d{0,19}$/.test(String(value))),
    name: z.string().nullable().optional(),
    company: z.string().nullable().optional(),
    type_ids: z.array(exactIdSchema),
    is_archive: z.union([z.boolean(), z.literal(0), z.literal(1)]).nullable().optional(),
  })
  .passthrough()

const rawIdentityNamedRecordSchema = z
  .object({
    id: exactIdSchema.refine((value) => /^[1-9]\d{0,19}$/.test(String(value))),
    name: z.string().trim().min(1),
    is_archive: z.union([z.boolean(), z.literal(0), z.literal(1)]).nullable().optional(),
    deleted_at: z.unknown().nullable().optional(),
  })
  .passthrough()

const rawProductIdentitySchema = z
  .object({
    id: exactIdSchema.refine((value) => /^[1-9]\d{0,19}$/.test(String(value))),
    code: z.string().trim().min(1).nullable().optional(),
    name: z.string().trim().min(1),
    is_archive: z.union([z.boolean(), z.literal(0), z.literal(1)]).nullable().optional(),
  })
  .passthrough()

const rawProductPriceDetailSchema = z
  .object({
    id: exactIdSchema.refine((value) => /^[1-9]\d{0,19}$/.test(String(value))),
    code: z.string().trim().min(1).nullable().optional(),
    name: z.string().trim().min(1),
    price: decimalSchema.nullable().optional(),
    base_price: decimalSchema.nullable().optional(),
    avg_base_price: decimalSchema.nullable().optional(),
    is_sell: z.union([z.boolean(), z.literal(0), z.literal(1)]).nullable().optional(),
    is_purchase: z.union([z.boolean(), z.literal(0), z.literal(1)]).nullable().optional(),
    is_track: z.union([z.boolean(), z.literal(0), z.literal(1)]).nullable().optional(),
    unit: z
      .object({
        id: exactIdSchema.refine((value) => /^[1-9]\d{0,19}$/.test(String(value))),
        name: z.string().trim().min(1),
      })
      .passthrough()
      .nullable()
      .optional(),
    last_sale_transaction: z
      .object({ trans_date: z.string().date() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough()

const rawProductPriceDetailEnvelopeSchema = z.object({
  success: z.literal(true),
  data: rawProductPriceDetailSchema,
})

const rawLatestSellPriceSchema = z
  .object({
    id: exactIdSchema.refine((value) => /^[1-9]\d{0,19}$/.test(String(value))),
    last_sell_price: decimalSchema.nullable(),
  })
  .passthrough()

const rawLatestSellPriceEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.array(rawLatestSellPriceSchema),
})

const rawLatestPurchasePriceSchema = z
  .object({
    last_buy_price: decimalSchema.nullable(),
  })
  .passthrough()

const rawLatestPurchasePriceEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.record(z.string().regex(/^[1-9]\d{0,19}$/), rawLatestPurchasePriceSchema),
})

const rawProductPurchaseTransactionSchema = z
  .object({
    id: exactIdSchema.refine((value) => /^[1-9]\d{0,19}$/.test(String(value))),
    trans_type_id: exactIdSchema.refine((value) => /^[1-9]\d{0,19}$/.test(String(value))),
    trans_date: z.string().date(),
    price: decimalSchema.nullable(),
  })
  .passthrough()

const rawProductPurchaseTransactionsEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({
    current_page: z.number().int().positive(),
    last_page: z.number().int().positive(),
    per_page: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    data: z.array(rawProductPurchaseTransactionSchema),
  }),
})

const rawProductProfitabilitySchema = z
  .object({
    product_id: exactIdSchema.refine((value) => /^[1-9]\d{0,19}$/.test(String(value))),
    qty: decimalSchema,
    total_sales: decimalSchema,
    total_hpp: decimalSchema,
    product: z
      .object({
        id: exactIdSchema.refine((value) => /^[1-9]\d{0,19}$/.test(String(value))),
        name: z.string().trim().min(1),
        code: z.string().trim().min(1).nullable().optional(),
      })
      .passthrough(),
    total_profit: decimalSchema,
    profit_margin: decimalSchema,
    avg_sales: decimalSchema,
    avg_hpp: decimalSchema,
    method: z.enum(['inventory', 'non_inventory', 'package']),
    date_from: z.string().date(),
    date_to: z.string().date(),
  })
  .passthrough()

const rawProductProfitabilityEnvelopeSchema = z.object({
  success: z.literal(true),
  data: rawProductProfitabilitySchema,
})

const rawIdentityArrayEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.union([
    z.array(z.unknown()),
    z
      .object({
        data: z.array(z.unknown()),
      })
      .passthrough(),
  ]),
})

interface RawProductCategory {
  id: string | number
  name: string
  children: RawProductCategory[]
}

const rawProductCategorySchema: z.ZodType<RawProductCategory> = z.lazy(() =>
  z
    .object({
      id: exactIdSchema.refine((value) => /^[1-9]\d{0,19}$/.test(String(value))),
      name: z.string().trim().min(1),
      children: z.array(rawProductCategorySchema).default([]),
    })
    .passthrough(),
)

interface JsonParseSourceContext {
  source?: string
}

function parseJsonWithExactNumbers(text: string): unknown {
  return JSON.parse(
    text,
    (_key: string, value: unknown, context?: JsonParseSourceContext): unknown => {
      if (typeof value !== 'number') return value

      // Node 22 exposes the original numeric token so decimals never depend on
      // an already-rounded IEEE-754 value.
      const source = context?.source
      if (source === undefined) {
        throw new Error('JSON parser did not expose the numeric source token')
      }
      if (/^-?(?:0|[1-9]\d*)$/.test(source)) {
        if (!Number.isSafeInteger(value)) {
          throw new Error('JSON integer exceeds the lossless numeric range')
        }
        return value
      }

      return source
    },
  ) as unknown
}

export interface CreateKledoHttpGatewayOptions {
  baseUrl: URL
  token: string
  tenant?: string
  allowInsecureLoopback?: boolean
  now?: () => Date
  timeoutMs?: number
  maxAttempts?: number
  maxResponseBytes?: number
  maxPrintDocumentBytes?: number
  printDocumentTimeoutMs?: number
  maxConcurrency?: number
  salespersonCacheTtlMs?: number
  salespersonCacheMaxUsers?: number
  identityCatalogPath?: string
  diagnostic?: (event: KledoGatewayDiagnosticEvent) => void
  sleep?: (milliseconds: number) => Promise<void>
}

export interface KledoIdentityWarmupResult {
  counts: Record<IdentityEntityType, number>
  fetchedAt: string
}

export interface KledoHttpGateway extends KledoGateway {
  warmIdentityCatalog(signal?: AbortSignal): Promise<KledoIdentityWarmupResult>
}

export interface KledoGatewayDiagnosticEvent {
  event:
    | 'identity.memory.hit'
    | 'identity.sqlite.hit'
    | 'identity.sqlite.name_miss'
    | 'identity.sqlite.snapshot_miss'
    | 'identity.sqlite.unavailable'
    | 'identity.sqlite.write'
    | 'identity.sqlite.write_failed'
    | 'identity.upstream.refresh'
    | 'get.sales_invoice.detail.request'
    | 'get.sales_invoice.payment_events.request'
    | 'get.sales_invoice.print_document.request'
    | 'get.purchase_invoice.detail.request'
    | 'report.sales_by_person.request'
    | 'report.sales_order_kpi.orders.request'
    | 'report.dormant_customers.historical.request'
    | 'report.dormant_customers.recent.request'
    | 'report.receivable_by_invoice.customer_totals.request'
    | 'report.receivable_by_invoice.invoice_breakdown.request'
    | 'report.item_price_analysis.product_search.request'
    | 'report.item_price_analysis.product_detail.request'
    | 'report.item_price_analysis.latest_sell.request'
    | 'report.item_price_analysis.latest_purchase.request'
    | 'report.item_price_analysis.purchase_transactions.request'
    | 'report.item_price_analysis.profitability.request'
}

function assertBaseUrl(url: URL, allowInsecureLoopback: boolean): void {
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
  const localFixture = allowInsecureLoopback && url.protocol === 'http:' && loopback
  if (url.protocol !== 'https:' && !localFixture) {
    throw new Error('KLEDO_API_BASE_URL must use HTTPS')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('KLEDO_API_BASE_URL must not contain credentials, a query, or a fragment')
  }
  if (url.pathname.replace(/\/$/, '') !== '/api/v1') {
    throw new Error('KLEDO_API_BASE_URL must end at /api/v1/')
  }
}

function normalizedBaseUrl(input: URL): URL {
  const url = new URL(input)
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

function shiftIsoDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00.000Z`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

function paymentState(total: string, remaining: string): 'paid' | 'partially_paid' | 'unpaid' {
  if (compareDecimals(remaining, '0') <= 0) return 'paid'
  if (compareDecimals(remaining, total) >= 0) return 'unpaid'
  return 'partially_paid'
}

function displayName(contact: { name?: string | null; company?: string | null }): string {
  const company = contact.company?.trim()
  const person = contact.name?.trim()
  return company || person || 'Unknown contact'
}

function normalizedSalesInvoice(invoice: z.infer<typeof rawSalesInvoiceSchema>): Record<string, JsonValue> {
  const total = decimalString(invoice.amount_after_tax)
  const remaining = decimalString(invoice.due)
  const companyName = invoice.contact.company?.trim() || null
  const personName = invoice.contact.name?.trim() || null

  return {
    kind: 'sales_invoice',
    id: String(invoice.id),
    reference: invoice.ref_number,
    transactionDate: invoice.trans_date,
    dueDate: invoice.due_date,
    shippingDate: invoice.shipping_date ?? null,
    party: {
      id: String(invoice.contact.id),
      displayName: displayName(invoice.contact),
      companyName,
      personName,
    },
    memo: invoice.memo,
    statusId:
      invoice.status_id === null || invoice.status_id === undefined ? null : String(invoice.status_id),
    total: normalizeMoney(invoice.amount_after_tax, invoice),
    remaining: normalizeMoney(invoice.due, invoice),
    paymentState: paymentState(total, remaining),
    sourceUpdatedAt: invoice.updated_at ?? null,
  }
}

function normalizedPaymentTransactions(
  invoiceId: string,
  rawTransactions: unknown[],
  paymentTransactionTypeId: string,
): KledoInvoicePayment[] {
  const paymentsById = new Map<string, KledoInvoicePayment>()

  for (const rawTransaction of rawTransactions) {
    const discriminator = rawInvoiceTransactionDiscriminatorSchema.parse(rawTransaction)
    if (String(discriminator.trans_type_id) !== paymentTransactionTypeId) continue
    const payment = rawInvoicePaymentSchema.parse(rawTransaction)
    if (String(payment.business_tran_id) !== invoiceId) {
      throw new KledoError(
        'SCHEMA_MISMATCH',
        'Kledo returned inconsistent invoice payment data',
      )
    }

    const directBankAccountId =
      payment.bank_account_id === null || payment.bank_account_id === undefined
        ? null
        : String(payment.bank_account_id)
    const nestedBankAccountId = payment.bank_account ? String(payment.bank_account.id) : null
    if (
      directBankAccountId !== null &&
      nestedBankAccountId !== null &&
      directBankAccountId !== nestedBankAccountId
    ) {
      throw new KledoError(
        'SCHEMA_MISMATCH',
        'Kledo returned inconsistent invoice payment data',
      )
    }
    const bankAccountId = directBankAccountId ?? nestedBankAccountId
    const id = String(payment.id)
    const normalized = invoicePaymentOutputSchema.parse({
      id,
      invoiceId,
      transactionDate: payment.trans_date,
      amount: normalizeMoney(payment.amount_after_tax, payment, payment.bank_account),
      statusId:
        payment.status_id === null || payment.status_id === undefined
          ? null
          : String(payment.status_id),
      bankAccount:
        bankAccountId === null
          ? null
          : {
              id: bankAccountId,
              name: payment.bank_account?.name?.trim() || null,
            },
      paymentTypeId:
        payment.payment_type_id === null || payment.payment_type_id === undefined
          ? null
          : String(payment.payment_type_id),
    })

    const existing = paymentsById.get(id)
    if (existing && JSON.stringify(existing) !== JSON.stringify(normalized)) {
      throw new KledoError(
        'SCHEMA_MISMATCH',
        'Kledo returned inconsistent invoice payment data',
      )
    }
    paymentsById.set(id, normalized)
  }

  return [...paymentsById.values()].sort((left, right) => {
    const byDate = left.transactionDate.localeCompare(right.transactionDate)
    if (byDate !== 0) return byDate
    const byIdLength = left.id.length - right.id.length
    return byIdLength !== 0 ? byIdLength : left.id.localeCompare(right.id)
  })
}

function normalizedInvoicePayments(
  invoiceId: string,
  rawTransactions: unknown[],
): KledoInvoicePayment[] {
  return normalizedPaymentTransactions(
    invoiceId,
    rawTransactions,
    transactionTypeIdByDocumentType.invoice_payment,
  )
}

type SalesInvoicePredecessorType = 'sales_quote' | 'sales_order' | 'sales_delivery'
type PurchaseInvoicePredecessorType =
  | 'purchase_quote'
  | 'purchase_order'
  | 'purchase_delivery'

const salesInvoicePredecessorTypes = new Set<SalesInvoicePredecessorType>([
  'sales_quote',
  'sales_order',
  'sales_delivery',
])

const purchaseInvoicePredecessorTypes = new Set<PurchaseInvoicePredecessorType>([
  'purchase_quote',
  'purchase_order',
  'purchase_delivery',
])

function isSalesInvoicePredecessorType(
  documentType: KledoDocumentType | undefined,
): documentType is SalesInvoicePredecessorType {
  return (
    documentType !== undefined &&
    salesInvoicePredecessorTypes.has(documentType as SalesInvoicePredecessorType)
  )
}

function isPurchaseInvoicePredecessorType(
  documentType: KledoDocumentType | undefined,
): documentType is PurchaseInvoicePredecessorType {
  return (
    documentType !== undefined &&
    purchaseInvoicePredecessorTypes.has(documentType as PurchaseInvoicePredecessorType)
  )
}

type SalesInvoiceDetail = z.infer<typeof rawSalesInvoiceDetailSchema>
type PurchaseInvoiceDetail = z.infer<typeof rawPurchaseInvoiceDetailSchema>
type RawDocumentRelation = z.infer<typeof rawDocumentRelationSchema>

function normalizedSalesInvoiceLineage(invoice: SalesInvoiceDetail, lineageLimit: number) {
  if (
    invoice.trans_type_id !== null &&
    invoice.trans_type_id !== undefined &&
    String(invoice.trans_type_id) !== transactionTypeIdByDocumentType.sales_invoice
  ) {
    throw new KledoError(
      'SCHEMA_MISMATCH',
      'Kledo returned a non-invoice document from the Sales Invoice endpoint',
    )
  }

  const predecessorsByKey = new Map<
    string,
    {
      documentType: KledoDocumentType
      transactionTypeId: string
      id: string
      number: string
    }
  >()
  for (const relation of invoice.relations) {
    const transactionTypeId = String(relation.trans_type_id)
    const documentType = documentTypeForTransactionTypeId(transactionTypeId)
    if (!documentType) {
      throw new KledoError(
        'SCHEMA_MISMATCH',
        'Kledo returned an unknown transaction type in Sales Invoice lineage',
      )
    }
    if (documentType === 'invoice_payment') continue
    if (!isSalesInvoicePredecessorType(documentType)) {
      throw new KledoError(
        'SCHEMA_MISMATCH',
        'Kledo returned an unsupported document type in Sales Invoice lineage',
      )
    }

    const normalized = {
      documentType,
      transactionTypeId,
      id: String(relation.id),
      number: relation.ref_number,
    }
    const key = `${transactionTypeId}:${normalized.id}`
    const existing = predecessorsByKey.get(key)
    if (existing && existing.number !== normalized.number) {
      throw new KledoError(
        'SCHEMA_MISMATCH',
        'Kledo returned conflicting duplicate documents in Sales Invoice lineage',
      )
    }
    predecessorsByKey.set(key, normalized)
  }

  const predecessors = [...predecessorsByKey.values()].sort((left, right) => {
    const byLifecycle =
      documentLifecycleRank(left.documentType) - documentLifecycleRank(right.documentType)
    if (byLifecycle !== 0) return byLifecycle
    const byIdLength = left.id.length - right.id.length
    return byIdLength !== 0 ? byIdLength : left.id.localeCompare(right.id)
  })

  let immediateParent: (typeof predecessors)[number] | null = null
  if (invoice.parent_tran) {
    if (
      invoice.parent_tran.trans_type_id === null ||
      invoice.parent_tran.trans_type_id === undefined
    ) {
      throw new KledoError(
        'SCHEMA_MISMATCH',
        'Kledo returned an untyped immediate parent for the Sales Invoice',
      )
    }
    const transactionTypeId = String(invoice.parent_tran.trans_type_id)
    const documentType = documentTypeForTransactionTypeId(transactionTypeId)
    const parentId = String(invoice.parent_tran.id)
    if (!isSalesInvoicePredecessorType(documentType)) {
      throw new KledoError(
        'SCHEMA_MISMATCH',
        'Kledo returned an invalid immediate parent for the Sales Invoice',
      )
    }
    immediateParent = predecessorsByKey.get(`${transactionTypeId}:${parentId}`) ?? null
    if (!immediateParent || immediateParent.number !== invoice.parent_tran.ref_number) {
      throw new KledoError(
        'SCHEMA_MISMATCH',
        'Kledo returned an immediate parent missing from Sales Invoice lineage',
      )
    }
  }

  const selectedPredecessors = predecessors.slice(0, lineageLimit)
  return {
    documentLineage: {
      anchor: {
        documentType: 'sales_invoice' as const,
        transactionTypeId: transactionTypeIdByDocumentType.sales_invoice,
        id: String(invoice.id),
        number: invoice.ref_number,
      },
      immediateParent,
      predecessors: selectedPredecessors,
      complete: selectedPredecessors.length === predecessors.length,
    },
    omittedLineageDocumentCount: predecessors.length - selectedPredecessors.length,
  }
}

function normalizedPurchaseInvoiceLineage(
  invoice: PurchaseInvoiceDetail,
  lineageLimit: number,
) {
  if (
    invoice.trans_type_id !== null &&
    invoice.trans_type_id !== undefined &&
    String(invoice.trans_type_id) !== transactionTypeIdByDocumentType.purchase_invoice
  ) {
    throw new KledoError(
      'SCHEMA_MISMATCH',
      'Kledo returned a non-invoice document from the Purchase Invoice endpoint',
    )
  }

  const predecessorsByKey = new Map<
    string,
    {
      documentType: PurchaseInvoicePredecessorType
      transactionTypeId: string
      id: string
      number: string
    }
  >()
  for (const relation of invoice.relations) {
    const transactionTypeId = String(relation.trans_type_id)
    const documentType = documentTypeForTransactionTypeId(transactionTypeId)
    if (!documentType) {
      throw new KledoError(
        'SCHEMA_MISMATCH',
        'Kledo returned an unknown transaction type in Purchase Invoice lineage',
      )
    }
    if (documentType === 'purchase_payment') continue
    if (!isPurchaseInvoicePredecessorType(documentType)) {
      throw new KledoError(
        'SCHEMA_MISMATCH',
        'Kledo returned an unsupported document type in Purchase Invoice lineage',
      )
    }

    const normalized = {
      documentType,
      transactionTypeId,
      id: String(relation.id),
      number: relation.ref_number,
    }
    const key = `${transactionTypeId}:${normalized.id}`
    const existing = predecessorsByKey.get(key)
    if (existing && existing.number !== normalized.number) {
      throw new KledoError(
        'SCHEMA_MISMATCH',
        'Kledo returned conflicting duplicate documents in Purchase Invoice lineage',
      )
    }
    predecessorsByKey.set(key, normalized)
  }

  const predecessors = [...predecessorsByKey.values()].sort((left, right) => {
    const byLifecycle =
      documentLifecycleRank(left.documentType) - documentLifecycleRank(right.documentType)
    if (byLifecycle !== 0) return byLifecycle
    const byIdLength = left.id.length - right.id.length
    return byIdLength !== 0 ? byIdLength : left.id.localeCompare(right.id)
  })

  let immediateParent: (typeof predecessors)[number] | null = null
  if (invoice.parent_tran) {
    if (
      invoice.parent_tran.trans_type_id === null ||
      invoice.parent_tran.trans_type_id === undefined
    ) {
      throw new KledoError(
        'SCHEMA_MISMATCH',
        'Kledo returned an untyped immediate parent for the Purchase Invoice',
      )
    }
    const transactionTypeId = String(invoice.parent_tran.trans_type_id)
    const documentType = documentTypeForTransactionTypeId(transactionTypeId)
    const parentId = String(invoice.parent_tran.id)
    if (!isPurchaseInvoicePredecessorType(documentType)) {
      throw new KledoError(
        'SCHEMA_MISMATCH',
        'Kledo returned an invalid immediate parent for the Purchase Invoice',
      )
    }
    immediateParent = predecessorsByKey.get(`${transactionTypeId}:${parentId}`) ?? null
    if (!immediateParent || immediateParent.number !== invoice.parent_tran.ref_number) {
      throw new KledoError(
        'SCHEMA_MISMATCH',
        'Kledo returned an immediate parent missing from Purchase Invoice lineage',
      )
    }
  }

  const selectedPredecessors = predecessors.slice(0, lineageLimit)
  return {
    documentLineage: {
      anchor: {
        documentType: 'purchase_invoice' as const,
        transactionTypeId: transactionTypeIdByDocumentType.purchase_invoice,
        id: String(invoice.id),
        number: invoice.ref_number,
      },
      immediateParent,
      predecessors: selectedPredecessors,
      complete: selectedPredecessors.length === predecessors.length,
    },
    omittedLineageDocumentCount: predecessors.length - selectedPredecessors.length,
  }
}

function normalizedPaymentEvents(
  invoiceId: string,
  rawTransactions: unknown[],
  relations: readonly RawDocumentRelation[],
  paymentDocumentType: 'invoice_payment' | 'purchase_payment' = 'invoice_payment',
): KledoPaymentEvent[] {
  const paymentTransactionTypeId = transactionTypeIdByDocumentType[paymentDocumentType]
  const paymentEventLabel =
    paymentDocumentType === 'invoice_payment' ? 'Invoice Payment' : 'Purchase Payment'
  const invoicePayments = normalizedPaymentTransactions(
    invoiceId,
    rawTransactions,
    paymentTransactionTypeId,
  )
  const paymentRelations = new Map<string, RawDocumentRelation>()
  for (const relation of relations) {
    if (String(relation.trans_type_id) !== paymentTransactionTypeId) {
      continue
    }
    const id = String(relation.id)
    const existing = paymentRelations.get(id)
    if (
      existing &&
      (existing.ref_number !== relation.ref_number ||
        existing.trans_date !== relation.trans_date ||
        (existing.amount_after_tax !== null &&
          existing.amount_after_tax !== undefined &&
          relation.amount_after_tax !== null &&
          relation.amount_after_tax !== undefined &&
          compareDecimals(
            decimalString(existing.amount_after_tax),
            decimalString(relation.amount_after_tax),
          ) !== 0))
    ) {
      throw new KledoError(
        'SCHEMA_MISMATCH',
        `Kledo returned conflicting duplicate ${paymentEventLabel} relations`,
      )
    }
    paymentRelations.set(id, relation)
  }

  const events = invoicePayments.map((payment) => {
    const relation = paymentRelations.get(payment.id)
    if (!relation) {
      throw new KledoError(
        'SCHEMA_MISMATCH',
        `Kledo returned a ${paymentEventLabel} transaction without a typed relation`,
      )
    }
    if (
      (relation.trans_date !== null &&
        relation.trans_date !== undefined &&
        relation.trans_date !== payment.transactionDate) ||
      (relation.amount_after_tax !== null &&
        relation.amount_after_tax !== undefined &&
        compareDecimals(decimalString(relation.amount_after_tax), payment.amount.amount) !== 0)
    ) {
      throw new KledoError(
        'SCHEMA_MISMATCH',
        `Kledo returned inconsistent ${paymentEventLabel} relation data`,
      )
    }

    return paymentEventOutputSchema.parse({
      ...payment,
      relation: 'payment_for',
      documentType: paymentDocumentType,
      transactionTypeId: paymentTransactionTypeId,
      number: relation.ref_number,
    })
  })

  if (events.length !== paymentRelations.size) {
    throw new KledoError(
      'SCHEMA_MISMATCH',
      `Kledo returned a ${paymentEventLabel} relation without a matching transaction`,
    )
  }
  return events
}

function queryCursorRequest(input: KledoQueryInput): object {
  return {
    entity: input.entity,
    search: input.search,
    filters: input.filters,
    sort: input.sort,
    fields: input.fields,
    pageSize: input.pageSize,
  }
}

function reportCursorRequest(input: KledoReportInput): object {
  const request: Record<string, unknown> = { ...input }
  delete request.cursor
  return request
}

function canonicalizeRequest(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeRequest)
  if (typeof value !== 'object' || value === null) return value

  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .flatMap((key) =>
        record[key] === undefined ? [] : [[key, canonicalizeRequest(record[key])]],
      ),
  )
}

function requestFingerprint(
  kind: 'query' | 'report',
  request: object,
  cursorKey: Buffer,
): string {
  return createHmac('sha256', cursorKey)
    .update(`kledo-mcp cursor request ${kind} v1\0`)
    .update(JSON.stringify(canonicalizeRequest(request)))
    .digest('base64url')
}

function cursorForRequest(
  kind: 'query' | 'report',
  request: object,
  nextPage: number,
  cursorKey: Buffer,
): string {
  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      kind,
      requestHash: requestFingerprint(kind, request, cursorKey),
      page: nextPage,
    }),
  ).toString('base64url')
  const signature = createHmac('sha256', cursorKey).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

const cursorPayloadSchema = z.object({
  version: z.literal(1),
  kind: z.enum(['query', 'report']),
  requestHash: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  page: z.number().int().positive(),
})

function pageFromCursor(
  cursor: string | undefined,
  kind: 'query' | 'report',
  request: object,
  cursorKey: Buffer,
): number {
  if (!cursor) return 1

  const invalidCursor = (): never => {
    throw new KledoError('INVALID_CURSOR', 'The continuation cursor is invalid or does not match')
  }
  const [payload, receivedSignature, extra] = cursor.split('.')
  if (!payload || !receivedSignature || extra !== undefined) return invalidCursor()

  const expectedSignature = createHmac('sha256', cursorKey).update(payload).digest()
  let received: Buffer
  try {
    received = Buffer.from(receivedSignature, 'base64url')
  } catch {
    return invalidCursor()
  }
  if (received.length !== expectedSignature.length || !timingSafeEqual(received, expectedSignature)) {
    return invalidCursor()
  }

  let decoded: z.infer<typeof cursorPayloadSchema>
  try {
    decoded = cursorPayloadSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')))
  } catch {
    return invalidCursor()
  }

  if (
    decoded.kind !== kind ||
    decoded.requestHash !== requestFingerprint(kind, request, cursorKey)
  ) {
    return invalidCursor()
  }

  return decoded.page
}

function invalid(message: string): never {
  throw new KledoError('INVALID_ARGUMENT', message)
}

interface PaginatedEnvelopeData {
  current_page: number
  last_page: number
  per_page: number
  total: number
  data: readonly unknown[]
}

function assertConsistentPagination(page: PaginatedEnvelopeData): void {
  const expectedLastPage = Math.max(1, Math.ceil(page.total / page.per_page))
  const pageOffset = (page.current_page - 1) * page.per_page
  const coveredRecords = pageOffset + page.data.length
  const inconsistent =
    page.last_page !== expectedLastPage ||
    page.current_page > page.last_page ||
    page.data.length > page.per_page ||
    coveredRecords > page.total ||
    (page.current_page < page.last_page && page.data.length !== page.per_page) ||
    (page.current_page === page.last_page && coveredRecords !== page.total)

  if (inconsistent) {
    throw new KledoError('SCHEMA_MISMATCH', 'Kledo returned inconsistent pagination data')
  }
}

function oneId(values: string[] | undefined, field: string): string | undefined {
  if (!values?.length) return undefined
  if (values.length > 1) invalid(`${field} accepts at most one ID for this report`)
  return values[0]
}

export function createKledoHttpGateway(options: CreateKledoHttpGatewayOptions): KledoHttpGateway {
  const baseUrl = normalizedBaseUrl(options.baseUrl)
  const token = options.token.replace(/^Bearer\s+/i, '').trim()
  assertBaseUrl(baseUrl, options.allowInsecureLoopback === true)
  if (!token) throw new Error('KLEDO_API_TOKEN is required')

  const now = options.now ?? (() => new Date())
  const timeoutMs = options.timeoutMs ?? 10_000
  const maxAttempts = options.maxAttempts ?? 3
  const maxResponseBytes = options.maxResponseBytes ?? 8 * 1024 * 1024
  const maxPrintDocumentBytes = options.maxPrintDocumentBytes ?? 4 * 1024 * 1024
  const printDocumentTimeoutMs = options.printDocumentTimeoutMs ?? 30_000
  const maxConcurrency = options.maxConcurrency ?? 4
  const salespersonCacheTtlMs = options.salespersonCacheTtlMs ?? 5 * 60 * 1_000
  const salespersonCacheMaxUsers = options.salespersonCacheMaxUsers ?? 1_000
  const sleep =
    options.sleep ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const cursorKey = createHmac('sha256', token).update('kledo-mcp cursor signing key v1').digest()
  const identityCatalog = options.identityCatalogPath
    ? createSqliteTenantIdentityCatalog({
        path: options.identityCatalogPath,
        tenantKey: createHmac('sha256', token)
          .update(`kledo-mcp identity tenant scope v1\0${baseUrl.origin}`)
          .digest('hex'),
      })
    : undefined
  const emitDiagnostic = (event: KledoGatewayDiagnosticEvent['event']): void => {
    try {
      options.diagnostic?.({ event })
    } catch {
      // Diagnostics must never affect a read-only tool result.
    }
  }

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new Error('maxAttempts must be an integer between 1 and 5')
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new Error('maxResponseBytes must be a positive safe integer')
  }
  if (
    !Number.isSafeInteger(maxPrintDocumentBytes) ||
    maxPrintDocumentBytes < 1 ||
    maxPrintDocumentBytes > 6 * 1024 * 1024
  ) {
    throw new Error('maxPrintDocumentBytes must be a positive safe integer up to 6291456')
  }
  if (
    !Number.isInteger(printDocumentTimeoutMs) ||
    printDocumentTimeoutMs < 1 ||
    printDocumentTimeoutMs > 60_000
  ) {
    throw new Error('printDocumentTimeoutMs must be an integer between 1 and 60000')
  }
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 64) {
    throw new Error('maxConcurrency must be an integer between 1 and 64')
  }
  if (
    !Number.isInteger(salespersonCacheTtlMs) ||
    salespersonCacheTtlMs < 1 ||
    salespersonCacheTtlMs > 60 * 60 * 1_000
  ) {
    throw new Error('salespersonCacheTtlMs must be an integer between 1 and 3600000')
  }
  if (
    !Number.isInteger(salespersonCacheMaxUsers) ||
    salespersonCacheMaxUsers < 1 ||
    salespersonCacheMaxUsers > 10_000
  ) {
    throw new Error('salespersonCacheMaxUsers must be an integer between 1 and 10000')
  }

  type CachedIdentity = { id: string; name: string; active: boolean }
  type CachedContact = CachedIdentity & { typeIds: readonly string[] }
  type SalespersonResolution = {
    salesperson: CachedIdentity
    warnings: readonly string[]
  }
  type ProductIdentity = {
    id: string
    code: string | null
    name: string
  }
  let salespersonCache:
    | { expiresAt: number; users: readonly CachedIdentity[] }
    | undefined

  const maxRetryWaitMs = 5_000
  const retryDelay = (response: Response, attempt: number): number | null => {
    const retryAfter = response.headers.get('retry-after')
    if (retryAfter !== null) {
      const seconds = Number(retryAfter)
      if (Number.isFinite(seconds) && seconds >= 0) {
        const milliseconds = seconds * 1_000
        return milliseconds <= maxRetryWaitMs ? milliseconds : null
      }
      const date = Date.parse(retryAfter)
      if (Number.isFinite(date)) {
        const milliseconds = Math.max(0, date - Date.now())
        return milliseconds <= maxRetryWaitMs ? milliseconds : null
      }
    }
    return Math.min(100 * 2 ** (attempt - 1), 1_000)
  }

  const cancelled = (): never => {
    throw new KledoError('REQUEST_CANCELLED', 'Kledo request was cancelled')
  }

  type PermitWaiter = {
    resolve: (release: () => void) => void
    reject: (error: KledoError) => void
    signal?: AbortSignal
    onAbort?: () => void
  }
  let activeRequests = 0
  const permitWaiters: PermitWaiter[] = []

  const createPermitRelease = (): (() => void) => {
    let released = false
    return () => {
      if (released) return
      released = true
      activeRequests -= 1

      while (permitWaiters.length > 0) {
        const waiter = permitWaiters.shift()
        if (!waiter) return
        if (waiter.onAbort) waiter.signal?.removeEventListener('abort', waiter.onAbort)
        if (waiter.signal?.aborted) {
          waiter.reject(new KledoError('REQUEST_CANCELLED', 'Kledo request was cancelled'))
          continue
        }
        activeRequests += 1
        waiter.resolve(createPermitRelease())
        return
      }
    }
  }

  const acquirePermit = async (signal?: AbortSignal): Promise<() => void> => {
    if (signal?.aborted) cancelled()
    if (activeRequests < maxConcurrency) {
      activeRequests += 1
      return createPermitRelease()
    }

    return new Promise<() => void>((resolve, reject) => {
      const waiter: PermitWaiter = { resolve, reject, signal }
      if (signal) {
        waiter.onAbort = () => {
          const index = permitWaiters.indexOf(waiter)
          if (index >= 0) permitWaiters.splice(index, 1)
          reject(new KledoError('REQUEST_CANCELLED', 'Kledo request was cancelled'))
        }
        signal.addEventListener('abort', waiter.onAbort, { once: true })
      }
      permitWaiters.push(waiter)
      if (signal?.aborted) waiter.onAbort?.()
    })
  }

  const waitBeforeRetry = async (milliseconds: number, signal?: AbortSignal): Promise<void> => {
    if (!signal) {
      await sleep(milliseconds)
      return
    }
    if (signal.aborted) cancelled()

    let abort: (() => void) | undefined
    const aborted = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new KledoError('REQUEST_CANCELLED', 'Kledo request was cancelled'))
      signal.addEventListener('abort', abort, { once: true })
    })
    try {
      await Promise.race([sleep(milliseconds), aborted])
    } finally {
      if (abort) signal.removeEventListener('abort', abort)
    }
  }

  const cancelResponseBody = async (response: Response): Promise<void> => {
    try {
      await response.body?.cancel()
    } catch {
      // Preserve the stable mapped HTTP error when body cancellation itself fails.
    }
  }

  const request = async (
    url: URL,
    signal?: AbortSignal,
    accept = 'application/json',
    requestTimeoutMs = timeoutMs,
  ): Promise<Response> => {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (signal?.aborted) cancelled()
      let response: Response
      const timeoutSignal = AbortSignal.timeout(requestTimeoutMs)
      try {
        response = await fetch(url, {
          headers: {
            accept,
            authorization: `Bearer ${token}`,
            'user-agent': 'kledo-mcp/0.1.0',
          },
          redirect: 'error',
          signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
        })
      } catch (error) {
        if (signal?.aborted) cancelled()
        const name = error instanceof Error ? error.name : ''
        if (timeoutSignal.aborted || name === 'TimeoutError' || name === 'AbortError') {
          throw new KledoError('UPSTREAM_TIMEOUT', 'Kledo request timed out', true)
        }
        if (attempt < maxAttempts) {
          await waitBeforeRetry(Math.min(100 * 2 ** (attempt - 1), 1_000), signal)
          continue
        }
        throw new KledoError('UPSTREAM_REQUEST_FAILED', 'Could not reach Kledo', true)
      }

      if (response.ok) return response
      const mappedError = errorForHttpStatus(response.status)
      if (mappedError.retryable && attempt < maxAttempts) {
        const delay = retryDelay(response, attempt)
        await cancelResponseBody(response)
        if (delay === null) throw mappedError
        await waitBeforeRetry(delay, signal)
        continue
      }
      await cancelResponseBody(response)
      throw mappedError
    }
    throw new KledoError('UPSTREAM_REQUEST_FAILED', 'Could not reach Kledo', true)
  }

  const responseTooLarge = (): never => {
    throw new KledoError(
      'UPSTREAM_RESPONSE_TOO_LARGE',
      'Kledo response exceeded the configured size limit',
    )
  }

  const readJson = async (response: Response, signal?: AbortSignal): Promise<unknown> => {
    const contentLength = response.headers.get('content-length')
    if (contentLength !== null && /^\d+$/.test(contentLength)) {
      const declaredBytes = Number(contentLength)
      if (Number.isSafeInteger(declaredBytes) && declaredBytes > maxResponseBytes) {
        try {
          await response.body?.cancel()
        } catch {
          // Preserve the stable public size-limit error when cancellation itself fails.
        }
        responseTooLarge()
      }
    }

    if (!response.body) {
      throw new KledoError('SCHEMA_MISMATCH', 'Kledo returned data in an unexpected format')
    }

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let receivedBytes = 0
    const cancelReader = async (): Promise<void> => {
      try {
        await reader.cancel()
      } catch {
        // Preserve the original safe error when cancellation itself fails.
      }
    }

    while (true) {
      if (signal?.aborted) {
        await cancelReader()
        cancelled()
      }

      let result: ReadableStreamReadResult<Uint8Array>
      try {
        result = await reader.read()
      } catch (error) {
        await cancelReader()
        if (signal?.aborted) cancelled()
        const name = error instanceof Error ? error.name : ''
        if (name === 'TimeoutError' || name === 'AbortError') {
          throw new KledoError('UPSTREAM_TIMEOUT', 'Kledo request timed out', true)
        }
        throw new KledoError('UPSTREAM_REQUEST_FAILED', 'Could not read Kledo response', true)
      }

      if (result.done) break
      receivedBytes += result.value.byteLength
      if (receivedBytes > maxResponseBytes) {
        await cancelReader()
        responseTooLarge()
      }
      chunks.push(result.value)
    }

    try {
      return parseJsonWithExactNumbers(Buffer.concat(chunks, receivedBytes).toString('utf8'))
    } catch {
      throw new KledoError('SCHEMA_MISMATCH', 'Kledo returned data in an unexpected format')
    }
  }

  const requestJson = async (url: URL, signal?: AbortSignal): Promise<unknown> => {
    const release = await acquirePermit(signal)
    try {
      const response = await request(url, signal)
      return await readJson(response, signal)
    } finally {
      release()
    }
  }

  const readPrintDocument = async (
    response: Response,
    signal?: AbortSignal,
  ): Promise<Buffer> => {
    const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    if (mediaType !== 'application/pdf') {
      await cancelResponseBody(response)
      throw new KledoError('SCHEMA_MISMATCH', 'Kledo returned an invalid print document')
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength !== null && /^\d+$/.test(contentLength)) {
      const declaredBytes = Number(contentLength)
      if (Number.isSafeInteger(declaredBytes) && declaredBytes > maxPrintDocumentBytes) {
        await cancelResponseBody(response)
        responseTooLarge()
      }
    }
    if (!response.body) {
      throw new KledoError('SCHEMA_MISMATCH', 'Kledo returned an invalid print document')
    }

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let receivedBytes = 0
    const cancelReader = async (): Promise<void> => {
      try {
        await reader.cancel()
      } catch {
        // Preserve the original safe error when cancellation itself fails.
      }
    }

    while (true) {
      if (signal?.aborted) {
        await cancelReader()
        cancelled()
      }
      let result: ReadableStreamReadResult<Uint8Array>
      try {
        result = await reader.read()
      } catch (error) {
        await cancelReader()
        if (signal?.aborted) cancelled()
        const name = error instanceof Error ? error.name : ''
        if (name === 'TimeoutError' || name === 'AbortError') {
          throw new KledoError('UPSTREAM_TIMEOUT', 'Kledo request timed out', true)
        }
        throw new KledoError('UPSTREAM_REQUEST_FAILED', 'Could not read Kledo response', true)
      }
      if (result.done) break
      receivedBytes += result.value.byteLength
      if (receivedBytes > maxPrintDocumentBytes) {
        await cancelReader()
        responseTooLarge()
      }
      chunks.push(result.value)
    }

    const document = Buffer.concat(chunks, receivedBytes)
    if (document.byteLength < 5 || document.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new KledoError('SCHEMA_MISMATCH', 'Kledo returned an invalid print document')
    }
    return document
  }

  const requestPrintDocument = async (url: URL, signal?: AbortSignal): Promise<Buffer> => {
    const release = await acquirePermit(signal)
    try {
      const response = await request(url, signal, 'application/pdf', printDocumentTimeoutMs)
      return await readPrintDocument(response, signal)
    } finally {
      release()
    }
  }

  const fetchSalespersons = async (signal?: AbortSignal): Promise<readonly CachedIdentity[]> => {
    emitDiagnostic('identity.upstream.refresh')
    const body = await requestJson(new URL('users', baseUrl), signal)
    const envelope = rawUsersEnvelopeSchema.parse(body)
    const rows = Array.isArray(envelope.data) ? envelope.data : envelope.data.data
    if (rows.length > salespersonCacheMaxUsers) {
      throw new KledoError('SCHEMA_MISMATCH', 'Kledo returned too many users to resolve safely')
    }
    return rows.map((user) => ({
      id: String(user.id),
      name: user.name,
      active: user.is_active,
    }))
  }

  const fetchPaginatedIdentityRows = async (
    path: string,
    signal?: AbortSignal,
  ): Promise<readonly unknown[]> => {
    const rows: unknown[] = []
    const pageSize = 100
    const maxRecords = 10_000
    let requestedPage = 1

    while (true) {
      const url = new URL(path, baseUrl)
      url.searchParams.set('per_page', String(pageSize))
      url.searchParams.set('page', String(requestedPage))
      emitDiagnostic('identity.upstream.refresh')
      const body = await requestJson(url, signal)
      const envelope = rawEntityPageEnvelopeSchema.parse(body)
      const page = envelope.data
      assertConsistentPagination(page)
      if (page.current_page !== requestedPage || page.total > maxRecords) {
        throw new KledoError('SCHEMA_MISMATCH', 'Kledo returned an invalid identity catalog')
      }
      rows.push(...page.data)
      if (rows.length > maxRecords) {
        throw new KledoError('SCHEMA_MISMATCH', 'Kledo returned too many identities to store safely')
      }
      if (page.current_page >= page.last_page) break
      requestedPage += 1
    }

    return rows
  }

  const fetchIdentityArrayRows = async (
    path: string,
    signal?: AbortSignal,
  ): Promise<readonly unknown[]> => {
    emitDiagnostic('identity.upstream.refresh')
    const body = await requestJson(new URL(path, baseUrl), signal)
    const envelope = rawIdentityArrayEnvelopeSchema.parse(body)
    const rows = Array.isArray(envelope.data) ? envelope.data : envelope.data.data
    if (rows.length > 10_000) {
      throw new KledoError('SCHEMA_MISMATCH', 'Kledo returned too many identities to store safely')
    }
    return rows
  }

  const activeFromArchive = (value: boolean | 0 | 1 | null | undefined): boolean =>
    value === undefined || value === null || value === false || value === 0

  const fetchContacts = async (signal?: AbortSignal): Promise<readonly CachedContact[]> => {
    const rows = await fetchPaginatedIdentityRows('finance/contacts', signal)
    const allowedTypeIds = new Set(['1', '2', '3', '4', '5'])
    return rows.map((value) => {
      const contact = rawIdentityContactSchema.parse(value)
      const contactName = contact.company?.trim() || contact.name?.trim()
      const typeIds = contact.type_ids.map(String)
      if (!contactName) {
        throw new KledoError('SCHEMA_MISMATCH', 'Kledo returned an unnamed contact')
      }
      if (typeIds.length === 0 || typeIds.some((typeId) => !allowedTypeIds.has(typeId))) {
        throw new KledoError('SCHEMA_MISMATCH', 'Kledo returned an invalid contact type')
      }
      return {
        id: String(contact.id),
        name: contactName,
        active: activeFromArchive(contact.is_archive),
        typeIds,
      }
    })
  }

  const namedIdentities = (
    rows: readonly unknown[],
    activeFrom: 'archive' | 'deleted' | 'always',
  ): readonly CachedIdentity[] =>
    rows.map((value) => {
      const record = rawIdentityNamedRecordSchema.parse(value)
      return {
        id: String(record.id),
        name: record.name,
        active:
          activeFrom === 'archive'
            ? activeFromArchive(record.is_archive)
            : activeFrom === 'deleted'
              ? record.deleted_at === undefined || record.deleted_at === null
              : true,
      }
    })

  const fetchNamedPaginatedCatalog = async (
    path: string,
    activeFrom: 'archive' | 'deleted',
    signal?: AbortSignal,
  ): Promise<readonly CachedIdentity[]> =>
    namedIdentities(await fetchPaginatedIdentityRows(path, signal), activeFrom)

  const fetchNamedArrayCatalog = async (
    path: string,
    activeFrom: 'archive' | 'always',
    signal?: AbortSignal,
  ): Promise<readonly CachedIdentity[]> =>
    namedIdentities(await fetchIdentityArrayRows(path, signal), activeFrom)

  const fetchProductCategories = async (
    signal?: AbortSignal,
  ): Promise<readonly CachedIdentity[]> => {
    const roots = z
      .array(rawProductCategorySchema)
      .parse(await fetchIdentityArrayRows('finance/productCategories', signal))
    const identities: CachedIdentity[] = []
    const visit = (category: RawProductCategory): void => {
      identities.push({ id: String(category.id), name: category.name, active: true })
      for (const child of category.children) visit(child)
    }
    for (const root of roots) visit(root)
    if (identities.length > 10_000) {
      throw new KledoError('SCHEMA_MISMATCH', 'Kledo returned too many identities to store safely')
    }
    return identities
  }

  const replaceIdentitySnapshots = async (
    snapshots: readonly {
      entityType: IdentityEntityType
      identities: readonly CachedIdentity[]
    }[],
    fetchedAt: Date,
  ): Promise<boolean> => {
    if (!identityCatalog) return false
    await identityCatalog.replaceSnapshots(
      snapshots.map((snapshot) => ({
        entityType: snapshot.entityType,
        identities: snapshot.identities.map((identity) => ({
          externalId: identity.id,
          displayName: identity.name,
          normalizedName: identity.name.trim().toLocaleLowerCase('en-US'),
          active: identity.active,
        })),
      })),
      fetchedAt,
    )
    emitDiagnostic('identity.sqlite.write')
    return true
  }

  const resolveSalespersonName = async (
    suppliedName: string,
    signal?: AbortSignal,
  ): Promise<SalespersonResolution> => {
    const cacheNow = now().getTime()
    const normalizedName = suppliedName.trim().toLocaleLowerCase('en-US')
    const warnings: string[] = []
    const catalogUnavailableWarning =
      'Local identity catalog unavailable; salesperson was resolved from Kledo'
    const exactMatch = (candidates: readonly CachedIdentity[]): CachedIdentity => {
      const matches = candidates.filter(
        (user) =>
          user.active && user.name.trim().toLocaleLowerCase('en-US') === normalizedName,
      )
      if (matches.length === 0) {
        throw new KledoError('NOT_FOUND', 'No Kledo user exactly matched the salesperson name')
      }
      if (matches.length > 1) {
        throw new KledoError(
          'INVALID_ARGUMENT',
          'Multiple Kledo users exactly matched the salesperson name',
        )
      }
      return matches[0]!
    }

    let users =
      salespersonCache && salespersonCache.expiresAt > cacheNow
        ? salespersonCache.users
        : undefined
    if (users) emitDiagnostic('identity.memory.hit')
    if (!users) {
      let catalogMatches: readonly CachedIdentity[] | null | undefined
      try {
        const identities = await identityCatalog?.findFreshExact(
          'salesperson',
          normalizedName,
          cacheNow - salespersonCacheTtlMs,
        )
        catalogMatches = identities?.map((identity) => ({
          id: identity.externalId,
          name: identity.displayName,
          active: identity.active,
        }))
        if (identities === null) emitDiagnostic('identity.sqlite.snapshot_miss')
        else if (identities?.length === 0) emitDiagnostic('identity.sqlite.name_miss')
        else if (identities) emitDiagnostic('identity.sqlite.hit')
      } catch {
        emitDiagnostic('identity.sqlite.unavailable')
        warnings.push(catalogUnavailableWarning)
      }
      if (catalogMatches && catalogMatches.length > 0) {
        return { salesperson: exactMatch(catalogMatches), warnings }
      }

      users = await fetchSalespersons(signal)
      try {
        await replaceIdentitySnapshots(
          [{ entityType: 'salesperson', identities: users }],
          new Date(cacheNow),
        )
      } catch {
        emitDiagnostic('identity.sqlite.write_failed')
        if (!warnings.includes(catalogUnavailableWarning)) {
          warnings.push(catalogUnavailableWarning)
        }
      }
      salespersonCache = {
        expiresAt: cacheNow + salespersonCacheTtlMs,
        users,
      }
    }

    return { salesperson: exactMatch(users), warnings }
  }

  const resolveProductSelection = async (
    selection: { productCode?: string; productName?: string },
    signal?: AbortSignal,
  ): Promise<ProductIdentity> => {
    const supplied = selection.productCode ?? selection.productName
    if (!supplied) {
      throw new KledoError(
        'INVALID_ARGUMENT',
        'Exactly one of productCode or productName is required',
      )
    }

    const rows: ProductIdentity[] = []
    const seenIds = new Set<string>()
    const pageSize = 100
    const maxRecords = 10_000
    let requestedPage = 1
    while (true) {
      const url = new URL('finance/products', baseUrl)
      url.searchParams.set('search', supplied)
      url.searchParams.set('include_archive', '0')
      url.searchParams.set('per_page', String(pageSize))
      url.searchParams.set('page', String(requestedPage))
      emitDiagnostic('report.item_price_analysis.product_search.request')
      const body = await requestJson(url, signal)
      const envelope = rawEntityPageEnvelopeSchema.parse(body)
      const page = envelope.data
      if (page.current_page !== requestedPage || page.per_page !== pageSize) {
        throw new KledoError(
          'SCHEMA_MISMATCH',
          'Kledo returned inconsistent product-search pagination data',
        )
      }
      assertConsistentPagination(page)
      if (page.total > maxRecords) {
        throw new KledoError('SCHEMA_MISMATCH', 'Kledo returned too many products to resolve safely')
      }
      for (const value of page.data) {
        const product = rawProductIdentitySchema.parse(value)
        const id = String(product.id)
        if (seenIds.has(id)) {
          throw new KledoError(
            'SCHEMA_MISMATCH',
            'Kledo returned duplicate product identities',
          )
        }
        seenIds.add(id)
        rows.push({ id, code: product.code ?? null, name: product.name })
      }
      if (rows.length > maxRecords) {
        throw new KledoError('SCHEMA_MISMATCH', 'Kledo returned too many products to resolve safely')
      }
      if (page.current_page >= page.last_page) break
      requestedPage += 1
    }

    const ambiguous = (): never => {
      throw new KledoError(
        'AMBIGUOUS',
        'Multiple Kledo products matched; provide the exact productCode (SKU)',
      )
    }
    const normalized = supplied.trim().toLocaleLowerCase('en-US')
    if (selection.productCode) {
      const exactCodeMatches = rows.filter(
        (product) => product.code?.trim().toLocaleLowerCase('en-US') === normalized,
      )
      if (exactCodeMatches.length === 0) {
        throw new KledoError('NOT_FOUND', 'No Kledo product exactly matched the productCode')
      }
      if (exactCodeMatches.length > 1) ambiguous()
      return exactCodeMatches[0]!
    }

    const exactNameMatches = rows.filter(
      (product) => product.name.trim().toLocaleLowerCase('en-US') === normalized,
    )
    if (exactNameMatches.length === 1) return exactNameMatches[0]!
    if (exactNameMatches.length > 1 || rows.length > 1) ambiguous()
    if (rows.length === 0) {
      throw new KledoError('NOT_FOUND', 'No Kledo product matched the productName')
    }
    return rows[0]!
  }

  return {
    async warmIdentityCatalog(signal?: AbortSignal): Promise<KledoIdentityWarmupResult> {
      if (!identityCatalog) {
        throw new KledoError('INTERNAL_ERROR', 'Local identity catalog is not configured')
      }
      const fetchedAt = now()
      const users = await fetchSalespersons(signal)
      const contacts = await fetchContacts(signal)
      const contactGroups = await fetchNamedArrayCatalog(
        'finance/contactGroups',
        'always',
        signal,
      )
      const products = await fetchNamedPaginatedCatalog('finance/products', 'archive', signal)
      const productCategories = await fetchProductCategories(signal)
      const warehouses = await fetchNamedArrayCatalog('finance/warehouses', 'archive', signal)
      const units = await fetchNamedPaginatedCatalog('finance/units', 'deleted', signal)
      const accounts = await fetchNamedPaginatedCatalog('finance/accounts', 'archive', signal)
      const contactTypes: readonly CachedIdentity[] = [
        { id: '1', name: 'Vendor', active: true },
        { id: '2', name: 'Employee', active: true },
        { id: '3', name: 'Customer', active: true },
        { id: '4', name: 'Other', active: true },
        { id: '5', name: 'Investor', active: true },
      ]
      const snapshots: readonly {
        entityType: IdentityEntityType
        identities: readonly CachedIdentity[]
      }[] = [
        { entityType: 'salesperson', identities: users },
        { entityType: 'contact', identities: contacts },
        {
          entityType: 'customer',
          identities: contacts.filter((item) => item.typeIds.includes('3')),
        },
        { entityType: 'vendor', identities: contacts.filter((item) => item.typeIds.includes('1')) },
        {
          entityType: 'employee',
          identities: contacts.filter((item) => item.typeIds.includes('2')),
        },
        {
          entityType: 'investor',
          identities: contacts.filter((item) => item.typeIds.includes('5')),
        },
        {
          entityType: 'other_contact',
          identities: contacts.filter((item) => item.typeIds.includes('4')),
        },
        { entityType: 'contact_type', identities: contactTypes },
        { entityType: 'contact_group', identities: contactGroups },
        { entityType: 'product', identities: products },
        { entityType: 'product_category', identities: productCategories },
        { entityType: 'warehouse', identities: warehouses },
        { entityType: 'unit', identities: units },
        { entityType: 'account', identities: accounts },
      ]
      try {
        await replaceIdentitySnapshots(snapshots, fetchedAt)
      } catch {
        emitDiagnostic('identity.sqlite.write_failed')
        throw new KledoError('INTERNAL_ERROR', 'Could not update local identity catalog')
      }
      salespersonCache = {
        expiresAt: fetchedAt.getTime() + salespersonCacheTtlMs,
        users,
      }
      const snapshotByType = new Map(snapshots.map((snapshot) => [snapshot.entityType, snapshot]))
      const counts = Object.fromEntries(
        identityEntityTypes.map((entityType) => [
          entityType,
          snapshotByType.get(entityType)?.identities.length ?? 0,
        ]),
      ) as Record<IdentityEntityType, number>
      return {
        counts,
        fetchedAt: fetchedAt.toISOString(),
      }
    },

    async query(input: KledoQueryInput, signal?: AbortSignal): Promise<KledoQueryOutput> {
      const definition = entityDefinitions[input.entity]
      if (input.search && !definition.supportsSearch) {
        invalid(`${input.entity} does not support search`)
      }
      const url = new URL(definition.path, baseUrl)
      if (input.search) url.searchParams.set('search', input.search)
      applyQueryOptions(input, url)

      const requestedPage =
        definition.pagination === 'page'
          ? pageFromCursor(input.cursor, 'query', queryCursorRequest(input), cursorKey)
          : 1
      if (definition.pagination !== 'page' && input.cursor) {
        invalid(`${input.entity} does not support cursor continuation`)
      }
      if (definition.pagination !== 'none') {
        url.searchParams.set('per_page', String(input.pageSize))
      }
      if (definition.pagination === 'page') url.searchParams.set('page', String(requestedPage))

      const body = await requestJson(url, signal)
      let rawItems: unknown[]
      let currentPage = 1
      let hasMore = false
      let total: number
      if (definition.pagination === 'none') {
        const envelope = rawEntityArrayEnvelopeSchema.parse(body)
        rawItems = Array.isArray(envelope.data) ? envelope.data : envelope.data.data
        total = rawItems.length
        hasMore = rawItems.length > input.pageSize
        rawItems = rawItems.slice(0, input.pageSize)
      } else {
        const envelope = rawEntityPageEnvelopeSchema.parse(body)
        const page = envelope.data
        if (page.current_page !== requestedPage || page.per_page !== input.pageSize) {
          throw new KledoError('SCHEMA_MISMATCH', 'Kledo returned inconsistent pagination data')
        }
        assertConsistentPagination(page)
        rawItems = page.data
        currentPage = page.current_page
        hasMore = page.current_page < page.last_page
        total = page.total
        if (definition.pagination === 'page' && rawItems.length > input.pageSize) {
          throw new KledoError('SCHEMA_MISMATCH', 'Kledo returned more records than requested')
        }
        if (definition.pagination === 'single_page' && rawItems.length > input.pageSize) {
          hasMore = true
          rawItems = rawItems.slice(0, input.pageSize)
        }
      }
      const items: Array<Record<string, JsonValue>> = rawItems.map((item) =>
        projectQueryItem(input, normalizeEntityItem(input.entity, item)),
      )
      const canContinue = hasMore && definition.pagination === 'page'

      return {
        entity: input.entity,
        items,
        pageInfo: {
          ...(canContinue
            ? {
                nextCursor: cursorForRequest(
                  'query',
                  queryCursorRequest(input),
                  currentPage + 1,
                  cursorKey,
                ),
              }
            : {}),
          hasMore,
          total,
        },
        meta: {
          fetchedAt: now().toISOString(),
          ...(options.tenant ? { tenant: options.tenant } : {}),
          complete: !hasMore,
          warnings:
            hasMore && definition.pagination !== 'page'
              ? ['Kledo does not document cursor continuation for this entity']
              : [],
        },
      }
    },

    async get(input: KledoGetInput, signal?: AbortSignal): Promise<KledoGetResult> {
      validateFields(input.entity, input.fields)
      const includes = new Set(input.include ?? [])

      if (includes.has('print_document') && input.entity !== 'sales_invoice') {
        invalid(`${input.entity} does not support print_document`)
      }

      if (input.entity === 'purchase_invoice') {
        if (includes.has('invoice_payments')) {
          invalid('purchase_invoice does not support invoice_payments')
        }

        const url = new URL(`finance/purchaseInvoices/${input.id}`, baseUrl)
        emitDiagnostic('get.purchase_invoice.detail.request')
        const body = await requestJson(url, signal)
        const envelope = rawPurchaseInvoiceDetailEnvelopeSchema.parse(body)
        const invoice = envelope.data
        const extras = normalizeTransactionExtras(input.entity, invoice)
        const selectedItems = extras.lineItems.slice(0, input.lineItemLimit)
        const omittedCount = extras.lineItems.length - selectedItems.length

        let parentEntity: PurchaseInvoicePredecessorType = 'purchase_order'
        if (
          invoice.parent_tran?.trans_type_id !== null &&
          invoice.parent_tran?.trans_type_id !== undefined
        ) {
          const typedParentEntity = documentTypeForTransactionTypeId(
            String(invoice.parent_tran.trans_type_id),
          )
          if (!isPurchaseInvoicePredecessorType(typedParentEntity)) {
            throw new KledoError(
              'SCHEMA_MISMATCH',
              'Kledo returned an invalid immediate parent for the Purchase Invoice',
            )
          }
          parentEntity = typedParentEntity
        }
        const relations = invoice.parent_tran
          ? [
              {
                relation: 'derived_from',
                entity: parentEntity,
                id: String(invoice.parent_tran.id),
              },
            ]
          : []

        let documentLineage:
          | ReturnType<typeof normalizedPurchaseInvoiceLineage>['documentLineage']
          | undefined
        let omittedLineageDocumentCount = 0
        if (includes.has('document_lineage')) {
          const normalized = normalizedPurchaseInvoiceLineage(invoice, input.lineageLimit)
          documentLineage = normalized.documentLineage
          omittedLineageDocumentCount = normalized.omittedLineageDocumentCount
        }

        let paymentEvents: KledoPaymentEvent[] = []
        let omittedPaymentEventCount = 0
        if (includes.has('payment_events')) {
          const allPaymentEvents = normalizedPaymentEvents(
            input.id,
            invoice.transactions,
            invoice.relations,
            'purchase_payment',
          )
          paymentEvents = allPaymentEvents.slice(0, input.paymentEventLimit)
          omittedPaymentEventCount = allPaymentEvents.length - paymentEvents.length
        }

        return {
          entity: input.entity,
          record: projectFields(
            input.entity,
            input.fields,
            normalizeEntityItem(input.entity, invoice),
          ),
          ...(includes.has('line_items') ? { lineItems: selectedItems } : {}),
          ...(includes.has('relation_ids') ? { relations } : {}),
          ...(includes.has('document_lineage') ? { documentLineage } : {}),
          ...(includes.has('payment_events') ? { paymentEvents } : {}),
          truncation: {
            lineItems: includes.has('line_items') && omittedCount > 0,
            ...(includes.has('line_items') && omittedCount > 0 ? { omittedCount } : {}),
            ...(includes.has('document_lineage')
              ? { documentLineage: omittedLineageDocumentCount > 0 }
              : {}),
            ...(omittedLineageDocumentCount > 0 ? { omittedLineageDocumentCount } : {}),
            ...(includes.has('payment_events')
              ? { paymentEvents: omittedPaymentEventCount > 0 }
              : {}),
            ...(omittedPaymentEventCount > 0 ? { omittedPaymentEventCount } : {}),
          },
          meta: {
            fetchedAt: now().toISOString(),
            ...(options.tenant ? { tenant: options.tenant } : {}),
            warnings: [],
          },
        }
      }

      if (input.entity !== 'sales_invoice') {
        const unsupportedSalesInvoiceInclude = (
          [
            'invoice_payments',
            'document_lineage',
            'payment_events',
          ] as const
        ).find((include) => includes.has(include))
        if (unsupportedSalesInvoiceInclude) {
          invalid(`${input.entity} does not support ${unsupportedSalesInvoiceInclude}`)
        }
        if (includes.size > 0 && !transactionIncludeEntities.has(input.entity)) {
          invalid(`${input.entity} does not support includes`)
        }
        const definition = entityDefinitions[input.entity]
        if (!definition.detailPath) invalid(`${input.entity} has no detail endpoint`)

        const url = new URL(`${definition.detailPath}/${input.id}`, baseUrl)
        const body = await requestJson(url, signal)
        const envelope = rawEntityDetailEnvelopeSchema.parse(body)
        const extras = transactionIncludeEntities.has(input.entity)
          ? normalizeTransactionExtras(input.entity, envelope.data)
          : { lineItems: [], relations: [] }
        const selectedItems = extras.lineItems.slice(0, input.lineItemLimit)
        const omittedCount = extras.lineItems.length - selectedItems.length

        return {
          entity: input.entity,
          record: projectFields(
            input.entity,
            input.fields,
            normalizeEntityItem(input.entity, envelope.data),
          ),
          ...(includes.has('line_items') ? { lineItems: selectedItems } : {}),
          ...(includes.has('relation_ids') ? { relations: extras.relations } : {}),
          truncation: {
            lineItems: includes.has('line_items') && omittedCount > 0,
            ...(includes.has('line_items') && omittedCount > 0 ? { omittedCount } : {}),
          },
          meta: {
            fetchedAt: now().toISOString(),
            ...(options.tenant ? { tenant: options.tenant } : {}),
            warnings: [],
          },
        }
      }

      const url = new URL(`finance/invoices/${input.id}`, baseUrl)

      emitDiagnostic('get.sales_invoice.detail.request')
      const body = await requestJson(url, signal)

      const envelope = rawSalesInvoiceDetailEnvelopeSchema.parse(body)
      const invoice = envelope.data
      const selectedItems = invoice.items.slice(0, input.lineItemLimit)
      const omittedCount = invoice.items.length - selectedItems.length
      const lineItems = selectedItems.map((item) => ({
        id: String(item.id),
        description: item.desc,
        quantity: decimalString(item.qty),
        unitPrice: normalizeMoney(item.price, item, invoice),
        subtotal: normalizeMoney(item.subtotal, item, invoice),
        total: normalizeMoney(item.amount_after_tax, item, invoice),
        tax: normalizeMoney(item.tax, item, invoice),
        product: item.product
          ? { id: String(item.product.id), code: item.product.code, name: item.product.name }
          : null,
        taxRate: item.item_tax
          ? {
              id: String(item.item_tax.id),
              name: item.item_tax.name,
              percent: decimalString(item.item_tax.percent),
            }
          : null,
      }))
      let parentEntity: SalesInvoicePredecessorType = 'sales_order'
      if (
        invoice.parent_tran?.trans_type_id !== null &&
        invoice.parent_tran?.trans_type_id !== undefined
      ) {
        const typedParentEntity = documentTypeForTransactionTypeId(
          String(invoice.parent_tran.trans_type_id),
        )
        if (!isSalesInvoicePredecessorType(typedParentEntity)) {
          throw new KledoError(
            'SCHEMA_MISMATCH',
            'Kledo returned an invalid immediate parent for the Sales Invoice',
          )
        }
        parentEntity = typedParentEntity
      }
      const relations = invoice.parent_tran
        ? [
            {
              relation: 'derived_from',
              entity: parentEntity,
              id: String(invoice.parent_tran.id),
            },
          ]
        : []
      let documentLineage:
        | ReturnType<typeof normalizedSalesInvoiceLineage>['documentLineage']
        | undefined
      let omittedLineageDocumentCount = 0
      if (includes.has('document_lineage')) {
        const normalized = normalizedSalesInvoiceLineage(invoice, input.lineageLimit)
        documentLineage = normalized.documentLineage
        omittedLineageDocumentCount = normalized.omittedLineageDocumentCount
      }

      let invoicePayments: KledoInvoicePayment[] = []
      let omittedInvoicePaymentCount = 0
      let paymentEvents: KledoPaymentEvent[] = []
      let omittedPaymentEventCount = 0
      if (includes.has('invoice_payments') || includes.has('payment_events')) {
        const paymentsUrl = new URL(`finance/invoices/${input.id}/transactions`, baseUrl)
        emitDiagnostic('get.sales_invoice.payment_events.request')
        const paymentsBody = await requestJson(paymentsUrl, signal)
        const paymentsEnvelope = rawInvoicePaymentsEnvelopeSchema.parse(paymentsBody)
        if (includes.has('invoice_payments')) {
          const allInvoicePayments = normalizedInvoicePayments(input.id, paymentsEnvelope.data)
          invoicePayments = allInvoicePayments.slice(0, input.invoicePaymentLimit)
          omittedInvoicePaymentCount = allInvoicePayments.length - invoicePayments.length
        }
        if (includes.has('payment_events')) {
          const allPaymentEvents = normalizedPaymentEvents(
            input.id,
            paymentsEnvelope.data,
            invoice.relations,
          )
          paymentEvents = allPaymentEvents.slice(0, input.paymentEventLimit)
          omittedPaymentEventCount = allPaymentEvents.length - paymentEvents.length
        }
      }

      let printDocument: KledoGetResult['printDocument']
      let printDocumentResource: KledoGetResult[typeof KLEDO_DOCUMENT_RESOURCE]
      if (includes.has('print_document')) {
        if (!invoice.print_url) {
          throw new KledoError(
            'UNSUPPORTED_OPERATION',
            'This Sales Invoice does not provide a printable PDF',
          )
        }
        const resourceUri = `kledo://sales-invoice/${input.id}/print-document.pdf`
        const printUrl = new URL(
          `finance/invoices/${input.id}/download/${encodeURIComponent(invoice.print_url)}`,
          baseUrl,
        )
        emitDiagnostic('get.sales_invoice.print_document.request')
        const document = await requestPrintDocument(printUrl, signal)
        printDocument = {
          resourceUri,
          mimeType: 'application/pdf',
          byteCount: document.byteLength,
          sha256: createHash('sha256').update(document).digest('hex'),
        }
        printDocumentResource = {
          uri: resourceUri,
          mimeType: 'application/pdf',
          blob: document.toString('base64'),
        }
      }

      const output: KledoGetResult = {
        entity: input.entity,
        record: projectFields(input.entity, input.fields, normalizedSalesInvoice(invoice)),
        ...(includes.has('line_items') ? { lineItems } : {}),
        ...(includes.has('relation_ids') ? { relations } : {}),
        ...(includes.has('invoice_payments') ? { invoicePayments } : {}),
        ...(includes.has('document_lineage') ? { documentLineage } : {}),
        ...(includes.has('payment_events') ? { paymentEvents } : {}),
        ...(printDocument ? { printDocument } : {}),
        truncation: {
          lineItems: includes.has('line_items') && omittedCount > 0,
          ...(includes.has('line_items') && omittedCount > 0 ? { omittedCount } : {}),
          ...(includes.has('invoice_payments')
            ? { invoicePayments: omittedInvoicePaymentCount > 0 }
            : {}),
          ...(omittedInvoicePaymentCount > 0 ? { omittedInvoicePaymentCount } : {}),
          ...(includes.has('document_lineage')
            ? { documentLineage: omittedLineageDocumentCount > 0 }
            : {}),
          ...(omittedLineageDocumentCount > 0 ? { omittedLineageDocumentCount } : {}),
          ...(includes.has('payment_events')
            ? { paymentEvents: omittedPaymentEventCount > 0 }
            : {}),
          ...(omittedPaymentEventCount > 0 ? { omittedPaymentEventCount } : {}),
        },
        meta: {
          fetchedAt: now().toISOString(),
          ...(options.tenant ? { tenant: options.tenant } : {}),
          warnings: [],
        },
      }
      if (printDocumentResource) {
        Object.defineProperty(output, KLEDO_DOCUMENT_RESOURCE, {
          value: printDocumentResource,
          enumerable: false,
        })
      }
      return output
    },

    async report(input: KledoReportInput, signal?: AbortSignal): Promise<KledoReportOutput> {
      let path: string
      const wireParameters = new URLSearchParams()
      const parameters: Record<string, JsonValue> = {}
      let requestedPage: number | undefined
      let requestedPageSize: number | undefined
      let salesPersonFilter: { id: string; name?: string } | undefined
      let reportWarnings: readonly string[] = []

      switch (input.report) {
        case 'executive_summary': {
          if (!input.month) invalid('executive_summary requires month')
          path = 'reportings/executiveSummary'
          wireParameters.set('month', input.month)
          parameters.month = input.month
          break
        }
        case 'balance_sheet': {
          if (!input.asOf) invalid('balance_sheet requires asOf')
          path = 'reportings/balanceSheet'
          wireParameters.set('date', input.asOf)
          parameters.asOf = input.asOf
          if (input.comparison) {
            const comparison =
              input.comparison.interval === 'quarterly' ? 'quarters' : input.comparison.interval
            wireParameters.set('type', comparison)
            wireParameters.set('compare', String(input.comparison.periods))
            parameters.comparison = input.comparison
          }
          break
        }
        case 'profit_loss': {
          if (!input.period) invalid('profit_loss requires period')
          path = 'reportings/profitLoss'
          wireParameters.set('date_from', input.period.from)
          wireParameters.set('date_to', input.period.to)
          parameters.period = input.period
          if (input.comparePeriod) {
            wireParameters.set('type', 'custom')
            wireParameters.set('custom_compare_date_from', input.comparePeriod.from)
            wireParameters.set('custom_compare_date_to', input.comparePeriod.to)
            parameters.comparePeriod = input.comparePeriod
          }
          break
        }
        case 'cash_flow': {
          if (!input.period) invalid('cash_flow requires period')
          path = 'reportings/cashFlow'
          const method = input.method ?? 'indirect'
          wireParameters.set('method', method)
          wireParameters.set('date_from', input.period.from)
          wireParameters.set('date_to', input.period.to)
          parameters.period = input.period
          parameters.method = method
          break
        }
        case 'bank_summary': {
          if (!input.period) invalid('bank_summary requires period')
          path = 'reportings/bankSummary'
          wireParameters.set('date_from', input.period.from)
          wireParameters.set('date_to', input.period.to)
          parameters.period = input.period
          break
        }
        case 'receivable_by_invoice': {
          const periodType = 'monthly'
          const customerPage = pageFromCursor(
            input.cursor,
            'report',
            reportCursorRequest(input),
            cursorKey,
          )
          const summaryUrl = new URL('reportings/agedReceivable', baseUrl)
          summaryUrl.searchParams.set('date', input.asOf)
          summaryUrl.searchParams.set('period_type', periodType)
          summaryUrl.searchParams.set('per_page', String(input.pageSize))
          summaryUrl.searchParams.set('page', String(customerPage))
          emitDiagnostic('report.receivable_by_invoice.customer_totals.request')
          const summaryBody = await requestJson(summaryUrl, signal)
          const summaryPage = rawAgedReceivablePageEnvelopeSchema.parse(summaryBody).data
          if (
            summaryPage.current_page !== customerPage ||
            summaryPage.per_page !== input.pageSize
          ) {
            throw new KledoError(
              'SCHEMA_MISMATCH',
              'Kledo returned inconsistent receivable-customer pagination data',
            )
          }
          assertConsistentPagination(summaryPage)

          const summaryDueKeys = ['-2', '-1', '0', '1', '2', '3', '4'] as const
          const detailDueKeys = ['-3', ...summaryDueKeys] as const
          const summaryDueMatches = (
            detail: z.infer<typeof rawAgedReceivableDueSchema>,
            summary: z.infer<typeof rawAgedReceivableSummaryDueSchema>,
          ): boolean =>
            summaryDueKeys.every(
              (key) =>
                compareDecimals(decimalString(detail[key]), decimalString(summary[key])) === 0,
            )
          const detailDueMatches = (
            left: z.infer<typeof rawAgedReceivableDueSchema>,
            right: z.infer<typeof rawAgedReceivableDueSchema>,
          ): boolean =>
            detailDueKeys.every(
              (key) =>
                compareDecimals(decimalString(left[key]), decimalString(right[key])) === 0,
            )
          const normalizedTotals = (
            value: z.infer<typeof rawAgedReceivableDueSchema>,
          ): Record<string, JsonValue> => ({
            invoiceAmount: normalizeMoney(value['-3'], value),
            outstanding: normalizeMoney(value['-1'], value),
            notYetDue: normalizeMoney(value['-2'], value),
            overdue: {
              lessThanOneMonth: normalizeMoney(value['0'], value),
              oneToTwoMonths: normalizeMoney(value['1'], value),
              twoToThreeMonths: normalizeMoney(value['2'], value),
              threeToFourMonths: normalizeMoney(value['3'], value),
              moreThanFourMonths: normalizeMoney(value['4'], value),
            },
          })

          const customers = await Promise.all(
            summaryPage.data.map(async (summaryCustomer) => {
              const contactId = String(summaryCustomer.id)
              const invoices: z.infer<typeof rawAgedReceivableInvoiceSchema>[] = []
              const invoiceIds = new Set<string>()
              const detailPageSize = 100
              const maxInvoicesPerCustomer = 10_000
              let detailPageNumber = 1
              let verifiedContact: z.infer<typeof rawContactSchema> | undefined
              let verifiedTotalDue: z.infer<typeof rawAgedReceivableDueSchema> | undefined

              while (true) {
                const detailUrl = new URL(
                  `reportings/agedReceivableDetail/${contactId}`,
                  baseUrl,
                )
                detailUrl.searchParams.set('date', input.asOf)
                detailUrl.searchParams.set('period_type', periodType)
                detailUrl.searchParams.set('per_page', String(detailPageSize))
                detailUrl.searchParams.set('page', String(detailPageNumber))
                emitDiagnostic('report.receivable_by_invoice.invoice_breakdown.request')
                const detailBody = await requestJson(detailUrl, signal)
                const detailPage = rawAgedReceivableDetailEnvelopeSchema.parse(detailBody).data
                if (
                  detailPage.current_page !== detailPageNumber ||
                  detailPage.per_page !== detailPageSize ||
                  String(detailPage.contact.id) !== contactId ||
                  !summaryDueMatches(detailPage.total_due, summaryCustomer.due) ||
                  (verifiedTotalDue !== undefined &&
                    !detailDueMatches(detailPage.total_due, verifiedTotalDue))
                ) {
                  throw new KledoError(
                    'SCHEMA_MISMATCH',
                    'Kledo returned inconsistent receivable invoice-breakdown data',
                  )
                }
                assertConsistentPagination(detailPage)
                if (detailPage.total > maxInvoicesPerCustomer) {
                  throw new KledoError(
                    'SCHEMA_MISMATCH',
                    'Kledo returned too many receivable invoices to analyze safely',
                  )
                }
                if (verifiedContact) {
                  const previousCompany = verifiedContact.company?.trim() || null
                  const currentCompany = detailPage.contact.company?.trim() || null
                  const previousName = verifiedContact.name?.trim() || null
                  const currentName = detailPage.contact.name?.trim() || null
                  if (previousCompany !== currentCompany || previousName !== currentName) {
                    throw new KledoError(
                      'SCHEMA_MISMATCH',
                      'Kledo returned inconsistent receivable customer identity data',
                    )
                  }
                } else {
                  verifiedContact = detailPage.contact
                }
                verifiedTotalDue ??= detailPage.total_due
                for (const invoice of detailPage.data) {
                  const invoiceId = String(invoice.id)
                  if (invoiceIds.has(invoiceId)) {
                    throw new KledoError(
                      'SCHEMA_MISMATCH',
                      'Kledo returned duplicate receivable invoice identities',
                    )
                  }
                  invoiceIds.add(invoiceId)
                  invoices.push(invoice)
                }
                if (invoices.length > maxInvoicesPerCustomer) {
                  throw new KledoError(
                    'SCHEMA_MISMATCH',
                    'Kledo returned too many receivable invoices to analyze safely',
                  )
                }
                if (detailPage.current_page >= detailPage.last_page) break
                detailPageNumber += 1
              }

              if (!verifiedContact || !verifiedTotalDue) {
                throw new KledoError(
                  'SCHEMA_MISMATCH',
                  'Kledo returned receivable data without a customer identity',
                )
              }
              if (
                invoices.length === 0 &&
                compareDecimals(decimalString(summaryCustomer.due['-1']), '0') !== 0
              ) {
                throw new KledoError(
                  'SCHEMA_MISMATCH',
                  'Kledo returned an outstanding receivable without invoice details',
                )
              }

              const companyName =
                summaryCustomer.company?.trim() || verifiedContact.company?.trim() || null
              const personName =
                summaryCustomer.name?.trim() || verifiedContact.name?.trim() || null
              const summaryCompanyName = summaryCustomer.company?.trim() || null
              const detailCompanyName = verifiedContact.company?.trim() || null
              const summaryPersonName = summaryCustomer.name?.trim() || null
              const detailPersonName = verifiedContact.name?.trim() || null
              if (
                (summaryCompanyName !== null &&
                  detailCompanyName !== null &&
                  summaryCompanyName !== detailCompanyName) ||
                (summaryPersonName !== null &&
                  detailPersonName !== null &&
                  summaryPersonName !== detailPersonName)
              ) {
                throw new KledoError(
                  'SCHEMA_MISMATCH',
                  'Kledo returned inconsistent receivable customer identity data',
                )
              }
              const displayName = companyName || personName
              if (!displayName) {
                throw new KledoError(
                  'SCHEMA_MISMATCH',
                  'Kledo returned an unnamed receivable customer',
                )
              }

              return {
                customer: {
                  id: contactId,
                  displayName,
                  companyName,
                  personName,
                },
                totals: normalizedTotals(verifiedTotalDue),
                invoices: invoices.map((invoice) => ({
                  id: String(invoice.id),
                  invoiceNumber: invoice.ref_number,
                  transactionDate: invoice.trans_date,
                  dueDate: invoice.due_date,
                  projectReference: invoice.memo,
                  invoiceAmount: normalizeMoney(invoice.due['-3'], invoice.due),
                  outstanding: normalizeMoney(invoice.due['-1'], invoice.due),
                  notYetDue: normalizeMoney(invoice.due['-2'], invoice.due),
                  transactionAgeDays: invoice.age_trans,
                  dueAgeDays: invoice.age_due,
                })),
              }
            }),
          )

          const hasMore = summaryPage.current_page < summaryPage.last_page
          return kledoReportOutputSchema.parse({
            report: input.report,
            parameters: {
              asOf: input.asOf,
              periodType,
              pageSize: input.pageSize,
            },
            data: { customers },
            pageInfo: {
              ...(hasMore
                ? {
                    nextCursor: cursorForRequest(
                      'report',
                      reportCursorRequest(input),
                      summaryPage.current_page + 1,
                      cursorKey,
                    ),
                  }
                : {}),
              hasMore,
              total: summaryPage.total,
            },
            provenance: {
              customerTotals: '/reportings/agedReceivable',
              invoiceBreakdown: '/reportings/agedReceivableDetail/:contactId',
              projectReference: { apiField: 'memo', webUiField: 'Reference' },
            },
            meta: {
              fetchedAt: now().toISOString(),
              ...(options.tenant ? { tenant: options.tenant } : {}),
              source: 'kledo_semantic_adapter',
              complete: !hasMore,
              warnings: [
                "projectReference is Kledo's memo field, displayed as Reference in the Web UI.",
                'Each returned customer includes the complete invoice drill-down reported by Kledo for the selected as-of date.',
                ...(hasMore
                  ? [
                      'More customer pages remain; follow nextCursor before presenting a company-wide receivable list.',
                    ]
                  : []),
              ],
            },
          })
        }
        case 'aged_receivable':
        case 'aged_payable': {
          if (!input.asOf) invalid(`${input.report} requires asOf`)
          path =
            input.report === 'aged_receivable'
              ? 'reportings/agedReceivable'
              : 'reportings/agedPayable'
          requestedPage = pageFromCursor(
            input.cursor,
            'report',
            reportCursorRequest(input),
            cursorKey,
          )
          requestedPageSize = input.pageSize
          wireParameters.set('date', input.asOf)
          wireParameters.set('per_page', String(requestedPageSize))
          wireParameters.set('page', String(requestedPage))
          if (input.warehouseIds?.length) {
            wireParameters.set('warehouse_id', input.warehouseIds.join(','))
          }
          if (input.report === 'aged_receivable') {
            const salesPersonId = oneId(input.salesPersonIds, 'salesPersonIds')
            if (salesPersonId) wireParameters.set('sales_id', salesPersonId)
          }
          parameters.asOf = input.asOf
          parameters.pageSize = requestedPageSize
          if (input.warehouseIds) parameters.warehouseIds = input.warehouseIds
          if (input.report === 'aged_receivable' && input.salesPersonIds) {
            parameters.salesPersonIds = input.salesPersonIds
          }
          break
        }
        case 'sales_by_period':
        case 'purchases_by_period': {
          if (!input.period) invalid(`${input.report} requires period`)
          if (!input.unitId) invalid(`${input.report} requires unitId`)
          path =
            input.report === 'sales_by_period'
              ? 'reportings/salesPerPeriod'
              : 'reportings/purchasesPerPeriod'
          const interval = input.interval ?? 'month'
          const wireInterval = { day: 'daily', month: 'monthly', year: 'yearly' }[interval]
          wireParameters.set('unit_id', input.unitId)
          wireParameters.set('daterange', wireInterval)
          wireParameters.set('custom_daterange', '1')
          wireParameters.set('date_from', input.period.from)
          wireParameters.set('date_to', input.period.to)
          if (input.warehouseIds?.length) {
            wireParameters.set('warehouse_id', input.warehouseIds.join(','))
          }
          if (input.contactIds?.length) wireParameters.set('contacts_id', input.contactIds.join(','))
          const salesPersonId = oneId(input.salesPersonIds, 'salesPersonIds')
          if (salesPersonId) wireParameters.set('sales_id', salesPersonId)
          parameters.period = input.period
          parameters.unitId = input.unitId
          parameters.interval = interval
          if (input.warehouseIds) parameters.warehouseIds = input.warehouseIds
          if (input.contactIds) parameters.contactIds = input.contactIds
          if (input.salesPersonIds) parameters.salesPersonIds = input.salesPersonIds
          break
        }
        case 'sales_order_kpi': {
          const upstreamPageSize = 100
          const maxOrders = 10_000
          const includedStatusIds = ['5', '6', '7'] as const
          const includedStatuses = new Set<string>(includedStatusIds)
          if (input.salesPersonName) {
            const resolution = await resolveSalespersonName(input.salesPersonName, signal)
            salesPersonFilter = {
              id: resolution.salesperson.id,
              name: resolution.salesperson.name,
            }
            reportWarnings = resolution.warnings
          } else {
            salesPersonFilter = input.salesPersonId ? { id: input.salesPersonId } : undefined
          }

          let upstreamPage = 1
          let expectedTotal: number | undefined
          let expectedLastPage: number | undefined
          let orderCount = 0
          let orderedQuantity = '0'
          let netBookedOrderValue = '0'
          let grossBookedOrderValue = '0'
          let openOrderBacklog = '0'
          const orderIds = new Set<string>()

          while (true) {
            const ordersUrl = new URL('finance/orders', baseUrl)
            ordersUrl.searchParams.set('trans_type_ids', '6')
            ordersUrl.searchParams.set('status_ids', includedStatusIds.join(','))
            ordersUrl.searchParams.set('date_from', input.period.from)
            ordersUrl.searchParams.set('date_to', input.period.to)
            if (salesPersonFilter) ordersUrl.searchParams.set('sales_id', salesPersonFilter.id)
            ordersUrl.searchParams.set('per_page', String(upstreamPageSize))
            ordersUrl.searchParams.set('page', String(upstreamPage))

            emitDiagnostic('report.sales_order_kpi.orders.request')
            const body = await requestJson(ordersUrl, signal)
            const envelope = rawSalesOrderKpiPageEnvelopeSchema.parse(body)
            const page = envelope.data
            if (page.current_page !== upstreamPage || page.per_page !== upstreamPageSize) {
              throw new KledoError(
                'SCHEMA_MISMATCH',
                'Kledo returned inconsistent Sales Order pagination data',
              )
            }
            assertConsistentPagination(page)
            if (page.total > maxOrders) {
              throw new KledoError(
                'SCHEMA_MISMATCH',
                'Kledo returned too many Sales Orders to aggregate safely',
              )
            }
            if (expectedTotal === undefined) {
              expectedTotal = page.total
              expectedLastPage = page.last_page
            } else if (page.total !== expectedTotal || page.last_page !== expectedLastPage) {
              throw new KledoError(
                'SCHEMA_MISMATCH',
                'Kledo changed the Sales Order result set during aggregation',
              )
            }

            for (const order of page.data) {
              const id = String(order.id)
              const salespersonId =
                order.sales_id === null || order.sales_id === undefined
                  ? undefined
                  : String(order.sales_id)
              const outsideScope =
                String(order.trans_type_id) !== '6' ||
                !includedStatuses.has(String(order.status_id)) ||
                order.trans_date < input.period.from ||
                order.trans_date > input.period.to ||
                (salesPersonFilter !== undefined && salespersonId !== salesPersonFilter.id)
              if (outsideScope) {
                throw new KledoError(
                  'SCHEMA_MISMATCH',
                  'Kledo returned Sales Orders outside the requested KPI scope',
                )
              }
              if (orderIds.has(id)) {
                throw new KledoError(
                  'SCHEMA_MISMATCH',
                  'Kledo returned duplicate Sales Orders during KPI aggregation',
                )
              }
              orderIds.add(id)
              orderCount += 1
            }

            orderedQuantity = addDecimals(
              orderedQuantity,
              decimalString(page.grand_subtotal.qty),
            )
            netBookedOrderValue = addDecimals(
              netBookedOrderValue,
              decimalString(page.grand_subtotal.amount),
            )
            grossBookedOrderValue = addDecimals(
              grossBookedOrderValue,
              decimalString(page.grand_subtotal.amount_after_tax),
            )
            openOrderBacklog = addDecimals(
              openOrderBacklog,
              decimalString(page.grand_subtotal.unbilled_amount),
            )

            if (page.current_page >= page.last_page) break
            upstreamPage += 1
          }

          if (expectedTotal === undefined || orderCount !== expectedTotal) {
            throw new KledoError(
              'SCHEMA_MISMATCH',
              'Kledo returned an incomplete Sales Order KPI result set',
            )
          }

          return kledoReportOutputSchema.parse({
            report: input.report,
            parameters: {
              period: input.period,
              dateBasis: 'trans_date',
              ...(salesPersonFilter ? { salesperson: salesPersonFilter } : {}),
              statusPolicy: {
                name: 'booked',
                includedStatusIds,
              },
            },
            data: {
              orderCount,
              orderedQuantity,
              netBookedOrderValue: normalizeMoney(netBookedOrderValue),
              grossBookedOrderValue: normalizeMoney(grossBookedOrderValue),
              openOrderBacklog: normalizeMoney(openOrderBacklog),
            },
            provenance: {
              orders: '/finance/orders',
              transactionType: { id: '6', label: 'Sales Order' },
              aggregateFields: {
                orderedQuantity: 'grand_subtotal.qty',
                netBookedOrderValue: 'grand_subtotal.amount',
                grossBookedOrderValue: 'grand_subtotal.amount_after_tax',
                openOrderBacklog: 'grand_subtotal.unbilled_amount',
              },
              aggregateScope: 'sum_of_all_page_grand_subtotals',
            },
            meta: {
              fetchedAt: now().toISOString(),
              ...(options.tenant ? { tenant: options.tenant } : {}),
              source: 'kledo_semantic_adapter',
              complete: true,
              warnings: [
                ...reportWarnings,
                'Booked order value is order intake; it is not revenue, invoice value, or collected cash.',
                'Open order backlog is Kledo unbilled order value; it is not accounts receivable.',
              ],
            },
          })
        }
        case 'sales_by_person': {
          if (!input.period) invalid('sales_by_person requires period')
          path = 'reportings/salesPerPerson'
          requestedPage = pageFromCursor(
            input.cursor,
            'report',
            reportCursorRequest(input),
            cursorKey,
          )
          requestedPageSize = input.pageSize
          const dateBasis = input.dateBasis ?? 'trans_date'
          if (input.salesPersonName) {
            const resolution = await resolveSalespersonName(input.salesPersonName, signal)
            salesPersonFilter = resolution.salesperson
            reportWarnings = resolution.warnings
          } else {
            salesPersonFilter = input.salesPersonId ? { id: input.salesPersonId } : undefined
          }
          wireParameters.set('date_from', input.period.from)
          wireParameters.set('date_to', input.period.to)
          wireParameters.set('date_filter', dateBasis)
          if (salesPersonFilter) wireParameters.set('sales_id', salesPersonFilter.id)
          parameters.period = input.period
          parameters.dateBasis = dateBasis
          if (salesPersonFilter) parameters.salesperson = salesPersonFilter
          parameters.pageSize = requestedPageSize
          break
        }
        case 'sales_by_product':
        case 'income_by_customer': {
          if (!input.period) invalid(`${input.report} requires period`)
          path =
            input.report === 'sales_by_product'
              ? 'reportings/salesPerProduct'
              : 'reportings/incomePerCustomer'
          requestedPage = pageFromCursor(
            input.cursor,
            'report',
            reportCursorRequest(input),
            cursorKey,
          )
          requestedPageSize = input.limit
          wireParameters.set('date_from', input.period.from)
          wireParameters.set('date_to', input.period.to)
          if (input.report === 'sales_by_product' && input.productIds?.length) {
            wireParameters.set('product_ids', input.productIds.join(','))
          }
          wireParameters.set('per_page', String(requestedPageSize))
          wireParameters.set('page', String(requestedPage))
          if (input.warehouseIds?.length) {
            wireParameters.set('warehouse_id', input.warehouseIds.join(','))
          }
          const salesPersonId = oneId(input.salesPersonIds, 'salesPersonIds')
          if (salesPersonId) wireParameters.set('sales_id', salesPersonId)
          if (input.report === 'sales_by_product') {
            if (input.contactIds?.length) {
              wireParameters.set('contacts_id', input.contactIds.join(','))
            }
          } else {
            if (input.groupIds?.length) wireParameters.set('group_ids', input.groupIds.join(','))
            if (input.contactIds?.length) wireParameters.set('contact_ids', input.contactIds.join(','))
          }
          parameters.period = input.period
          parameters.limit = requestedPageSize
          if (input.contactIds) parameters.contactIds = input.contactIds
          if (input.report === 'sales_by_product' && input.productIds) {
            parameters.productIds = input.productIds
          }
          if (input.report === 'income_by_customer' && input.groupIds) {
            parameters.groupIds = input.groupIds
          }
          if (input.warehouseIds) parameters.warehouseIds = input.warehouseIds
          if (input.salesPersonIds) parameters.salesPersonIds = input.salesPersonIds
          break
        }
        case 'dormant_customers': {
          const inactiveDays = input.inactiveDays ?? 90
          const historyDays = input.historyDays ?? 365
          const pageSize = input.pageSize
          const localPage = pageFromCursor(
            input.cursor,
            'report',
            reportCursorRequest(input),
            cursorKey,
          )
          const inactivityCutoff = shiftIsoDate(input.asOf, -inactiveDays)
          const recentPeriod = {
            from: shiftIsoDate(inactivityCutoff, 1),
            to: input.asOf,
          }
          const historicalPeriod = {
            from: shiftIsoDate(inactivityCutoff, -(historyDays - 1)),
            to: inactivityCutoff,
          }
          const upstreamPageSize = 100
          const maxRows = 10_000
          const fetchWindow = async (
            period: { from: string; to: string },
            diagnosticEvent:
              | 'report.dormant_customers.historical.request'
              | 'report.dormant_customers.recent.request',
          ): Promise<z.infer<typeof rawIncomePerCustomerRowSchema>[]> => {
            const rows: z.infer<typeof rawIncomePerCustomerRowSchema>[] = []
            const contactIds = new Set<string>()
            let upstreamPage = 1
            while (true) {
              const reportUrl = new URL('reportings/incomePerCustomer', baseUrl)
              reportUrl.searchParams.set('date_from', period.from)
              reportUrl.searchParams.set('date_to', period.to)
              reportUrl.searchParams.set('per_page', String(upstreamPageSize))
              reportUrl.searchParams.set('page', String(upstreamPage))
              emitDiagnostic(diagnosticEvent)
              const reportBody = await requestJson(reportUrl, signal)
              const envelope = rawIncomePerCustomerPageEnvelopeSchema.parse(reportBody)
              const page = envelope.data
              if (page.current_page !== upstreamPage || page.per_page !== upstreamPageSize) {
                throw new KledoError(
                  'SCHEMA_MISMATCH',
                  'Kledo returned inconsistent customer-income pagination data',
                )
              }
              assertConsistentPagination(page)
              if (page.total > maxRows) {
                throw new KledoError(
                  'SCHEMA_MISMATCH',
                  'Kledo returned too many customer-income rows to analyze safely',
                )
              }
              for (const row of page.data) {
                const contactId = String(row.contact_id)
                if (String(row.contact.id) !== contactId || contactIds.has(contactId)) {
                  throw new KledoError(
                    'SCHEMA_MISMATCH',
                    'Kledo returned inconsistent customer identity data',
                  )
                }
                contactIds.add(contactId)
                rows.push(row)
              }
              if (rows.length > maxRows) {
                throw new KledoError(
                  'SCHEMA_MISMATCH',
                  'Kledo returned too many customer-income rows to analyze safely',
                )
              }
              if (page.current_page >= page.last_page) break
              upstreamPage += 1
            }
            return rows
          }

          const historicalRows = await fetchWindow(
            historicalPeriod,
            'report.dormant_customers.historical.request',
          )
          const recentRows = await fetchWindow(
            recentPeriod,
            'report.dormant_customers.recent.request',
          )
          const recentContactIds = new Set(recentRows.map((row) => String(row.contact_id)))
          const candidates = historicalRows
            .filter((row) => !recentContactIds.has(String(row.contact_id)))
            .sort((left, right) => {
              const byIncome = compareDecimals(
                decimalString(right.amount),
                decimalString(left.amount),
              )
              if (byIncome !== 0) return byIncome
              return String(left.contact_id).localeCompare(String(right.contact_id), 'en', {
                numeric: true,
              })
            })
            .map((row) => {
              const companyName = row.contact.company?.trim() || null
              const personName = row.contact.name?.trim() || null
              const displayName = companyName || personName
              if (!displayName) {
                throw new KledoError(
                  'SCHEMA_MISMATCH',
                  'Kledo returned a dormant-customer candidate without a display name',
                )
              }
              return {
                customer: {
                  id: String(row.contact_id),
                  displayName,
                  companyName,
                  personName,
                },
                historicalIncome: normalizeMoney(row.amount, row),
                historicalTransactionCount: row.total_transactions,
              }
            })
          const offset = (localPage - 1) * pageSize
          const selectedCandidates = candidates.slice(offset, offset + pageSize)
          const hasMore = offset + selectedCandidates.length < candidates.length

          return kledoReportOutputSchema.parse({
            report: input.report,
            parameters: {
              asOf: input.asOf,
              inactiveDays,
              historyDays,
              inactivityCutoff,
              historicalPeriod,
              recentPeriod,
              pageSize,
            },
            data: { candidates: selectedCandidates },
            pageInfo: {
              ...(hasMore
                ? {
                    nextCursor: cursorForRequest(
                      'report',
                      reportCursorRequest(input),
                      localPage + 1,
                      cursorKey,
                    ),
                  }
                : {}),
              hasMore,
              total: candidates.length,
            },
            meta: {
              fetchedAt: now().toISOString(),
              ...(options.tenant ? { tenant: options.tenant } : {}),
              source: 'kledo_native_report',
              complete: !hasMore,
              warnings: [
                'Dormancy candidates are inferred from missing recent Kledo income activity; this is not proof that the customer relationship has ended.',
                "The exact last transaction date is unavailable from Kledo's Income per Customer report.",
                'Review contact status and outreach consent before follow-up.',
                'Customers with activity only before the historical eligibility period are outside this analysis.',
              ],
            },
          })
        }
        case 'item_price_analysis': {
          const product = await resolveProductSelection(input, signal)
          const profitabilityMethod = input.profitabilityMethod ?? 'inventory'

          const detailUrl = new URL(`finance/products/${product.id}`, baseUrl)
          const latestSellUrl = new URL('finance/products/last_prices', baseUrl)
          latestSellUrl.searchParams.set('ids', product.id)
          const latestPurchaseUrl = new URL('finance/products/last_buy_prices', baseUrl)
          latestPurchaseUrl.searchParams.set('ids', product.id)
          const latestPurchaseTransactionUrl = new URL(
            `finance/products/${product.id}/transactions`,
            baseUrl,
          )
          latestPurchaseTransactionUrl.searchParams.set('trans_type_ids', '3')
          latestPurchaseTransactionUrl.searchParams.set('sort_by', 'trans_date')
          latestPurchaseTransactionUrl.searchParams.set('order_by', 'desc')
          latestPurchaseTransactionUrl.searchParams.set('per_page', '100')
          latestPurchaseTransactionUrl.searchParams.set('page', '1')
          const profitabilityUrl = new URL(
            `finance/products/${product.id}/profitability`,
            baseUrl,
          )
          profitabilityUrl.searchParams.set('date_from', input.period.from)
          profitabilityUrl.searchParams.set('date_to', input.period.to)
          profitabilityUrl.searchParams.set('method', profitabilityMethod)

          emitDiagnostic('report.item_price_analysis.product_detail.request')
          emitDiagnostic('report.item_price_analysis.latest_sell.request')
          emitDiagnostic('report.item_price_analysis.latest_purchase.request')
          emitDiagnostic('report.item_price_analysis.purchase_transactions.request')
          emitDiagnostic('report.item_price_analysis.profitability.request')
          const [
            detailBody,
            latestSellBody,
            latestPurchaseBody,
            latestPurchaseTransactionBody,
            profitabilityBody,
          ] = await Promise.all([
            requestJson(detailUrl, signal),
            requestJson(latestSellUrl, signal),
            requestJson(latestPurchaseUrl, signal),
            requestJson(latestPurchaseTransactionUrl, signal),
            requestJson(profitabilityUrl, signal),
          ])
          const detail = rawProductPriceDetailEnvelopeSchema.parse(detailBody).data
          const latestSellRows = rawLatestSellPriceEnvelopeSchema.parse(latestSellBody).data
          const latestPurchaseRows = rawLatestPurchasePriceEnvelopeSchema.parse(
            latestPurchaseBody,
          ).data
          const latestPurchaseTransactionPage =
            rawProductPurchaseTransactionsEnvelopeSchema.parse(
              latestPurchaseTransactionBody,
            ).data
          const profitability = rawProductProfitabilityEnvelopeSchema.parse(
            profitabilityBody,
          ).data

          const detailCode = detail.code ?? null
          if (
            String(detail.id) !== product.id ||
            detailCode !== product.code ||
            detail.name !== product.name
          ) {
            throw new KledoError(
              'SCHEMA_MISMATCH',
              'Kledo returned inconsistent product identity data',
            )
          }
          if (
            latestSellRows.length > 1 ||
            latestSellRows.some((row) => String(row.id) !== product.id) ||
            Object.keys(latestPurchaseRows).some((id) => id !== product.id)
          ) {
            throw new KledoError(
              'SCHEMA_MISMATCH',
              'Kledo returned inconsistent latest product-price data',
            )
          }
          if (
            latestPurchaseTransactionPage.current_page !== 1 ||
            latestPurchaseTransactionPage.per_page !== 100 ||
            latestPurchaseTransactionPage.data.some(
              (transaction) => String(transaction.trans_type_id) !== '3',
            )
          ) {
            throw new KledoError(
              'SCHEMA_MISMATCH',
              'Kledo returned inconsistent product purchase-transaction data',
            )
          }
          assertConsistentPagination(latestPurchaseTransactionPage)
          if (
            String(profitability.product_id) !== product.id ||
            String(profitability.product.id) !== product.id ||
            profitability.product.name !== product.name ||
            (profitability.product.code ?? null) !== product.code ||
            profitability.date_from !== input.period.from ||
            profitability.date_to !== input.period.to ||
            profitability.method !== profitabilityMethod
          ) {
            throw new KledoError(
              'SCHEMA_MISMATCH',
              'Kledo returned inconsistent product-profitability data',
            )
          }

          const latestSell = latestSellRows[0]
          const latestPurchase = latestPurchaseRows[product.id]
          const latestPurchasePrice = latestPurchase?.last_buy_price
          const latestPurchaseDate = (() => {
            if (
              latestPurchasePrice === null ||
              latestPurchasePrice === undefined ||
              latestPurchaseTransactionPage.data.length === 0
            ) {
              return null
            }
            const latestDate = latestPurchaseTransactionPage.data[0]!.trans_date
            const corroborated = latestPurchaseTransactionPage.data.some(
              (transaction) =>
                transaction.trans_date === latestDate &&
                transaction.price !== null &&
                compareDecimals(
                  decimalString(transaction.price),
                  decimalString(latestPurchasePrice),
                ) === 0,
            )
            return corroborated ? latestDate : null
          })()
          const booleanFlag = (
            value: boolean | 0 | 1 | null | undefined,
          ): boolean | null => {
            if (value === null || value === undefined) return null
            return typeof value === 'boolean' ? value : value === 1
          }
          const optionalMoney = (
            value: string | number | null | undefined,
            source: unknown,
          ): Record<string, JsonValue> | null =>
            value === null || value === undefined ? null : normalizeMoney(value, source, detail)

          return kledoReportOutputSchema.parse({
            report: input.report,
            parameters: {
              productSelector: input.productCode
                ? { code: input.productCode }
                : { name: input.productName },
              period: input.period,
              profitabilityMethod,
            },
            data: {
              product: {
                id: product.id,
                code: product.code,
                name: product.name,
                unit: detail.unit
                  ? { id: String(detail.unit.id), name: detail.unit.name }
                  : null,
                canSell: booleanFlag(detail.is_sell),
                canPurchase: booleanFlag(detail.is_purchase),
                tracked: booleanFlag(detail.is_track),
              },
              catalogPrices: {
                salePrice: optionalMoney(detail.price, detail),
                basePurchasePrice: optionalMoney(detail.base_price, detail),
                averageInventoryCost: optionalMoney(detail.avg_base_price, detail),
              },
              latestTransactionPrices: {
                soldUnitPrice: optionalMoney(latestSell?.last_sell_price, latestSell),
                soldTransactionDate: detail.last_sale_transaction?.trans_date ?? null,
                purchasedUnitPrice: optionalMoney(
                  latestPurchasePrice,
                  latestPurchase,
                ),
                purchaseTransactionDate: latestPurchaseDate,
              },
              profitability: {
                soldQuantity: decimalString(profitability.qty),
                totalSales: normalizeMoney(profitability.total_sales, profitability, detail),
                totalCostOfGoodsSold: normalizeMoney(
                  profitability.total_hpp,
                  profitability,
                  detail,
                ),
                grossProfit: normalizeMoney(
                  profitability.total_profit,
                  profitability,
                  detail,
                ),
                grossMarginPercent: decimalString(profitability.profit_margin),
                averageSoldUnitPrice: normalizeMoney(
                  profitability.avg_sales,
                  profitability,
                  detail,
                ),
                averageCostOfGoodsSoldPerUnit: normalizeMoney(
                  profitability.avg_hpp,
                  profitability,
                  detail,
                ),
              },
            },
            provenance: {
              productResolution: '/finance/products',
              catalogPrices: '/finance/products/:id',
              latestSoldUnitPrice: '/finance/products/last_prices',
              latestPurchasedUnitPrice: '/finance/products/last_buy_prices',
              latestPurchaseTransaction: '/finance/products/:id/transactions',
              profitability: '/finance/products/:id/profitability',
            },
            meta: {
              fetchedAt: now().toISOString(),
              ...(options.tenant ? { tenant: options.tenant } : {}),
              source: 'kledo_semantic_adapter',
              complete: true,
              warnings: [
                'Catalog prices are product settings; they are not evidence of a completed sale or purchase.',
                ...(latestPurchasePrice !== null &&
                latestPurchasePrice !== undefined &&
                latestPurchaseDate === null
                  ? [
                      "Kledo's latest purchase price could not be matched to the newest Purchase Invoice date.",
                    ]
                  : [
                      "The latest purchase date is corroborated against Kledo's product transactions filtered to Purchase Invoices.",
                    ]),
                "Period profitability uses Kledo's product profitability and HPP calculation for the requested method.",
              ],
            },
          })
        }
        default:
          throw new KledoError('UNSUPPORTED_OPERATION', 'Unsupported Kledo report')
      }

      const url = new URL(path, baseUrl)
      url.search = wireParameters.toString()

      if (input.report === 'sales_by_person') {
        emitDiagnostic('report.sales_by_person.request')
      }
      const body = await requestJson(url, signal)
      if (input.report === 'sales_by_person') {
        if (requestedPage === undefined || requestedPageSize === undefined) {
          throw new KledoError('INTERNAL_ERROR', 'Sales by person pagination was not initialized')
        }
        const envelope = rawSalesByPersonEnvelopeSchema.parse(body)
        const allRows = envelope.data
        if (
          salesPersonFilter &&
          allRows.some((row) => String(row.sales_id) !== salesPersonFilter.id)
        ) {
          throw new KledoError(
            'SCHEMA_MISMATCH',
            'Kledo returned a different salesperson than requested',
          )
        }
        if (allRows.some((row) => String(row.sales.id) !== String(row.sales_id))) {
          throw new KledoError(
            'SCHEMA_MISMATCH',
            'Kledo returned inconsistent salesperson identity data',
          )
        }
        const offset = (requestedPage - 1) * requestedPageSize
        const selectedRows = allRows.slice(offset, offset + requestedPageSize)
        const hasMore = offset + selectedRows.length < allRows.length
        const rows = selectedRows.map((row) => ({
          salesperson: { id: String(row.sales_id), name: row.sales.name },
          sales: normalizeMoney(row.total_amount_after_tax, row),
          salesCount: row.total_count,
          commission: normalizeMoney(row.total_commission, row),
        }))
        const matchedName = rows.length === 1 ? rows[0]?.salesperson.name : undefined
        if (salesPersonFilter) {
          parameters.salesperson = {
            id: salesPersonFilter.id,
            ...(salesPersonFilter.name
              ? { name: salesPersonFilter.name }
              : matchedName
                ? { name: matchedName }
                : {}),
          }
        }

        return kledoReportOutputSchema.parse({
          report: input.report,
          parameters: {
            period: input.period,
            dateBasis: input.dateBasis ?? 'trans_date',
            ...(parameters.salesperson ? { salesperson: parameters.salesperson } : {}),
            pageSize: requestedPageSize,
          },
          data: { rows },
          pageInfo: {
            ...(hasMore
              ? {
                  nextCursor: cursorForRequest(
                    'report',
                    reportCursorRequest(input),
                    requestedPage + 1,
                    cursorKey,
                  ),
                }
              : {}),
            hasMore,
            total: allRows.length,
          },
          meta: {
            fetchedAt: now().toISOString(),
            ...(options.tenant ? { tenant: options.tenant } : {}),
            source: 'kledo_native_report',
            complete: !hasMore,
            warnings: reportWarnings,
          },
        })
      }
      if (requestedPage !== undefined && requestedPageSize !== undefined) {
        const envelope = rawNativeReportPageEnvelopeSchema.parse(body)
        const page = envelope.data
        if (page.current_page !== requestedPage || page.per_page !== requestedPageSize) {
          throw new KledoError('SCHEMA_MISMATCH', 'Kledo returned inconsistent pagination data')
        }
        if (page.data.length > requestedPageSize) {
          throw new KledoError('SCHEMA_MISMATCH', 'Kledo returned more report rows than requested')
        }
        assertConsistentPagination(page)
        const hasMore = page.current_page < page.last_page
        return {
          report: input.report,
          parameters,
          data: page.data,
          pageInfo: {
            ...(hasMore
              ? {
                  nextCursor: cursorForRequest(
                    'report',
                    reportCursorRequest(input),
                    page.current_page + 1,
                    cursorKey,
                  ),
                }
              : {}),
            hasMore,
            total: page.total,
          },
          meta: {
            fetchedAt: now().toISOString(),
            ...(options.tenant ? { tenant: options.tenant } : {}),
            source: 'kledo_native_report',
            complete: !hasMore,
            warnings: [],
          },
        }
      }

      const envelope = rawNativeReportEnvelopeSchema.parse(body)
      const cache = envelope._cache_meta
      const warnings =
        cache?.from_cache === true
          ? [`Kledo returned cached report data (${cache.cache_age_seconds} seconds old)`]
          : []

      return {
        report: input.report,
        parameters,
        data: envelope.data,
        meta: {
          fetchedAt: now().toISOString(),
          ...(options.tenant ? { tenant: options.tenant } : {}),
          source: 'kledo_native_report',
          complete: true,
          warnings,
        },
      }
    },
  }
}
