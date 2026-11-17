import type { z } from 'zod'

type JsonObject = { [key: string]: unknown }

// Keywords whose values are data, not subschemas, so a `type` key inside them
// must stay as it is.
const DATA_KEYWORDS = new Set(['const', 'default', 'enum', 'examples'])

// Keywords whose values map names to subschemas; the names are not keywords.
const SCHEMA_MAP_KEYWORDS = new Set([
  'properties',
  'patternProperties',
  'dependentSchemas',
  '$defs',
  'definitions',
])

// Keywords whose value is one subschema. A boolean there is written in object
// form, since some clients expect an object; `additionalProperties: false` is
// widely understood and stays as it is.
const BOOLEAN_SUBSCHEMA_KEYWORDS = new Set([
  'items',
  'additionalItems',
  'unevaluatedItems',
  'contains',
  'propertyNames',
  'not',
  'if',
  'then',
  'else',
])

// Keywords that describe the whole node and stay outside the anyOf branches.
const ANNOTATION_KEYWORDS = new Set([
  'title',
  'description',
  'default',
  'examples',
  'deprecated',
  'readOnly',
  'writeOnly',
])

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rewriteValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewriteValue)
  if (isJsonObject(value)) return rewriteTypeArrays(value)
  return value
}

/**
 * Returns a copy of a JSON Schema in which every `type` array, such as
 * `{"type": ["string", "null"]}`, is written as an `anyOf` with one branch per
 * type, and a boolean subschema such as `items: false` is written as an object
 * (`{"not": {}}`). Both forms accept the same values, but several MCP clients
 * and the MCP Inspector expect `type` as a single string and subschemas as
 * objects. zod 4.6 started emitting both shapes; earlier versions did not.
 */
export function rewriteTypeArrays(schema: JsonObject): JsonObject {
  const rewritten: JsonObject = {}
  for (const [key, value] of Object.entries(schema)) {
    if (DATA_KEYWORDS.has(key)) {
      rewritten[key] = value
    } else if (BOOLEAN_SUBSCHEMA_KEYWORDS.has(key) && typeof value === 'boolean') {
      rewritten[key] = value ? {} : { not: {} }
    } else if (SCHEMA_MAP_KEYWORDS.has(key) && isJsonObject(value)) {
      rewritten[key] = Object.fromEntries(
        Object.entries(value).map(([name, subschema]) => [name, rewriteValue(subschema)]),
      )
    } else {
      rewritten[key] = rewriteValue(value)
    }
  }

  const types = rewritten.type
  if (!Array.isArray(types) || !types.every((type) => typeof type === 'string')) {
    return rewritten
  }

  const outer: JsonObject = {}
  const branchKeywords: JsonObject = {}
  for (const [key, value] of Object.entries(rewritten)) {
    if (key === 'type') continue
    if (ANNOTATION_KEYWORDS.has(key)) outer[key] = value
    else branchKeywords[key] = value
  }
  outer.anyOf = types.map((type) => {
    if (type === 'null') return { type: 'null' }
    const branch: JsonObject = { type, ...branchKeywords }
    if (Array.isArray(branch.enum)) branch.enum = branch.enum.filter((value) => value !== null)
    return branch
  })
  return outer
}

/**
 * Wraps a tool schema so the JSON Schema it publishes contains no `type`
 * arrays. Parsing, validation and TypeScript types are those of the original
 * schema: only the Standard JSON Schema output is rewritten.
 */
export function withClientCompatibleJsonSchema<T extends z.ZodType>(schema: T): T {
  const standard = schema['~standard']
  const compatibleStandard = {
    ...standard,
    jsonSchema: {
      input: (options: Parameters<typeof standard.jsonSchema.input>[0]) =>
        rewriteTypeArrays(standard.jsonSchema.input(options)),
      output: (options: Parameters<typeof standard.jsonSchema.output>[0]) =>
        rewriteTypeArrays(standard.jsonSchema.output(options)),
    },
  }
  return new Proxy(schema, {
    get(target, property, receiver) {
      if (property === '~standard') return compatibleStandard
      return Reflect.get(target, property, receiver) as unknown
    },
  })
}
