import { createHmac, timingSafeEqual } from 'node:crypto'

import { z } from 'zod'

import { compareDecimals, decimalString } from '../domain/decimal.js'
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
import type { KledoGateway } from './gateway.js'
import {
  applyQueryOptions,
  projectFields,
  projectQueryItem,
  validateFields,
} from './query-options.js'
import type {
  KledoGetInput,
  KledoGetOutput,
  KledoInvoicePayment,
  KledoQueryInput,
  KledoQueryOutput,
  KledoReportInput,
  KledoReportOutput,
} from '../tools/schemas.js'
import { invoicePaymentOutputSchema, jsonValueSchema } from '../tools/schemas.js'

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

const rawSalesInvoiceDetailSchema = rawSalesInvoiceSchema.extend({
  items: z.array(rawSalesInvoiceLineItemSchema).default([]),
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
  identityCatalogPath?: string
  diagnostic?: (event: KledoGatewayDiagnosticEvent) => void
  maxConcurrency?: number
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
    | 'identity.sqlite.write'
    | 'identity.sqlite.write_failed'
    | 'identity.upstream.refresh'
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

function normalizedInvoicePayments(
  invoiceId: string,
  rawTransactions: unknown[],
): KledoInvoicePayment[] {
  const paymentsById = new Map<string, KledoInvoicePayment>()

  for (const rawTransaction of rawTransactions) {
    const discriminator = rawInvoiceTransactionDiscriminatorSchema.parse(rawTransaction)
    if (String(discriminator.trans_type_id) !== '17') continue
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
  const maxConcurrency = options.maxConcurrency ?? 4
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
  type CachedIdentity = { id: string; name: string; active: boolean }
  type CachedContact = CachedIdentity & { typeIds: readonly string[] }


  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new Error('maxAttempts must be an integer between 1 and 5')
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new Error('maxResponseBytes must be a positive safe integer')
  }
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 64) {
    throw new Error('maxConcurrency must be an integer between 1 and 64')
  }

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

  const request = async (url: URL, signal?: AbortSignal): Promise<Response> => {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (signal?.aborted) cancelled()
      let response: Response
      const timeoutSignal = AbortSignal.timeout(timeoutMs)
      try {
        response = await fetch(url, {
          headers: {
            accept: 'application/json',
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

  const fetchSalespersons = async (signal?: AbortSignal): Promise<readonly CachedIdentity[]> => {
    emitDiagnostic('identity.upstream.refresh')
    const body = await requestJson(new URL('users', baseUrl), signal)
    const envelope = rawUsersEnvelopeSchema.parse(body)
    const rows = Array.isArray(envelope.data) ? envelope.data : envelope.data.data
    if (rows.length > 10_000) {
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

  return {
    async warmIdentityCatalog(signal?: AbortSignal): Promise<KledoIdentityWarmupResult> {
      if (!identityCatalog) {
        throw new KledoError(
          'UNSUPPORTED_OPERATION',
          'Persistent identity warm-up requires KLEDO_IDENTITY_CACHE=sqlite',
        )
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

    async get(input: KledoGetInput, signal?: AbortSignal): Promise<KledoGetOutput> {
      validateFields(input.entity, input.fields)

      if (input.entity !== 'sales_invoice') {
        const includes = new Set(input.include ?? [])
        if (includes.has('invoice_payments')) {
          invalid(`${input.entity} does not support invoice_payments`)
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

      const includes = new Set(input.include ?? [])
      const url = new URL(`finance/invoices/${input.id}`, baseUrl)

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
      const relations = invoice.parent_tran
        ? [
            {
              relation: 'derived_from',
              entity: 'sales_order' as const,
              id: String(invoice.parent_tran.id),
            },
          ]
        : []
      let invoicePayments: KledoInvoicePayment[] = []
      let omittedInvoicePaymentCount = 0
      if (includes.has('invoice_payments')) {
        const paymentsUrl = new URL(`finance/invoices/${input.id}/transactions`, baseUrl)
        const paymentsBody = await requestJson(paymentsUrl, signal)
        const paymentsEnvelope = rawInvoicePaymentsEnvelopeSchema.parse(paymentsBody)
        const allInvoicePayments = normalizedInvoicePayments(input.id, paymentsEnvelope.data)
        invoicePayments = allInvoicePayments.slice(0, input.invoicePaymentLimit)
        omittedInvoicePaymentCount = allInvoicePayments.length - invoicePayments.length
      }

      return {
        entity: input.entity,
        record: projectFields(input.entity, input.fields, normalizedSalesInvoice(invoice)),
        ...(includes.has('line_items') ? { lineItems } : {}),
        ...(includes.has('relation_ids') ? { relations } : {}),
        ...(includes.has('invoice_payments') ? { invoicePayments } : {}),
        truncation: {
          lineItems: includes.has('line_items') && omittedCount > 0,
          ...(includes.has('line_items') && omittedCount > 0 ? { omittedCount } : {}),
          ...(includes.has('invoice_payments')
            ? { invoicePayments: omittedInvoicePaymentCount > 0 }
            : {}),
          ...(omittedInvoicePaymentCount > 0 ? { omittedInvoicePaymentCount } : {}),
        },
        meta: {
          fetchedAt: now().toISOString(),
          ...(options.tenant ? { tenant: options.tenant } : {}),
          warnings: [],
        },
      }
    },

    async report(input: KledoReportInput, signal?: AbortSignal): Promise<KledoReportOutput> {
      let path: string
      const wireParameters = new URLSearchParams()
      const parameters: Record<string, JsonValue> = {}
      let requestedPage: number | undefined
      let requestedPageSize: number | undefined

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
        default:
          throw new KledoError('UNSUPPORTED_OPERATION', 'Unsupported Kledo report')
      }

      const url = new URL(path, baseUrl)
      url.search = wireParameters.toString()

      const body = await requestJson(url, signal)
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
