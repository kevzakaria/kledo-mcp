import { chmodSync, mkdirSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'

export const identityEntityTypes = [
  'salesperson',
  'contact',
  'customer',
  'vendor',
  'employee',
  'investor',
  'other_contact',
  'contact_type',
  'contact_group',
  'product',
  'product_category',
  'warehouse',
  'unit',
  'account',
] as const

export type IdentityEntityType = (typeof identityEntityTypes)[number]

export interface CatalogIdentity {
  externalId: string
  displayName: string
  normalizedName: string
  active: boolean
  sourceUpdatedAt?: string
}

export interface CatalogSnapshot {
  entityType: IdentityEntityType
  identities: readonly CatalogIdentity[]
}

export interface TenantIdentityCatalog {
  findFreshExact(
    entityType: IdentityEntityType,
    normalizedName: string,
    freshAfterMs: number,
  ): Promise<readonly CatalogIdentity[] | null>
  replaceSnapshots(
    snapshots: readonly CatalogSnapshot[],
    fetchedAt: Date,
  ): Promise<void>
}

interface SqliteTenantIdentityCatalogOptions {
  path: string
  tenantKey: string
}

interface SnapshotRow {
  refreshed_at: string
}

interface IdentityRow {
  external_id: string
  display_name: string
  normalized_name: string
  active: number
  source_updated_at: string | null
}

export function createSqliteTenantIdentityCatalog(
  options: SqliteTenantIdentityCatalogOptions,
): TenantIdentityCatalog {
  if (!isAbsolute(options.path)) {
    throw new Error('identityCatalogPath must be absolute')
  }
  if (!options.tenantKey) {
    throw new Error('identity catalog tenant key is required')
  }

  const withDatabase = async <Result>(
    operation: (database: import('node:sqlite').DatabaseSync) => Result,
  ): Promise<Result> => {
    const directory = dirname(options.path)
    mkdirSync(directory, { recursive: true, mode: 0o700 })

    const { DatabaseSync } = await import('node:sqlite')
    const database = new DatabaseSync(options.path)
    try {
      database.exec('PRAGMA busy_timeout = 1000')
      database.exec(`
        CREATE TABLE IF NOT EXISTS identity_snapshots (
          tenant_key TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          refreshed_at TEXT NOT NULL,
          PRIMARY KEY (tenant_key, entity_type)
        ) STRICT;

        CREATE TABLE IF NOT EXISTS identity_records (
          tenant_key TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          external_id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          normalized_name TEXT NOT NULL,
          active INTEGER NOT NULL CHECK (active IN (0, 1)),
          fetched_at TEXT NOT NULL,
          source_updated_at TEXT,
          PRIMARY KEY (tenant_key, entity_type, external_id)
        ) STRICT;

        CREATE INDEX IF NOT EXISTS identity_records_exact_name
          ON identity_records (tenant_key, entity_type, normalized_name, active);
      `)
      chmodSync(options.path, 0o600)
      return operation(database)
    } finally {
      database.close()
    }
  }

  return {
    async findFreshExact(entityType, normalizedName, freshAfterMs) {
      return withDatabase((database) => {
        const snapshot = database
          .prepare(
            `SELECT refreshed_at
             FROM identity_snapshots
             WHERE tenant_key = ? AND entity_type = ?`,
          )
          .get(options.tenantKey, entityType) as SnapshotRow | undefined

        const refreshedAtMs = snapshot ? Date.parse(snapshot.refreshed_at) : Number.NaN
        if (!Number.isFinite(refreshedAtMs) || refreshedAtMs < freshAfterMs) return null

        const rows = database
          .prepare(
            `SELECT external_id, display_name, normalized_name, active, source_updated_at
             FROM identity_records
             WHERE tenant_key = ?
               AND entity_type = ?
               AND normalized_name = ?
               AND active = 1
             ORDER BY external_id`,
          )
          .all(options.tenantKey, entityType, normalizedName) as unknown as IdentityRow[]

        return rows.map((row) => {
          const normalizedDisplayName = row.display_name.trim().toLocaleLowerCase('en-US')
          const sourceUpdatedAtMs =
            row.source_updated_at === null ? null : Date.parse(row.source_updated_at)
          if (
            !/^[1-9]\d{0,19}$/.test(row.external_id) ||
            row.display_name.trim().length === 0 ||
            row.normalized_name !== normalizedName ||
            normalizedDisplayName !== normalizedName ||
            row.active !== 1 ||
            (sourceUpdatedAtMs !== null && !Number.isFinite(sourceUpdatedAtMs))
          ) {
            throw new Error('Local identity catalog contains an invalid record')
          }

          return {
            externalId: row.external_id,
            displayName: row.display_name,
            normalizedName: row.normalized_name,
            active: true,
            ...(row.source_updated_at === null ? {} : { sourceUpdatedAt: row.source_updated_at }),
          }
        })
      })
    },

    async replaceSnapshots(snapshots, fetchedAt) {
      if (new Set(snapshots.map((snapshot) => snapshot.entityType)).size !== snapshots.length) {
        throw new Error('identity catalog snapshots must have unique entity types')
      }
      await withDatabase((database) => {
        const fetchedAtValue = fetchedAt.toISOString()
        database.exec('BEGIN IMMEDIATE')
        try {
          const deleteRecords = database.prepare(
            'DELETE FROM identity_records WHERE tenant_key = ? AND entity_type = ?',
          )
          const insert = database.prepare(
            `INSERT INTO identity_records (
               tenant_key,
               entity_type,
               external_id,
               display_name,
               normalized_name,
               active,
               fetched_at,
               source_updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          const upsertSnapshot = database.prepare(
            `INSERT INTO identity_snapshots (tenant_key, entity_type, refreshed_at)
               VALUES (?, ?, ?)
               ON CONFLICT (tenant_key, entity_type)
               DO UPDATE SET refreshed_at = excluded.refreshed_at`,
          )
          for (const snapshot of snapshots) {
            deleteRecords.run(options.tenantKey, snapshot.entityType)
            for (const identity of snapshot.identities) {
              insert.run(
                options.tenantKey,
                snapshot.entityType,
                identity.externalId,
                identity.displayName,
                identity.normalizedName,
                identity.active ? 1 : 0,
                fetchedAtValue,
                identity.sourceUpdatedAt ?? null,
              )
            }
            upsertSnapshot.run(options.tenantKey, snapshot.entityType, fetchedAtValue)
          }
          database.exec('COMMIT')
        } catch (error) {
          database.exec('ROLLBACK')
          throw error
        }
      })
    },
  }
}
