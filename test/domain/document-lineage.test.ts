import { describe, expect, it } from 'vitest'

import {
  documentLifecycleRank,
  documentTypeForTransactionTypeId,
  kledoDocumentTypes,
  transactionTypeIdByDocumentType,
} from '../../src/domain/document-lineage.js'

describe('Kledo document type registry', () => {
  it('keeps the verified sales and purchase transaction IDs explicit and reversible', () => {
    expect(transactionTypeIdByDocumentType).toEqual({
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
    })

    for (const documentType of kledoDocumentTypes) {
      expect(documentTypeForTransactionTypeId(transactionTypeIdByDocumentType[documentType])).toBe(
        documentType,
      )
    }
    expect(documentTypeForTransactionTypeId('999')).toBeUndefined()
  })

  it('orders lifecycle stages by business sequence rather than numeric type ID', () => {
    const salesCycle = [
      'sales_quote',
      'sales_order',
      'sales_delivery',
      'sales_invoice',
      'invoice_payment',
    ] as const
    const purchaseCycle = [
      'purchase_quote',
      'purchase_order',
      'purchase_delivery',
      'purchase_invoice',
      'purchase_payment',
    ] as const

    for (const cycle of [salesCycle, purchaseCycle]) {
      expect(cycle.map(documentLifecycleRank)).toEqual(
        [...cycle].map(documentLifecycleRank).sort((left, right) => left - right),
      )
    }
  })
})
