import { describe, expect, it } from 'vitest'

import { addDecimals } from '../../src/domain/decimal.js'

describe('exact decimal addition', () => {
  it('adds decimal strings without losing source precision', () => {
    expect(addDecimals('1000.10', '20.20')).toBe('1020.30')
    expect(addDecimals('100.25', '1.5')).toBe('101.75')
    expect(addDecimals('-5.00', '2.25')).toBe('-2.75')
  })
})
