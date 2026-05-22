// =============================================================================
// Path Safety — A2 Security Utilities
// Prevents directory traversal, validates paths stay within allowed base dirs,
// and normalizes paths for safe usage across the application.
// =============================================================================

import path from "path";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class PathSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathSafetyError";
  }
}

// ---------------------------------------------------------------------------
// Core validation
// ---------------------------------------------------------------------------

/**
 * Resolve and validate that a target path stays within the allowed base directory.
 * Throws PathSafetyError if the path escapes the base directory.
 *
 * @param basePath - The allowed root directory (must be absolute)
 * @param targetPath - The path to validate (can be relative or absolute)
 * @returns The resolved, normalized absolute path
 * @throws PathSafetyError if the path escapes the base directory
 */
export function safePath(basePath: string, targetPath: string): string {
  const resolvedBase = path.resolve(basePath);
  const resolvedTarget = path.resolve(resolvedBase, targetPath);

  // Ensure resolvedTarget starts with resolvedBase + path.sep
  // Using startsWith with separator to prevent prefix attacks (e.g., /data vs /data-backup)
  const baseWithSep = resolvedBase.endsWith(path.sep) ? resolvedBase : resolvedBase + path.sep;
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(baseWithSep)) {
    throw new PathSafetyError(
      `Path traversal detected: "${targetPath}" resolves to "${resolvedTarget}" which is outside "${resolvedBase}"`,
    );
  }

  return resolvedTarget;
}

// ---------------------------------------------------------------------------
// Project-specific path helpers
// ---------------------------------------------------------------------------

/** Default data root directory */
const DEFAULT_DATA_DIR = path.resolve(process.cwd(), "data");

/** Default templates root directory */
const DEFAULT_TEMPLATES_DIR = path.resolve(process.cwd(), "templates");

/**
 * Validate a path under the data directory.
 * Used by storage, logs, and Terraform state paths.
 */
export function safeDataPath(relativePath: string, dataDir?: string): string {
  return safePath(dataDir ?? DEFAULT_DATA_DIR, relativePath);
}

/**
 * Validate a path under the templates directory.
 * Used by Terraform template rendering.
 */
export function safeTemplatePath(relativePath: string, templatesDir?: string): string {
  return safePath(templatesDir ?? DEFAULT_TEMPLATES_DIR, relativePath);
}

// ---------------------------------------------------------------------------
// Input sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitize a filename by removing path separators and special characters.
 * Returns a safe filename that cannot contain directory traversal sequences.
 */
export function sanitizeFilename(name: string): string {
  // Remove any path separators, dots, and special chars
  let sanitized = name
    .replace(/[/\\]/g, "") // Remove path separators
    .replace(/\./g, "") // Remove all dots (prevent hidden files and traversal)
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"|?*\x00-\x1f]/g, "") // Remove invalid filename chars
    .trim();

  // Ensure non-empty result
  if (sanitized.length === 0) {
    sanitized = "unnamed";
  }

  // Limit length
  if (sanitized.length > 255) {
    sanitized = sanitized.substring(0, 255);
  }

  return sanitized;
}

/**
 * Check if a path contains traversal sequences without resolving it.
 * Useful for early rejection before any filesystem operations.
 */
export function hasTraversalSequence(inputPath: string): boolean {
  // Check for .. segments
  const normalized = path.normalize(inputPath);
  const parts = normalized.split(/[/\\]+/);
  return parts.some((part) => part === "..");
}

/**
 * Validate that a project name/group is safe for use in paths.
 * Only allows alphanumeric, hyphens, and underscores.
 */
export function isValidPathSegment(segment: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(segment) && segment.length <= 128;
}
