import { describe, expect, it } from 'vitest'

import { addDecimals, subtractDecimals } from '../../src/domain/decimal.js'

describe('exact decimal addition', () => {
  it('adds decimal strings without losing source precision', () => {
    expect(addDecimals('1000.10', '20.20')).toBe('1020.30')
    expect(addDecimals('100.25', '1.5')).toBe('101.75')
    expect(addDecimals('-5.00', '2.25')).toBe('-2.75')
  })
})

describe('exact decimal subtraction', () => {
  it('subtracts decimal strings without losing source precision', () => {
    expect(subtractDecimals('4397697.9', '3130200')).toBe('1267497.9')
    expect(subtractDecimals('1500000.00', '1250000.00')).toBe('250000.00')
    expect(subtractDecimals('0.5', '0.75')).toBe('-0.25')
  })
})
