import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  rewriteTypeArrays,
  withClientCompatibleJsonSchema,
} from '../../src/tools/json-schema-compat.js'

describe('rewriteTypeArrays', () => {
  it('splits a type array into anyOf branches and keeps annotations outside', () => {
    expect(
      rewriteTypeArrays({
        description: 'A code',
        type: ['string', 'null'],
        minLength: 1,
        enum: ['A', 'B', null],
      }),
    ).toEqual({
      description: 'A code',
      anyOf: [{ type: 'string', minLength: 1, enum: ['A', 'B'] }, { type: 'null' }],
    })
  })

  it('reaches nested subschemas but leaves property names and data values alone', () => {
    expect(
      rewriteTypeArrays({
        type: 'object',
        properties: {
          type: { type: ['boolean', 'null'] },
          default: { type: 'string' },
          list: { type: 'array', items: { type: ['string', 'null'] } },
        },
        default: { type: ['kept', 'as data'] },
      }),
    ).toEqual({
      type: 'object',
      properties: {
        type: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
        default: { type: 'string' },
        list: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
      },
      default: { type: ['kept', 'as data'] },
    })
  })

  it('writes boolean subschemas as objects but keeps additionalProperties false', () => {
    expect(
      rewriteTypeArrays({
        type: 'array',
        prefixItems: [{ const: '5' }],
        items: false,
        contains: true,
        additionalProperties: false,
      }),
    ).toEqual({
      type: 'array',
      prefixItems: [{ const: '5' }],
      items: { not: {} },
      contains: {},
      additionalProperties: false,
    })
  })
})

describe('withClientCompatibleJsonSchema', () => {
  const schema = z.object({ note: z.string().nullable(), count: z.number().int() })
  const wrapped = withClientCompatibleJsonSchema(schema)

  it('publishes nullable fields as anyOf', () => {
    expect(wrapped['~standard'].jsonSchema.input({ target: 'draft-2020-12' })).toMatchObject({
      properties: { note: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
    })
  })

  it('validates exactly like the original schema', async () => {
    expect(wrapped.parse({ note: null, count: 2 })).toEqual({ note: null, count: 2 })
    expect(wrapped.safeParse({ note: 1, count: 2 }).success).toBe(false)
    const valid = await wrapped['~standard'].validate({ note: 'x', count: 1 })
    expect(valid).toEqual({ value: { note: 'x', count: 1 } })
    const invalid = await wrapped['~standard'].validate({ note: 'x', count: 1.5 })
    expect('issues' in invalid && invalid.issues?.length).toBeTruthy()
  })
})
