// =============================================================================
// Resource Name Derivation — A3 Resources
// Pure functions for deriving resource names from ProjectInput.
// No AI, no shell, no secrets. Deterministic and testable.
// =============================================================================

// ---------------------------------------------------------------------------
// Input normalization helpers
// ---------------------------------------------------------------------------

/**
 * Convert hyphens to underscores and lowercase. Used for DB names.
 */
export function toUnderscored(input: string): string {
  return input.toLowerCase().replace(/-/g, "_");
}

/**
 * Lowercase and keep only alphanumeric + hyphens. Used for OSS bucket names.
 * Must start and end with alphanumeric, 3–63 chars.
 */
export function toBucketSafe(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .replace(/-{2,}/g, "-");
}

// ---------------------------------------------------------------------------
// Core name derivation functions
// ---------------------------------------------------------------------------

/**
 * Derive OSS bucket name from group and project name.
 * Pattern: `test-{group}-{name}` (lowercase, hyphens only).
 * Only relevant for frontend projects.
 *
 * Example: ("mall", "admin-web") → "test-mall-admin-web"
 */
export function bucketNameFrom(group: string, name: string): string {
  const raw = `test-${group}-${name}`;
  return toBucketSafe(raw);
}

/**
 * Derive RDS database name from group and project name.
 * Pattern: `test_{group}_{name}` (lowercase, underscores only).
 * Only relevant for backend projects.
 *
 * Example: ("mall", "order-service") → "test_mall_order_service"
 */
export function dbNameFrom(group: string, name: string): string {
  return `test_${toUnderscored(group)}_${toUnderscored(name)}`;
}

/**
 * Derive ACR namespace and repository name.
 * Namespace comes from config, repo name equals the project name.
 * Only relevant for backend projects.
 *
 * Example: ("mall", "order-service") → { namespace: "test", repoName: "order-service" }
 *
 * Note: namespace is injected from config at the derive step, not computed here.
 * This function returns the repo name part.
 */
export function acrRepoNameFrom(name: string): string {
  return name.toLowerCase();
}

/**
 * Split a full domain into subdomain (RR) and root domain.
 *
 * Example: ("order-test.tzxys.cn", ["tzxys.cn"]) → { rr: "order-test", rootDomain: "tzxys.cn" }
 *
 * @throws Error if domain doesn't match any allowed root domain
 */
export function dnsSplit(
  domain: string,
  allowedRoots: string[],
): { rr: string; rootDomain: string } {
  // Sort roots by length descending to match longest first
  const sorted = [...allowedRoots].sort((a, b) => b.length - a.length);

  for (const root of sorted) {
    if (domain === root) {
      // Domain is the root itself — use "@" as RR
      return { rr: "@", rootDomain: root };
    }
    const suffix = `.${root}`;
    if (domain.endsWith(suffix)) {
      const rr = domain.slice(0, -suffix.length);
      if (rr.length > 0) {
        return { rr, rootDomain: root };
      }
    }
  }

  throw new Error(
    `Domain "${domain}" does not match any allowed root domain: ${allowedRoots.join(", ")}`,
  );
}

/**
 * Derive deploy path for a backend service on ECS.
 * Pattern: `/opt/apps/{name}`
 *
 * Example: ("order-service") → "/opt/apps/order-service"
 */
export function deployPathFrom(name: string): string {
  return `/opt/apps/${name}`;
}

/**
 * Derive Nginx config file path for a backend service.
 * Pattern: `/etc/nginx/conf.d/{name}.conf`
 *
 * Example: ("order-service") → "/etc/nginx/conf.d/order-service.conf"
 */
export function nginxConfPathFrom(name: string): string {
  return `/etc/nginx/conf.d/${name}.conf`;
}

/**
 * Derive Codeup group path.
 * Simple: just use the group name as-is.
 */
export function codeGroupPathFrom(group: string): string {
  return group;
}

/**
 * Derive Codeup repository path (relative to group).
 * Simple: just use the project name.
 */
export function repositoryPathFrom(name: string): string {
  return name;
}

/**
 * Full repository path including group.
 */
export function fullRepositoryPath(group: string, name: string): string {
  return `${group}/${name}`;
}

/**
 * Determine DNS record type based on project type.
 * Frontend → CNAME (points to OSS endpoint)
 * Backend → A (points to ECS IP)
 */
export function dnsRecordTypeForProjectType(
  type: "frontend" | "backend",
): "CNAME" | "A" {
  return type === "frontend" ? "CNAME" : "A";
}

// ---------------------------------------------------------------------------
// Terraform working directory and state paths
// ---------------------------------------------------------------------------

/**
 * Derive Terraform working directory for a project.
 * Pattern: `{dataDir}/terraform/{group}-{name}`
 */
export function terraformWorkDir(group: string, name: string, dataDir: string): string {
  return `${dataDir}/terraform/${group}-${name}`;
}

/**
 * Terraform state file name.
 */
export function terraformStateFile(): string {
  return "terraform.tfstate";
}
