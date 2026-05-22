// =============================================================================
// RDS Helper Utilities — A8 Runner
// RDS databases are managed by Terraform, not by the Runner directly.
// This module provides read-only validation helpers for other steps.
// Per AGENTS.md §5.4: Runner 不得创建 RDS Database.
// =============================================================================

import type { ResourceManifest } from "@/src/types";

/**
 * Check if the project has a database configured in its manifest.
 * Used by deployment steps to determine if database migration/setup is needed.
 */
export function hasDatabase(manifest: ResourceManifest): boolean {
  return manifest.database != null && manifest.database.status !== "skipped";
}

/**
 * Get the database name from the manifest, or null if no database.
 */
export function getDatabaseName(manifest: ResourceManifest): string | null {
  return manifest.database?.name ?? null;
}
