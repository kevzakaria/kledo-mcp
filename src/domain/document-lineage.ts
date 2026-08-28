export const kledoDocumentTypes = [
  'sales_quote',
  'sales_order',
  'sales_delivery',
  'sales_invoice',
  'invoice_payment',
  'purchase_quote',
  'purchase_order',
  'purchase_delivery',
  'purchase_invoice',
  'purchase_payment',
] as const

export type KledoDocumentType = (typeof kledoDocumentTypes)[number]

export const kledoCommercialDocumentTypes = [
  'sales_quote',
  'sales_order',
  'sales_delivery',
  'sales_invoice',
  'purchase_quote',
  'purchase_order',
  'purchase_delivery',
  'purchase_invoice',
] as const

export type KledoCommercialDocumentType = (typeof kledoCommercialDocumentTypes)[number]

const kledoCommercialDocumentTypeSet = new Set<string>(kledoCommercialDocumentTypes)

export function isKledoCommercialDocumentType(
  value: string,
): value is KledoCommercialDocumentType {
  return kledoCommercialDocumentTypeSet.has(value)
}

export const transactionTypeIdByDocumentType = {
  sales_quote: '4',
  sales_order: '6',
  sales_delivery: '7',
  sales_invoice: '5',
  invoice_payment: '17',
  purchase_quote: '63',
  purchase_order: '2',
  purchase_delivery: '8',
  purchase_invoice: '3',
  purchase_payment: '16',
} as const satisfies Record<KledoDocumentType, string>

const documentTypeByTransactionTypeId = new Map<string, KledoDocumentType>(
  Object.entries(transactionTypeIdByDocumentType).map(([documentType, transactionTypeId]) => [
    transactionTypeId,
    documentType as KledoDocumentType,
  ]),
)

export function documentTypeForTransactionTypeId(
  transactionTypeId: string,
): KledoDocumentType | undefined {
  return documentTypeByTransactionTypeId.get(transactionTypeId)
}

const lifecycleRankByDocumentType = new Map<KledoDocumentType, number>(
  kledoDocumentTypes.map((documentType, index) => [documentType, index]),
)

export function documentLifecycleRank(documentType: KledoDocumentType): number {
  return lifecycleRankByDocumentType.get(documentType) ?? Number.MAX_SAFE_INTEGER
}
