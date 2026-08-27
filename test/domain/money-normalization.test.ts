import { describe, expect, it } from 'vitest'

import { normalizeMoney } from '../../src/kledo/entities.js'

describe('money currency metadata', () => {
  it('fills missing currency details from a matching parent currency', () => {
    expect(
      normalizeMoney(
        '12.50',
        { currency_id: 2 },
        { currency: { id: 2, code: 'USD', name: 'US Dollar' } },
      ),
    ).toEqual({
      amount: '12.50',
      currency: 'USD',
      currencyId: '2',
      currencyName: 'US Dollar',
    })
  })

  it('does not borrow a currency code from a mismatched parent currency', () => {
    expect(
      normalizeMoney('12.50', { currency_id: 9 }, { currency: { id: 2, code: 'USD' } }),
    ).toEqual({ amount: '12.50', currency: null, currencyId: '9' })
  })
})
