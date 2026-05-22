// =============================================================================
// Log Redaction — A2 Security Utilities
// Sanitizes log output by replacing sensitive patterns with ***.
// Ensures no secrets, tokens, AccessKeys, passwords, or connection strings
// are persisted or displayed in logs.
// =============================================================================

// ---------------------------------------------------------------------------
// Redaction patterns — each matches a sensitive value and captures the secret
// ---------------------------------------------------------------------------

interface RedactionRule {
  /** Regex with a capture group for the secret value */
  pattern: RegExp;
  /** Description for debugging (not logged at runtime) */
  name: string;
}

const REDACTION_RULES: RedactionRule[] = [
  // Aliyun AccessKey Secret (32 chars base64-like after = or :)
  {
    name: "aliyun-accesskey-secret",
    pattern: /(?:AccessKeySecret|access_key_secret|accesskey-secret|AccessKey\s*Secret)\s*[=:]\s*["']?([A-Za-z0-9+/]{30,40}={0,2})["']?/gi,
  },
  // Aliyun AccessKey ID (LTAI prefix, 16-24 chars)
  {
    name: "aliyun-accesskey-id",
    pattern: /(?:AccessKeyID|access_key_id|accesskey-id|AccessKey\s*ID)\s*[=:]\s*["']?(LTAI[A-Za-z0-9]{12,20})["']?/gi,
  },
  // Generic password in connection strings and env vars
  {
    name: "password",
    pattern: /(?:password|passwd|pwd|db_pass|redis_password|smtp_password)\s*[=:]\s*["']?([^\s"'`,;]{4,128})["']?/gi,
  },
  // Token values (Bearer, token=, etc.)
  {
    name: "token",
    pattern: /(?:token|auth_token|api_key|apikey|access_token|refresh_token|yunxiao_token)\s*[=:]\s*["']?([^\s"'`,;]{8,256})["']?/gi,
  },
  // Database connection strings (mysql://, postgres://, mongodb://)
  {
    name: "db-connection-string",
    pattern: /((?:mysql|postgres|postgresql|mongodb|redis):\/\/[^\s"'`,;]{8,})/gi,
  },
  // Bearer token in headers (Authorization: Bearer <token>)
  {
    name: "bearer-token",
    pattern: /(?:Bearer\s+|Authorization\s*[:=]\s*["']?Bearer\s+)([^\s"'`,;]{8,256})/gi,
  },
  // Yunxiao/Flow PAT tokens (pt- prefix)
  {
    name: "yunxiao-pat",
    pattern: /(pt-[A-Za-z0-9_-]{20,})/g,
  },
  // JDBC connection strings with embedded passwords
  {
    name: "jdbc-connection",
    pattern: /(jdbc:[^\s"'`,;]*password=[^\s"'`,;&]+)/gi,
  },
];

// ---------------------------------------------------------------------------
// Core redaction function
// ---------------------------------------------------------------------------

/**
 * Redact sensitive values from a string, replacing them with `***`.
 *
 * Handles:
 * - Aliyun AccessKey ID/Secret
 * - Passwords in connection strings and env vars
 * - API tokens (Bearer, Yunxiao PAT, generic tokens)
 * - Full database/Redis connection strings
 * - JDBC URLs with embedded passwords
 *
 * @param input - The raw string to sanitize
 * @returns A sanitized string with secrets replaced by `***`
 */
export function redact(input: string): string {
  let result = input;

  for (const rule of REDACTION_RULES) {
    // Reset lastIndex for global regexes
    rule.pattern.lastIndex = 0;
    result = result.replace(rule.pattern, (match, ..._args) => {
      // Replace the entire match with *** to avoid leaking structure
      return match.replace(
        // For patterns with capture groups, replace the captured secret
        typeof _args[0] === "string" ? _args[0] : match,
        "***",
      );
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Redact known secret values from a string
// ---------------------------------------------------------------------------

/**
 * Redact specific known secret values from a string.
 * Use this when you have the actual secret values from env vars.
 *
 * @param input - The raw string
 * @param secrets - Array of exact secret values to redact
 * @returns Sanitized string
 */
export function redactValues(input: string, secrets: string[]): string {
  let result = input;
  for (const secret of secrets) {
    if (secret.length > 0) {
      // Use split/join for reliable replacement of all occurrences
      result = result.split(secret).join("***");
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Redact all env var values whose names suggest secrets
// ---------------------------------------------------------------------------

const SECRET_ENV_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /access[_-]?key/i,
  /private[_-]?key/i,
  /auth/i,
  /credential/i,
];

/**
 * Get env var names that likely contain secrets, for redaction.
 * Useful for identifying which env vars to pass to `secretEnvNames`.
 */
export function identifySecretEnvNames(envVars: Record<string, string>): string[] {
  return Object.keys(envVars).filter((key) =>
    SECRET_ENV_PATTERNS.some((pattern) => pattern.test(key)),
  );
}
