// =============================================================================
// ACR Helper Utilities — A8 Runner
// ACR repositories are managed by Terraform, not by the Runner directly.
// This module provides read-only helpers for constructing image references.
// Per AGENTS.md §5.4: Runner 不得创建 ACR Repository.
// =============================================================================

import type { ResourceManifest } from "@/src/types";

/**
 * Get the full ACR image tag for a project.
 * Combines the ACR namespace and repository name from the manifest.
 * Returns null if no ACR repository is configured.
 */
export function getImageTag(manifest: ResourceManifest, tag: string = "latest"): string | null {
  if (!manifest.acrRepository) {
    return null;
  }
  const { namespace, name } = manifest.acrRepository;
  return `${namespace}/${name}:${tag}`;
}
