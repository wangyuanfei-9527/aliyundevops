// =============================================================================
// Redis DB Allocation — A5 Storage
// Allocates unique Redis database numbers from a configured range.
// Scans existing project records to find occupied numbers,
// then assigns the minimum unoccupied number.
// =============================================================================

import type { RedisAllocation, ProjectRecord } from "@/src/types";
import { listProjects } from "@/src/storage/projects";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RedisAllocConfig {
  instanceId: string;
  host: string;
  port: number;
  passwordEnv: string;
  /** Minimum db number (inclusive). Typically 1 to reserve db 0. */
  dbMin: number;
  /** Maximum db number (inclusive). Typically 15 for a 16-database instance. */
  dbMax: number;
}

// ---------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------

/**
 * Collect all currently allocated Redis db numbers from project records.
 */
export function collectAllocatedDbs(records: ProjectRecord[]): number[] {
  const dbs: number[] = [];
  for (const record of records) {
    const dbIndex = record.manifest?.redis?.db;
    if (dbIndex !== undefined && dbIndex >= 0) {
      dbs.push(dbIndex);
    }
  }
  return dbs;
}

/**
 * Find the minimum unoccupied db number in the configured range.
 * Returns null if all numbers are occupied.
 */
export function findMinUnoccupied(
  allocated: number[],
  dbMin: number,
  dbMax: number,
): number | null {
  const occupied = new Set(allocated);
  for (let db = dbMin; db <= dbMax; db++) {
    if (!occupied.has(db)) {
      return db;
    }
  }
  return null;
}

/**
 * Allocate a Redis database number for a new project.
 *
 * Algorithm:
 * 1. Read all project records
 * 2. Collect occupied db numbers from manifest.redis.db
 * 3. Find minimum unoccupied in [dbMin..dbMax]
 * 4. Return a RedisAllocation with the allocated number
 *
 * @throws Error if no db numbers are available
 */
export function allocateRedisDb(
  dataDir: string,
  config: RedisAllocConfig,
): RedisAllocation {
  const records = listProjects(dataDir);
  const allocated = collectAllocatedDbs(records);
  const dbNumber = findMinUnoccupied(allocated, config.dbMin, config.dbMax);

  if (dbNumber === null) {
    throw new Error(
      `No available Redis db numbers in range [${config.dbMin}..${config.dbMax}]. ` +
        `All ${config.dbMax - config.dbMin + 1} slots are occupied.`,
    );
  }

  return {
    instanceId: config.instanceId,
    host: config.host,
    port: config.port,
    db: dbNumber,
    passwordEnv: config.passwordEnv,
  };
}

/**
 * Check if a specific db number is already allocated.
 */
export function isDbAllocated(db: number, records: ProjectRecord[]): boolean {
  return collectAllocatedDbs(records).includes(db);
}

/**
 * Get count of remaining available db slots.
 */
export function remainingDbSlots(
  dataDir: string,
  config: RedisAllocConfig,
): number {
  const records = listProjects(dataDir);
  const allocated = collectAllocatedDbs(records);
  const total = config.dbMax - config.dbMin + 1;
  return total - allocated.filter((db) => db >= config.dbMin && db <= config.dbMax).length;
}
