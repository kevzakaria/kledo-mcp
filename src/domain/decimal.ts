type DecimalParts = {
  coefficient: bigint
  scale: number
}

function decimalParts(value: string): DecimalParts {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value)
  if (!match) throw new Error('Kledo returned an invalid decimal value')

  const [, sign, whole, fraction = ''] = match
  const coefficient = BigInt(`${sign}${whole}${fraction}`)
  return { coefficient, scale: fraction.length }
}

function align(left: DecimalParts, right: DecimalParts): [bigint, bigint] {
  const scale = Math.max(left.scale, right.scale)
  const leftValue = left.coefficient * 10n ** BigInt(scale - left.scale)
  const rightValue = right.coefficient * 10n ** BigInt(scale - right.scale)
  return [leftValue, rightValue]
}

export function decimalString(value: string | number): string {
  const normalized = typeof value === 'number' ? String(value) : value.trim()
  decimalParts(normalized)
  return normalized
}

export function compareDecimals(left: string, right: string): -1 | 0 | 1 {
  const [leftValue, rightValue] = align(decimalParts(left), decimalParts(right))
  if (leftValue < rightValue) return -1
  if (leftValue > rightValue) return 1
  return 0
}
