import { z } from 'zod'

import type { JsonValue } from '../domain/json.js'

export const kledoEntitySchema = z.enum([
  'sales_invoice',
  'purchase_invoice',
  'sales_order',
  'purchase_order',
  'sales_delivery',
  'purchase_delivery',
  'sales_quote',
  'contact',
  'product',
  'account',
  'bank_transaction',
  'expense',
  'warehouse',
  'unit',
])

export const kledoDetailEntitySchema = kledoEntitySchema.exclude(['unit'])

export const kledoReportNameSchema = z.enum([
  'executive_summary',
  'balance_sheet',
  'profit_loss',
  'cash_flow',
  'aged_receivable',
  'aged_payable',
  'bank_summary',
  'sales_by_period',
  'purchases_by_period',
  'sales_by_product',
  'income_by_customer',
])

const KLEDO_QUERY_FILTER_FIELDS = [
  'contactId',
  'statusId',
  'productId',
  'warehouseId',
  'salesPersonId',
  'bankAccountId',
  'transactionType',
  'typeId',
  'groupId',
  'categoryId',
  'archived',
  'canSell',
  'canPurchase',
  'tracked',
  'transactionDate',
  'dueDate',
  'shippingDate',
  'paymentDate',
  'amount',
] as const

const KLEDO_QUERY_SORT_FIELDS = [
  'transactionDate',
  'statusId',
  'dueDate',
  'total',
  'memo',
  'reference',
  'remaining',
  'paymentDate',
  'name',
  'company',
  'payable',
  'receivable',
  'code',
  'category',
  'basePrice',
  'salePrice',
] as const

const KLEDO_QUERY_PROJECTION_FIELDS = [
  'kind',
  'id',
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
  'displayName',
  'companyName',
  'personName',
  'groupId',
  'typeIds',
  'archived',
  'code',
  'name',
  'category',
  'canSell',
  'canPurchase',
  'tracked',
  'basePrice',
  'salePrice',
  'balance',
] as const

export const KLEDO_QUERY_FILTER_COMPATIBILITY = [
  'Filter compatibility:',
  'Use quoted strings for every ID, date, and decimal amount, including all in-list values and both between endpoints; only archived, canSell, canPurchase, and tracked use boolean values.',
  'ID filter operations default to eq only.',
  'in is allowed only for productId on its supported transaction entities, product.categoryId, bank_transaction.transactionType, sales_order.statusId (status_id for eq; status_ids for in), and warehouseId on purchase_invoice, sales_order, purchase_order, purchase_delivery, or sales_quote.',
  'sales_invoice=contactId,statusId,productId,transactionDate,dueDate,shippingDate,paymentDate,amount;',
  'purchase_invoice=contactId,statusId,productId,warehouseId,transactionDate,dueDate,shippingDate,paymentDate,amount;',
  'sales_order=contactId,statusId,productId,warehouseId,salesPersonId,transactionDate,dueDate,shippingDate,paymentDate,amount;',
  'purchase_order=contactId,statusId,productId,warehouseId,transactionDate,dueDate,paymentDate,amount;',
  'sales_delivery=contactId,statusId,productId,warehouseId,salesPersonId,transactionDate,shippingDate,amount;',
  'purchase_delivery=contactId,statusId,productId,warehouseId,transactionDate;',
  'sales_quote=contactId,statusId,productId,warehouseId,salesPersonId,transactionDate,shippingDate,amount;',
  'contact=typeId,groupId,archived;',
  'product=categoryId,archived,canSell,canPurchase,tracked;',
  'account=categoryId,archived;',
  'bank_transaction=bankAccountId(required eq),statusId,transactionType,transactionDate,amount;',
  'expense=contactId,statusId,productId,transactionDate,paymentDate,amount;',
  'warehouse=none; unit=none.',
].join(' ')

const KLEDO_QUERY_SORT_COMPATIBILITY = [
  'Sort compatibility:',
  'sales_invoice,purchase_invoice=transactionDate,statusId,dueDate,total,memo,reference,remaining,paymentDate;',
  'sales_order,purchase_order,sales_delivery,purchase_delivery,sales_quote=transactionDate,statusId,dueDate,total,memo,reference;',
  'bank_transaction=transactionDate,memo,statusId;',
  'expense=transactionDate,statusId,remaining,total,reference;',
  'contact=name,company,payable,receivable;',
  'product=name,code,category,basePrice,salePrice;',
  'account=name,code,category;',
  'warehouse=none; unit=none.',
].join(' ')

const KLEDO_QUERY_PROJECTION_COMPATIBILITY = [
  'Projection compatibility:',
  'sales_invoice,purchase_invoice,sales_order,purchase_order,sales_delivery,purchase_delivery,sales_quote,bank_transaction,expense=reference,transactionDate,dueDate,shippingDate,party,memo,statusId,total,remaining,paymentState,unbilled,sourceUpdatedAt,bankAccount,transactionType;',
  'contact=displayName,companyName,personName,groupId,typeIds,archived;',
  'product=code,name,category,canSell,canPurchase,tracked,basePrice,salePrice;',
  'account=code,name,category,balance,archived;',
  'warehouse=name,archived; unit=name; kind,id are always included.',
].join(' ')

const kledoQueryFilterFieldSchema = z
  .enum(KLEDO_QUERY_FILTER_FIELDS)
  .describe(KLEDO_QUERY_FILTER_COMPATIBILITY)
const kledoQuerySortFieldSchema = z
  .enum(KLEDO_QUERY_SORT_FIELDS)
  .describe(KLEDO_QUERY_SORT_COMPATIBILITY)
const kledoQueryProjectionFieldSchema = z
  .enum(KLEDO_QUERY_PROJECTION_FIELDS)
  .describe(KLEDO_QUERY_PROJECTION_COMPATIBILITY)

const KLEDO_QUERY_FILTER_VALUE_GUIDANCE =
  'Filter values must use quoted strings for IDs, dates, and decimal amounts; arrays and range endpoints must also contain quoted strings. Only boolean flags use true or false.'

const filterStringSchema = z.string().max(200)
const scalarSchema = z.union([filterStringSchema, z.boolean()])

const filterValueSchema = z
  .union(
    [
      scalarSchema,
      z.array(filterStringSchema).max(100),
      z
        .object({
          from: filterStringSchema.optional(),
          to: filterStringSchema.optional(),
        })
        .strict(),
    ],
    { error: KLEDO_QUERY_FILTER_VALUE_GUIDANCE },
  )
  .describe(KLEDO_QUERY_FILTER_VALUE_GUIDANCE)

export const kledoQueryInputSchema = z
  .object({
    entity: kledoEntitySchema,
    search: z.string().trim().min(1).max(200).optional(),
    filters: z
      .array(
        z
          .object({
            field: kledoQueryFilterFieldSchema,
            op: z.enum(['eq', 'in', 'gte', 'lte', 'between']),
            value: filterValueSchema,
          })
          .strict(),
      )
      .max(12)
      .optional(),
    sort: z
      .array(
        z
          .object({
            field: kledoQuerySortFieldSchema,
            direction: z.enum(['asc', 'desc']),
          })
          .strict(),
      )
      .max(1)
      .optional(),
    fields: z.array(kledoQueryProjectionFieldSchema).max(20).optional(),
    pageSize: z.number().int().min(1).max(100).default(20),
    cursor: z.string().min(1).max(2048).optional(),
  })
  .strict()

export const kledoGetInputSchema = z
  .object({
    entity: kledoDetailEntitySchema,
    id: z
      .string()
      .regex(/^[1-9]\d{0,19}$/, 'id must be a positive decimal Kledo ID of at most 20 digits'),
    include: z
      .array(z.enum(['line_items', 'relation_ids', 'invoice_payments']))
      .max(3)
      .optional(),
    lineItemLimit: z.number().int().min(1).max(200).default(50),
    invoicePaymentLimit: z.number().int().min(1).max(200).default(50),
    fields: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
  })
  .strict()

const isoDateSchema = z.string().date()
const periodSchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
  })
  .strict()
  .refine(({ from, to }) => from <= to, {
    message: 'from must be on or before to',
    path: ['to'],
  })

const idSchema = z.string().regex(/^[1-9]\d{0,19}$/)
const idsSchema = z.array(idSchema).max(100)
const oneIdSchema = z.array(idSchema).max(1)
const cursorSchema = z.string().min(1).max(2048)
const pageSizeSchema = z.number().int().min(1).max(100).default(20)

export const kledoReportInputSchema = z.discriminatedUnion('report', [
  z
    .object({
      report: z.literal('executive_summary'),
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    })
    .strict(),
  z
    .object({
      report: z.literal('balance_sheet'),
      asOf: isoDateSchema,
      comparison: z
        .object({
          interval: z.enum(['monthly', 'quarterly', 'yearly']),
          periods: z.number().int().min(1).max(11),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      report: z.literal('profit_loss'),
      period: periodSchema,
      comparePeriod: periodSchema.optional(),
    })
    .strict(),
  z
    .object({
      report: z.literal('cash_flow'),
      period: periodSchema,
      method: z.enum(['direct', 'indirect']).default('indirect'),
    })
    .strict(),
  z
    .object({
      report: z.literal('aged_receivable'),
      asOf: isoDateSchema,
      warehouseIds: idsSchema.optional(),
      salesPersonIds: oneIdSchema.optional(),
      pageSize: pageSizeSchema,
      cursor: cursorSchema.optional(),
    })
    .strict(),
  z
    .object({
      report: z.literal('aged_payable'),
      asOf: isoDateSchema,
      warehouseIds: idsSchema.optional(),
      pageSize: pageSizeSchema,
      cursor: cursorSchema.optional(),
    })
    .strict(),
  z
    .object({
      report: z.literal('bank_summary'),
      period: periodSchema,
    })
    .strict(),
  z
    .object({
      report: z.enum(['sales_by_period', 'purchases_by_period']),
      period: periodSchema,
      interval: z.enum(['day', 'month', 'year']).default('month'),
      unitId: idSchema,
      contactIds: idsSchema.optional(),
      warehouseIds: idsSchema.optional(),
      salesPersonIds: oneIdSchema.optional(),
    })
    .strict(),
  z
    .object({
      report: z.literal('sales_by_product'),
      period: periodSchema,
      productIds: idsSchema.optional(),
      contactIds: idsSchema.optional(),
      warehouseIds: idsSchema.optional(),
      salesPersonIds: oneIdSchema.optional(),
      limit: pageSizeSchema,
      cursor: cursorSchema.optional(),
    })
    .strict(),
  z
    .object({
      report: z.literal('income_by_customer'),
      period: periodSchema,
      contactIds: idsSchema.optional(),
      groupIds: idsSchema.optional(),
      warehouseIds: idsSchema.optional(),
      salesPersonIds: oneIdSchema.optional(),
      limit: pageSizeSchema,
      cursor: cursorSchema.optional(),
    })
    .strict(),
])

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
)

const resultMetaSchema = z
  .object({
    fetchedAt: z.string().datetime(),
    tenant: z.string().optional(),
    complete: z.boolean(),
    warnings: z.array(z.string()),
  })
  .strict()

const pageInfoSchema = z
  .object({
    nextCursor: z.string().optional(),
    hasMore: z.boolean(),
    total: z.number().int().nonnegative().optional(),
  })
  .strict()

export const kledoQueryOutputSchema = z
  .object({
    entity: kledoEntitySchema,
    items: z.array(z.record(z.string(), jsonValueSchema)),
    pageInfo: pageInfoSchema,
    meta: resultMetaSchema,
  })
  .strict()

const normalizedMoneyOutputSchema = z
  .object({
    amount: z.string().regex(/^-?\d+(?:\.\d+)?$/),
    currency: z.string().nullable(),
    currencyId: z.string().regex(/^[1-9]\d{0,19}$/).optional(),
    currencyName: z.string().optional(),
  })
  .strict()

export const invoicePaymentOutputSchema = z
  .object({
    id: z.string().regex(/^[1-9]\d{0,19}$/),
    invoiceId: z.string().regex(/^[1-9]\d{0,19}$/),
    transactionDate: z
      .string()
      .date()
      .describe(
        'Date of this direct Kledo type-17 Invoice Payment event; not the invoice final settlement or paid date.',
      ),
    amount: normalizedMoneyOutputSchema,
    statusId: z.string().regex(/^[1-9]\d{0,19}$/).nullable(),
    bankAccount: z
      .object({
        id: z.string().regex(/^[1-9]\d{0,19}$/),
        name: z.string().nullable(),
      })
      .strict()
      .nullable(),
    paymentTypeId: z.string().regex(/^[1-9]\d{0,19}$/).nullable(),
  })
  .strict()

export const kledoGetOutputSchema = z
  .object({
    entity: kledoDetailEntitySchema,
    record: z.record(z.string(), jsonValueSchema),
    lineItems: z.array(z.record(z.string(), jsonValueSchema)).optional(),
    invoicePayments: z
      .array(invoicePaymentOutputSchema)
      .describe(
        'Direct child Invoice Payment transactions only (Kledo type 17); other child transaction types are excluded.',
      )
      .optional(),
    relations: z
      .array(
        z
          .object({
            relation: z.string(),
            entity: kledoEntitySchema.optional(),
            id: z.string(),
          })
          .strict(),
      )
      .optional(),
    truncation: z
      .object({
        lineItems: z.boolean(),
        omittedCount: z.number().int().nonnegative().optional(),
        invoicePayments: z.boolean().optional(),
        omittedInvoicePaymentCount: z.number().int().nonnegative().optional(),
      })
      .strict(),
    meta: resultMetaSchema.omit({ complete: true }),
  })
  .strict()

export const kledoReportOutputSchema = z
  .object({
    report: kledoReportNameSchema,
    parameters: z.record(z.string(), jsonValueSchema),
    data: jsonValueSchema,
    pageInfo: pageInfoSchema.optional(),
    meta: resultMetaSchema.extend({ source: z.literal('kledo_native_report') }),
  })
  .strict()

export type KledoQueryInput = z.infer<typeof kledoQueryInputSchema>
export type KledoEntity = z.infer<typeof kledoEntitySchema>
export type KledoGetInput = z.infer<typeof kledoGetInputSchema>
export type KledoReportInput = z.infer<typeof kledoReportInputSchema>
export type KledoQueryOutput = z.infer<typeof kledoQueryOutputSchema>
export type KledoGetOutput = z.infer<typeof kledoGetOutputSchema>
export type KledoReportOutput = z.infer<typeof kledoReportOutputSchema>
export type KledoInvoicePayment = z.infer<typeof invoicePaymentOutputSchema>
