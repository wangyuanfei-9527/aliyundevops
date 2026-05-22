// =============================================================================
// Resource Derivation — A3 Resources
// Validates ProjectInput and derives all resource names deterministically.
// Pure functions — no cloud calls, no side effects.
// =============================================================================

import type { ProjectInput, DerivedResources } from "@/src/types";
import { validateProjectInput } from "@/src/ai/schemas";
import { isValidPathSegment } from "@/src/lib/paths";
import {
  codeGroupPathFrom,
  repositoryPathFrom,
  bucketNameFrom,
  dbNameFrom,
  acrRepoNameFrom,
  dnsSplit,
} from "@/src/lib/names";

// ---------------------------------------------------------------------------
// Domain validation
// ---------------------------------------------------------------------------

/**
 * Validate that a domain belongs to one of the allowed root domains.
 * Returns the parsed result or throws.
 */
export function validateDomain(
  domain: string,
  allowedRoots: string[],
): { rr: string; rootDomain: string } {
  if (allowedRoots.length === 0) {
    throw new Error("No allowed root domains configured");
  }
  return dnsSplit(domain, allowedRoots);
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

export interface DeriveResourcesOptions {
  /** Allowed DNS root domains (e.g. ["tzxys.cn", "example.com"]) */
  allowedRootDomains: string[];
  /** ACR namespace from config (e.g. "test") */
  acrNamespace: string;
}

/**
 * Validate project input for resource derivation.
 * Checks schema validity, path segment safety, and domain ownership.
 *
 * @returns warnings array (non-fatal issues)
 * @throws on invalid input
 */
export function validateInputForDerivation(
  input: ProjectInput,
  options: DeriveResourcesOptions,
): string[] {
  const warnings: string[] = [];

  // Schema validation
  const schemaResult = validateProjectInput(input);
  if (!schemaResult.success) {
    const issues = schemaResult.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid project input: ${issues}`);
  }

  // Path segment safety for group and name
  if (!isValidPathSegment(input.group)) {
    throw new Error(
      `Invalid group "${input.group}": must be alphanumeric with hyphens/underscores, max 128 chars`,
    );
  }
  if (!isValidPathSegment(input.name)) {
    throw new Error(
      `Invalid name "${input.name}": must be alphanumeric with hyphens/underscores, max 128 chars`,
    );
  }

  // Domain validation
  validateDomain(input.domain, options.allowedRootDomains);

  // Type-specific warnings
  if (input.type === "backend" && !input.servicePort) {
    warnings.push("servicePort is recommended for backend projects (default: 18080)");
  }

  if (input.type === "frontend" && input.servicePort) {
    warnings.push("servicePort is typically not needed for frontend projects");
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Core derivation
// ---------------------------------------------------------------------------

/**
 * Derive all resource names from a validated ProjectInput.
 * This is a pure function — no cloud calls, no side effects.
 *
 * @param input - Validated project input
 * @param options - Configuration for derivation (root domains, ACR namespace)
 * @returns DerivedResources with all computed resource names
 */
export function deriveResources(
  input: ProjectInput,
  options: DeriveResourcesOptions,
): DerivedResources {
  const { group, name, type, domain } = input;
  const { allowedRootDomains, acrNamespace } = options;

  const dns = dnsSplit(domain, allowedRootDomains);

  return {
    codeGroupPath: codeGroupPathFrom(group),
    repositoryPath: repositoryPathFrom(name),
    ossBucketName: type === "frontend" ? bucketNameFrom(group, name) : "",
    databaseName: type === "backend" ? dbNameFrom(group, name) : "",
    acrNamespace: type === "backend" ? acrNamespace : "",
    acrRepoName: type === "backend" ? acrRepoNameFrom(name) : "",
    dnsSubdomain: dns.rr,
    redisDbIndex: -1, // Placeholder — allocated later by storage layer
  };
}
