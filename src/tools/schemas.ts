import { z } from 'zod'

import { kledoDocumentTypes } from '../domain/document-lineage.js'
import type { JsonValue } from '../domain/json.js'

export const kledoEntitySchema = z.enum([
  'sales_invoice',
  'purchase_invoice',
  'sales_order',
  'purchase_order',
  'sales_delivery',
  'purchase_delivery',
  'sales_quote',
  'purchase_quote',
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
  'receivable_by_invoice',
  'aged_payable',
  'bank_summary',
  'sales_by_period',
  'sales_by_person',
  'sales_order_kpi',
  'purchases_by_period',
  'sales_by_product',
  'income_by_customer',
  'dormant_customers',
  'item_price_analysis',
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
  'in is allowed only for productId on its supported transaction entities, product.categoryId, bank_transaction.transactionType, sales_order.statusId (status_id for eq; status_ids for in), and warehouseId on purchase_invoice, sales_order, purchase_order, purchase_delivery, sales_quote, or purchase_quote.',
  'sales_invoice=contactId,statusId,productId,transactionDate,dueDate,shippingDate,paymentDate,amount;',
  'purchase_invoice=contactId,statusId,productId,warehouseId,transactionDate,dueDate,shippingDate,paymentDate,amount;',
  'sales_order=contactId,statusId,productId,warehouseId,salesPersonId,transactionDate,dueDate,shippingDate,paymentDate,amount;',
  'purchase_order=contactId,statusId,productId,warehouseId,transactionDate,dueDate,paymentDate,amount;',
  'sales_delivery=contactId,statusId,productId,warehouseId,salesPersonId,transactionDate,shippingDate,amount;',
  'purchase_delivery=contactId,statusId,productId,warehouseId,transactionDate;',
  'sales_quote=contactId,statusId,productId,warehouseId,salesPersonId,transactionDate,shippingDate,amount;',
  'purchase_quote=contactId,statusId,productId,warehouseId,transactionDate,dueDate,amount;',
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
  'sales_order,purchase_order,sales_delivery,purchase_delivery,sales_quote,purchase_quote=transactionDate,statusId,dueDate,total,memo,reference;',
  'bank_transaction=transactionDate,memo,statusId;',
  'expense=transactionDate,statusId,remaining,total,reference;',
  'contact=name,company,payable,receivable;',
  'product=name,code,category,basePrice,salePrice;',
  'account=name,code,category;',
  'warehouse=none; unit=none.',
].join(' ')

const KLEDO_QUERY_PROJECTION_COMPATIBILITY = [
  'Projection compatibility:',
  'sales_invoice,purchase_invoice,sales_order,purchase_order,sales_delivery,purchase_delivery,sales_quote,purchase_quote,bank_transaction,expense=reference,transactionDate,dueDate,shippingDate,party,memo,statusId,total,remaining,paymentState,unbilled,sourceUpdatedAt,bankAccount,transactionType;',
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
      .array(
        z.enum([
          'line_items',
          'relation_ids',
          'invoice_payments',
          'document_lineage',
          'payment_events',
          'print_document',
        ]),
      )
      .max(6)
      .optional(),
    lineItemLimit: z.number().int().min(1).max(200).default(50),
    invoicePaymentLimit: z.number().int().min(1).max(200).default(50),
    lineageLimit: z.number().int().min(1).max(200).default(50),
    paymentEventLimit: z.number().int().min(1).max(200).default(50),
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
const receivableCustomerPageSizeSchema = z.number().int().min(1).max(20).default(10)

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
      report: z
        .literal('receivable_by_invoice')
        .describe(
          'Customer receivable totals with the complete invoice drill-down for each returned customer. API memo is exposed as projectReference because Kledo displays it as Reference in the Web UI.',
        ),
      asOf: isoDateSchema,
      pageSize: receivableCustomerPageSizeSchema,
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
      report: z
        .literal('sales_by_person')
        .describe(
          'Sales grouped by salesperson. Do not use income_by_customer or invoice crawling for salesperson totals.',
        ),
      period: periodSchema,
      dateBasis: z
        .enum(['trans_date', 'shipping_date'])
        .default('trans_date')
        .describe('Defaults to transaction date. Use shipping_date only when explicitly requested.'),
      salesPersonId: idSchema.optional(),
      salesPersonName: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .describe('Exact salesperson name, matched case-insensitively through Kledo users.')
        .optional(),
      pageSize: pageSizeSchema,
      cursor: cursorSchema.optional(),
    })
    .strict()
    .refine(({ salesPersonId, salesPersonName }) => !(salesPersonId && salesPersonName), {
      message: 'salesPersonId and salesPersonName are mutually exclusive',
    }),
  z
    .object({
      report: z
        .literal('sales_order_kpi')
        .describe(
          'Complete Sales Order intake KPI for a bounded transaction-date period. Booked order value is not revenue, invoice value, or collected cash.',
        ),
      period: periodSchema,
      salesPersonId: idSchema.optional(),
      salesPersonName: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .describe('Exact salesperson name, matched case-insensitively through Kledo users.')
        .optional(),
    })
    .strict()
    .refine(({ salesPersonId, salesPersonName }) => !(salesPersonId && salesPersonName), {
      message: 'salesPersonId and salesPersonName are mutually exclusive',
    }),
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
  z
    .object({
      report: z
        .literal('dormant_customers')
        .describe(
          'Customers with bounded historical income activity and no income activity during the configured inactivity window. This is a follow-up candidate signal, not proof of churn.',
        ),
      asOf: isoDateSchema,
      inactiveDays: z.number().int().min(1).max(3650).default(90),
      historyDays: z.number().int().min(1).max(3650).default(365),
      pageSize: pageSizeSchema,
      cursor: cursorSchema.optional(),
    })
    .strict(),
  z
    .object({
      report: z
        .literal('item_price_analysis')
        .describe(
          'Resolve one product safely, then report distinct catalog, latest transaction-price, and period-profitability facts.',
        ),
      productCode: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .describe('Exact product code or SKU, matched case-insensitively.')
        .optional(),
      productName: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .describe(
          'Product name search. Multiple matches fail as AMBIGUOUS and require productCode.',
        )
        .optional(),
      period: periodSchema,
      profitabilityMethod: z
        .enum(['inventory', 'non_inventory', 'package'])
        .default('inventory'),
    })
    .strict()
    .refine(({ productCode, productName }) => Number(Boolean(productCode)) + Number(Boolean(productName)) === 1, {
      message: 'Exactly one of productCode or productName is required',
    }),
])

// MCP Inspector renders top-level object properties, but currently leaves a
// top-level oneOf without editable controls. Keep the discriminated union as
// the authoritative validator and expose this equivalent flat input shape to
// MCP clients so the visual debugger remains usable.
export const kledoReportToolInputSchema = z
  .object({
    report: kledoReportNameSchema,
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    asOf: isoDateSchema.optional(),
    comparison: z
      .object({
        interval: z.enum(['monthly', 'quarterly', 'yearly']),
        periods: z.number().int().min(1).max(11),
      })
      .strict()
      .optional(),
    period: periodSchema.optional(),
    comparePeriod: periodSchema.optional(),
    method: z.enum(['direct', 'indirect']).optional(),
    warehouseIds: idsSchema.optional(),
    salesPersonIds: oneIdSchema.optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
    cursor: cursorSchema.optional(),
    interval: z.enum(['day', 'month', 'year']).optional(),
    unitId: idSchema.optional(),
    contactIds: idsSchema.optional(),
    dateBasis: z
      .enum(['trans_date', 'shipping_date'])
      .describe('Defaults to transaction date. Use shipping_date only when explicitly requested.')
      .optional(),
    salesPersonId: idSchema.optional(),
    salesPersonName: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe('Exact salesperson name, matched case-insensitively through Kledo users.')
      .optional(),
    productIds: idsSchema.optional(),
    groupIds: idsSchema.optional(),
    limit: z.number().int().min(1).max(100).optional(),
    inactiveDays: z
      .number()
      .int()
      .min(1)
      .max(3650)
      .describe('Consecutive calendar days through asOf in which no income activity may appear.')
      .optional(),
    historyDays: z
      .number()
      .int()
      .min(1)
      .max(3650)
      .describe('Calendar days before the inactivity cutoff used to establish prior activity.')
      .optional(),
    productCode: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe('Exact product code or SKU, matched case-insensitively.')
      .optional(),
    productName: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe('Product name search. Multiple matches fail as AMBIGUOUS and require productCode.')
      .optional(),
    profitabilityMethod: z.enum(['inventory', 'non_inventory', 'package']).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const result = kledoReportInputSchema.safeParse(input)
    if (result.success) return

    for (const issue of result.error.issues) {
      context.addIssue({
        code: 'custom',
        message: issue.message,
        path: issue.path,
      })
    }
  })
  .transform((input) => kledoReportInputSchema.parse(input))

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

const salespersonIdentityOutputSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).optional(),
  })
  .strict()

const dormantCustomerIdentityOutputSchema = z
  .object({
    id: idSchema,
    displayName: z.string().trim().min(1),
    companyName: z.string().trim().min(1).nullable(),
    personName: z.string().trim().min(1).nullable(),
  })
  .strict()

const receivableOverdueOutputSchema = z
  .object({
    lessThanOneMonth: normalizedMoneyOutputSchema,
    oneToTwoMonths: normalizedMoneyOutputSchema,
    twoToThreeMonths: normalizedMoneyOutputSchema,
    threeToFourMonths: normalizedMoneyOutputSchema,
    moreThanFourMonths: normalizedMoneyOutputSchema,
  })
  .strict()

const receivableTotalsOutputSchema = z
  .object({
    invoiceAmount: normalizedMoneyOutputSchema,
    outstanding: normalizedMoneyOutputSchema,
    notYetDue: normalizedMoneyOutputSchema,
    overdue: receivableOverdueOutputSchema,
  })
  .strict()

const salesByPersonReportOutputSchema = z
  .object({
    report: z.literal('sales_by_person'),
    parameters: z
      .object({
        period: periodSchema,
        dateBasis: z.enum(['trans_date', 'shipping_date']),
        salesperson: salespersonIdentityOutputSchema.optional(),
        pageSize: z.number().int().min(1).max(100),
      })
      .strict(),
    data: z
      .object({
        rows: z.array(
          z
            .object({
              salesperson: salespersonIdentityOutputSchema.required({ name: true }),
              sales: normalizedMoneyOutputSchema,
              salesCount: z
                .number()
                .int()
                .nonnegative()
                .describe(
                  "Kledo's total_count for this salesperson; a sales-transaction count, not product quantity.",
                ),
              commission: normalizedMoneyOutputSchema.describe(
                "Kledo's reported total sales commission for this salesperson and period.",
              ),
            })
            .strict(),
        ),
      })
      .strict(),
    pageInfo: pageInfoSchema,
    meta: resultMetaSchema.extend({ source: z.literal('kledo_native_report') }),
  })
  .strict()

const salesOrderKpiReportOutputSchema = z
  .object({
    report: z.literal('sales_order_kpi'),
    parameters: z
      .object({
        period: periodSchema,
        dateBasis: z.literal('trans_date'),
        salesperson: salespersonIdentityOutputSchema.optional(),
        statusPolicy: z
          .object({
            name: z.literal('booked'),
            includedStatusIds: z.tuple([z.literal('5'), z.literal('6'), z.literal('7')]),
          })
          .strict(),
      })
      .strict(),
    data: z
      .object({
        orderCount: z.number().int().nonnegative(),
        orderedQuantity: z.string().regex(/^-?\d+(?:\.\d+)?$/),
        netBookedOrderValue: normalizedMoneyOutputSchema,
        grossBookedOrderValue: normalizedMoneyOutputSchema,
        openOrderBacklog: normalizedMoneyOutputSchema,
      })
      .strict(),
    provenance: z
      .object({
        orders: z.literal('/finance/orders'),
        transactionType: z
          .object({ id: z.literal('6'), label: z.literal('Sales Order') })
          .strict(),
        aggregateFields: z
          .object({
            orderedQuantity: z.literal('grand_subtotal.qty'),
            netBookedOrderValue: z.literal('grand_subtotal.amount'),
            grossBookedOrderValue: z.literal('grand_subtotal.amount_after_tax'),
            openOrderBacklog: z.literal('grand_subtotal.unbilled_amount'),
          })
          .strict(),
        aggregateScope: z.literal('sum_of_all_page_grand_subtotals'),
      })
      .strict(),
    meta: resultMetaSchema.extend({ source: z.literal('kledo_semantic_adapter') }),
  })
  .strict()

const dormantCustomersReportOutputSchema = z
  .object({
    report: z.literal('dormant_customers'),
    parameters: z
      .object({
        asOf: isoDateSchema,
        inactiveDays: z.number().int().min(1).max(3650),
        historyDays: z.number().int().min(1).max(3650),
        inactivityCutoff: isoDateSchema,
        historicalPeriod: periodSchema,
        recentPeriod: periodSchema,
        pageSize: z.number().int().min(1).max(100),
      })
      .strict(),
    data: z
      .object({
        candidates: z.array(
          z
            .object({
              customer: dormantCustomerIdentityOutputSchema,
              historicalIncome: normalizedMoneyOutputSchema,
              historicalTransactionCount: z.number().int().positive(),
            })
            .strict(),
        ),
      })
      .strict(),
    pageInfo: pageInfoSchema,
    meta: resultMetaSchema.extend({ source: z.literal('kledo_native_report') }),
  })
  .strict()

const itemPriceAnalysisReportOutputSchema = z
  .object({
    report: z.literal('item_price_analysis'),
    parameters: z
      .object({
        productSelector: z
          .union([
            z.object({ code: z.string().trim().min(1) }).strict(),
            z.object({ name: z.string().trim().min(1) }).strict(),
          ]),
        period: periodSchema,
        profitabilityMethod: z.enum(['inventory', 'non_inventory', 'package']),
      })
      .strict(),
    data: z
      .object({
        product: z
          .object({
            id: idSchema,
            code: z.string().trim().min(1).nullable(),
            name: z.string().trim().min(1),
            unit: z
              .object({ id: idSchema, name: z.string().trim().min(1) })
              .strict()
              .nullable(),
            canSell: z.boolean().nullable(),
            canPurchase: z.boolean().nullable(),
            tracked: z.boolean().nullable(),
          })
          .strict(),
        catalogPrices: z
          .object({
            salePrice: normalizedMoneyOutputSchema.nullable(),
            basePurchasePrice: normalizedMoneyOutputSchema.nullable(),
            averageInventoryCost: normalizedMoneyOutputSchema.nullable(),
          })
          .strict(),
        latestTransactionPrices: z
          .object({
            soldUnitPrice: normalizedMoneyOutputSchema.nullable(),
            soldTransactionDate: isoDateSchema.nullable(),
            purchasedUnitPrice: normalizedMoneyOutputSchema.nullable(),
            purchaseTransactionDate: isoDateSchema.nullable(),
          })
          .strict(),
        profitability: z
          .object({
            soldQuantity: z.string().regex(/^-?\d+(?:\.\d+)?$/),
            totalSales: normalizedMoneyOutputSchema,
            totalCostOfGoodsSold: normalizedMoneyOutputSchema,
            grossProfit: normalizedMoneyOutputSchema,
            grossMarginPercent: z.string().regex(/^-?\d+(?:\.\d+)?$/),
            averageSoldUnitPrice: normalizedMoneyOutputSchema,
            averageCostOfGoodsSoldPerUnit: normalizedMoneyOutputSchema,
          })
          .strict(),
      })
      .strict(),
    provenance: z
      .object({
        productResolution: z.literal('/finance/products'),
        catalogPrices: z.literal('/finance/products/:id'),
        latestSoldUnitPrice: z.literal('/finance/products/last_prices'),
        latestPurchasedUnitPrice: z.literal('/finance/products/last_buy_prices'),
        latestPurchaseTransaction: z.literal('/finance/products/:id/transactions'),
        profitability: z.literal('/finance/products/:id/profitability'),
      })
      .strict(),
    meta: resultMetaSchema.extend({ source: z.literal('kledo_semantic_adapter') }),
  })
  .strict()

const receivableByInvoiceReportOutputSchema = z
  .object({
    report: z.literal('receivable_by_invoice'),
    parameters: z
      .object({
        asOf: isoDateSchema,
        periodType: z.literal('monthly'),
        pageSize: z.number().int().min(1).max(20),
      })
      .strict(),
    data: z
      .object({
        customers: z.array(
          z
            .object({
              customer: dormantCustomerIdentityOutputSchema,
              totals: receivableTotalsOutputSchema,
              invoices: z.array(
                z
                  .object({
                    id: idSchema,
                    invoiceNumber: z.string().trim().min(1),
                    transactionDate: isoDateSchema,
                    dueDate: isoDateSchema.nullable(),
                    projectReference: z.string().nullable(),
                    invoiceAmount: normalizedMoneyOutputSchema,
                    outstanding: normalizedMoneyOutputSchema,
                    notYetDue: normalizedMoneyOutputSchema,
                    transactionAgeDays: z.number().int(),
                    dueAgeDays: z.number().int(),
                  })
                  .strict(),
              ),
            })
            .strict(),
        ),
      })
      .strict(),
    pageInfo: pageInfoSchema,
    provenance: z
      .object({
        customerTotals: z.literal('/reportings/agedReceivable'),
        invoiceBreakdown: z.literal('/reportings/agedReceivableDetail/:contactId'),
        projectReference: z
          .object({
            apiField: z.literal('memo'),
            webUiField: z.literal('Reference'),
          })
          .strict(),
      })
      .strict(),
    meta: resultMetaSchema.extend({ source: z.literal('kledo_semantic_adapter') }),
  })
  .strict()

export const kledoDocumentTypeSchema = z.enum(kledoDocumentTypes)

const lineageDocumentOutputSchema = z
  .object({
    documentType: kledoDocumentTypeSchema,
    transactionTypeId: idSchema,
    id: idSchema,
    number: z.string().trim().min(1),
  })
  .strict()

export const documentLineageOutputSchema = z
  .object({
    anchor: lineageDocumentOutputSchema,
    immediateParent: lineageDocumentOutputSchema.nullable(),
    predecessors: z.array(lineageDocumentOutputSchema),
    complete: z.boolean(),
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
        'Date of this direct Kledo invoice-payment event; not the invoice final settlement or paid date.',
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

const paymentEventBaseOutputSchema = invoicePaymentOutputSchema.extend({
  transactionDate: z
    .string()
    .date()
    .describe(
      'Date of this direct Kledo sales or purchase payment event; not proof of final settlement or paid date.',
    ),
  relation: z.literal('payment_for'),
  number: z.string().trim().min(1),
})

export const paymentEventOutputSchema = z.discriminatedUnion('documentType', [
  paymentEventBaseOutputSchema.extend({
    documentType: z.literal('invoice_payment'),
    transactionTypeId: z.literal('17'),
  }),
  paymentEventBaseOutputSchema.extend({
    documentType: z.literal('purchase_payment'),
    transactionTypeId: z.literal('16'),
  }),
])

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
    documentLineage: documentLineageOutputSchema.optional(),
    paymentEvents: z
      .array(paymentEventOutputSchema)
      .describe(
        'Typed sales or purchase invoice payment events joined from document relations and compact transaction rows; not proof of final settlement.',
      )
      .optional(),
    printDocument: z
      .object({
        resourceUri: z.string().regex(/^kledo:\/\/sales-invoice\/[1-9]\d{0,19}\/print-document\.pdf$/),
        mimeType: z.literal('application/pdf'),
        byteCount: z.number().int().positive().max(6 * 1024 * 1024),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .describe(
        'Metadata for the bounded Sales Invoice PDF returned once as an embedded MCP resource.',
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
        documentLineage: z.boolean().optional(),
        omittedLineageDocumentCount: z.number().int().nonnegative().optional(),
        paymentEvents: z.boolean().optional(),
        omittedPaymentEventCount: z.number().int().nonnegative().optional(),
      })
      .strict(),
    meta: resultMetaSchema.omit({ complete: true }),
  })
  .strict()

const otherKledoReportOutputSchema = z
  .object({
    report: kledoReportNameSchema.exclude([
      'sales_by_person',
      'sales_order_kpi',
      'dormant_customers',
      'item_price_analysis',
      'receivable_by_invoice',
    ]),
    parameters: z.record(z.string(), jsonValueSchema),
    data: jsonValueSchema,
    pageInfo: pageInfoSchema.optional(),
    meta: resultMetaSchema.extend({ source: z.literal('kledo_native_report') }),
  })
  .strict()

export const kledoReportOutputSchema = z.discriminatedUnion('report', [
  salesByPersonReportOutputSchema,
  salesOrderKpiReportOutputSchema,
  dormantCustomersReportOutputSchema,
  itemPriceAnalysisReportOutputSchema,
  receivableByInvoiceReportOutputSchema,
  otherKledoReportOutputSchema,
])

export type KledoQueryInput = z.infer<typeof kledoQueryInputSchema>
export type KledoEntity = z.infer<typeof kledoEntitySchema>
export type KledoGetInput = z.infer<typeof kledoGetInputSchema>
export type KledoReportInput = z.infer<typeof kledoReportInputSchema>
export type KledoQueryOutput = z.infer<typeof kledoQueryOutputSchema>
export type KledoGetOutput = z.infer<typeof kledoGetOutputSchema>
export type KledoReportOutput = z.infer<typeof kledoReportOutputSchema>
export type KledoInvoicePayment = z.infer<typeof invoicePaymentOutputSchema>
export type KledoPaymentEvent = z.infer<typeof paymentEventOutputSchema>
