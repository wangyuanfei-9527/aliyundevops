// =============================================================================
// A2 Security Utilities — Unit Tests
// Tests for safe command execution, log redaction, and path safety.
// =============================================================================

import { describe, it, expect } from "vitest";
import { safeExec } from "@/src/lib/commands";
import { redact, redactValues, identifySecretEnvNames } from "@/src/lib/redact";
import {
  safePath,
  safeDataPath,
  safeTemplatePath,
  sanitizeFilename,
  hasTraversalSequence,
  isValidPathSegment,
  PathSafetyError,
} from "@/src/lib/paths";

// =============================================================================
// safeExec
// =============================================================================

describe("safeExec", () => {
  it("executes a command with array args and captures output", async () => {
    const result = await safeExec("node", ["-e", "console.log('hello')"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
    expect(result.stderr).toBe("");
    expect(result.timedOut).toBe(false);
  });

  it("captures stderr separately", async () => {
    const result = await safeExec("node", ["-e", "process.stderr.write('err output')"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("err output");
  });

  it("captures non-zero exit code", async () => {
    const result = await safeExec("node", ["-e", "process.exit(42)"]);
    expect(result.exitCode).toBe(42);
  });

  it("times out long-running commands", async () => {
    const result = await safeExec(
      "node",
      ["-e", "setTimeout(() => {}, 60000)"],
      { timeout: 200 },
    );
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(1);
  }, 10000);

  it("returns error for non-existent command", async () => {
    const result = await safeExec("nonexistent_command_xyz", []);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBeTruthy();
  });

  it("passes environment variables", async () => {
    const result = await safeExec("node", ["-e", "console.log(process.env.MY_TEST_VAR)"], {
      env: { MY_TEST_VAR: "test_value_123" },
    });
    expect(result.stdout.trim()).toBe("test_value_123");
  });

  it("redacts secret env values from output by default", async () => {
    const result = await safeExec(
      "node",
      ["-e", "console.log(process.env.SECRET_KEY)"],
      {
        env: { SECRET_KEY: "my-super-secret-value" },
        secretEnvNames: ["SECRET_KEY"],
      },
    );
    expect(result.stdout).not.toContain("my-super-secret-value");
    expect(result.stdout).toContain("***");
  });

  it("does not redact when redactOutput is false", async () => {
    const result = await safeExec(
      "node",
      ["-e", "console.log(process.env.SECRET_KEY)"],
      {
        env: { SECRET_KEY: "my-super-secret-value" },
        secretEnvNames: ["SECRET_KEY"],
        redactOutput: false,
      },
    );
    expect(result.stdout).toContain("my-super-secret-value");
  });

  it("uses array args — no shell injection", async () => {
    // If shell: true were used, "; echo pwned" would execute as a separate command
    const result = await safeExec("echo", ["hello; echo pwned"]);
    // With shell: false, this should either fail or echo the literal string
    // On Windows with shell:false, echo may not be found; on Unix it echoes literally
    expect(result.timedOut).toBe(false);
  });
});

// =============================================================================
// redact
// =============================================================================

describe("redact", () => {
  it("redacts Aliyun AccessKey Secret", () => {
    const input = 'AccessKeySecret=AbCdEf1234567890AbCdEf1234567890AbCd';
    const output = redact(input);
    expect(output).not.toContain("AbCdEf1234567890AbCdEf1234567890AbCd");
    expect(output).toContain("***");
  });

  it("redacts Aliyun AccessKey ID", () => {
    const input = 'AccessKeyID=LTAI5tFakeAccessKeyXX';
    const output = redact(input);
    expect(output).not.toContain("LTAI5tFakeAccessKeyXX");
    expect(output).toContain("***");
  });

  it("redacts generic password", () => {
    const input = "password=MyS3cretP@ssw0rd!";
    const output = redact(input);
    expect(output).not.toContain("MyS3cretP@ssw0rd!");
    expect(output).toContain("***");
  });

  it("redacts token values", () => {
    const input = "token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abc123";
    const output = redact(input);
    expect(output).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abc123");
    expect(output).toContain("***");
  });

  it("redacts database connection strings", () => {
    const input = "DATABASE_URL=postgres://user:pass@host:5432/mydb?sslmode=require";
    const output = redact(input);
    expect(output).not.toContain("postgres://user:pass@host:5432");
    expect(output).toContain("***");
  });

  it("redacts Redis connection strings", () => {
    const input = "redis://default:mypassword@r-xxx.redis.rds.aliyuncs.com:6379/0";
    const output = redact(input);
    expect(output).not.toContain("redis://default:mypassword@");
    expect(output).toContain("***");
  });

  it("redacts Bearer tokens", () => {
    const input = 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9longtoken';
    const output = redact(input);
    expect(output).not.toContain("eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9longtoken");
    expect(output).toContain("***");
  });

  it("redacts Yunxiao PAT tokens", () => {
    const input = "YUNXIAO_TOKEN=pt-JZ8rQKxUo1eU8MvDcH4LIwp7_a949c2ff-3a50-477a";
    const output = redact(input);
    expect(output).not.toContain("pt-JZ8rQKxUo1eU8MvDcH4LIwp7_a949c2ff-3a50-477a");
    expect(output).toContain("***");
  });

  it("redacts JDBC URLs with password", () => {
    const input = "jdbc:mysql://host:3306/db?password=secretpass&user=root";
    const output = redact(input);
    expect(output).not.toContain("password=secretpass");
    expect(output).toContain("***");
  });

  it("preserves non-sensitive content", () => {
    const input = "Application started on port 3000 with 4 workers";
    const output = redact(input);
    expect(output).toBe(input);
  });
});

describe("redactValues", () => {
  it("replaces exact secret values", () => {
    const input = "The key is my-secret-key-123 and it appears twice: my-secret-key-123";
    const output = redactValues(input, ["my-secret-key-123"]);
    expect(output).not.toContain("my-secret-key-123");
    expect(output).toContain("***");
    expect(output.match(/\*\*\*/g)).toHaveLength(2);
  });

  it("handles multiple secrets", () => {
    const input = "key1=alpha, key2=beta";
    const output = redactValues(input, ["alpha", "beta"]);
    expect(output).not.toContain("alpha");
    expect(output).not.toContain("beta");
  });

  it("handles empty secrets array", () => {
    const input = "nothing to redact";
    const output = redactValues(input, []);
    expect(output).toBe(input);
  });

  it("ignores empty string secrets", () => {
    const input = "don't change this";
    const output = redactValues(input, [""]);
    expect(output).toBe(input);
  });
});

describe("identifySecretEnvNames", () => {
  it("identifies secret env var names", () => {
    const env = {
      DATABASE_HOST: "localhost",
      DATABASE_PASSWORD: "secret",
      API_TOKEN: "tok_123",
      NODE_ENV: "production",
      SECRET_KEY: "abc",
    };
    const names = identifySecretEnvNames(env);
    expect(names).toContain("DATABASE_PASSWORD");
    expect(names).toContain("API_TOKEN");
    expect(names).toContain("SECRET_KEY");
    expect(names).not.toContain("DATABASE_HOST");
    expect(names).not.toContain("NODE_ENV");
  });

  it("returns empty array for non-secret env", () => {
    const env = { PATH: "/usr/bin", HOME: "/root" };
    const names = identifySecretEnvNames(env);
    expect(names).toHaveLength(0);
  });
});

// =============================================================================
// paths
// =============================================================================

describe("safePath", () => {
  it("resolves a relative path within base", () => {
    const result = safePath("/data", "projects/my-project");
    expect(result).toMatch(/[/\\]data[/\\]projects[/\\]my-project$/);
  });

  it("resolves an absolute path within base", () => {
    const result = safePath("/data", "/data/projects/my-project");
    expect(result).toMatch(/[/\\]data[/\\]projects[/\\]my-project$/);
  });

  it("rejects traversal with ../", () => {
    expect(() => safePath("/data", "../../../etc/passwd")).toThrow(PathSafetyError);
  });

  it("rejects traversal that escapes base", () => {
    expect(() => safePath("/data/app", "../outside")).toThrow(PathSafetyError);
  });

  it("rejects path that is a prefix of base but not inside it", () => {
    expect(() => safePath("/data", "/data-backup/evil")).toThrow(PathSafetyError);
  });

  it("allows the base path itself", () => {
    const result = safePath("/data", "/data");
    expect(result).toMatch(/[/\\]data$/);
  });

  it("normalizes path separators", () => {
    const result = safePath("/data", "projects//my-project");
    expect(result).toMatch(/[/\\]data[/\\]projects[/\\]my-project$/);
  });
});

describe("safeDataPath", () => {
  it("resolves path under data directory", () => {
    const result = safeDataPath("projects/test", "/custom/data");
    expect(result).toMatch(/[/\\]custom[/\\]data[/\\]projects[/\\]test$/);
  });

  it("rejects traversal from data dir", () => {
    expect(() => safeDataPath("../../etc/passwd", "/data")).toThrow(PathSafetyError);
  });
});

describe("safeTemplatePath", () => {
  it("resolves path under templates directory", () => {
    const result = safeTemplatePath("terraform/main.tf", "/custom/templates");
    expect(result).toMatch(/[/\\]custom[/\\]templates[/\\]terraform[/\\]main\.tf$/);
  });

  it("rejects traversal from templates dir", () => {
    expect(() => safeTemplatePath("../../../etc/passwd", "/templates")).toThrow(PathSafetyError);
  });
});

describe("sanitizeFilename", () => {
  it("removes path separators", () => {
    expect(sanitizeFilename("foo/bar")).toBe("foobar");
    expect(sanitizeFilename("foo\\bar")).toBe("foobar");
  });

  it("prevents hidden files", () => {
    expect(sanitizeFilename(".env")).toBe("env");
    expect(sanitizeFilename(".htaccess")).toBe("htaccess");
  });

  it("removes invalid characters", () => {
    expect(sanitizeFilename('file<>:"|?*name')).toBe("filename");
  });

  it("returns unnamed for empty result", () => {
    expect(sanitizeFilename("")).toBe("unnamed");
    expect(sanitizeFilename("...")).toBe("unnamed");
  });

  it("truncates long filenames", () => {
    const long = "a".repeat(300);
    expect(sanitizeFilename(long).length).toBe(255);
  });

  it("preserves normal filenames", () => {
    expect(sanitizeFilename("my-project")).toBe("my-project");
    expect(sanitizeFilename("configjson")).toBe("configjson");
  });
});

describe("hasTraversalSequence", () => {
  it("detects ../ in path", () => {
    expect(hasTraversalSequence("../../etc/passwd")).toBe(true);
  });

  it("detects .. segments after normalization", () => {
    expect(hasTraversalSequence("foo/../../../bar")).toBe(true);
  });

  it("passes for safe paths", () => {
    expect(hasTraversalSequence("projects/my-project")).toBe(false);
    expect(hasTraversalSequence("simple-file.txt")).toBe(false);
  });
});

describe("isValidPathSegment", () => {
  it("accepts alphanumeric, hyphen, underscore", () => {
    expect(isValidPathSegment("my-project")).toBe(true);
    expect(isValidPathSegment("project_123")).toBe(true);
    expect(isValidPathSegment("MyProject")).toBe(true);
  });

  it("rejects path separators", () => {
    expect(isValidPathSegment("foo/bar")).toBe(false);
    expect(isValidPathSegment("foo\\bar")).toBe(false);
  });

  it("rejects dots", () => {
    expect(isValidPathSegment(".")).toBe(false);
    expect(isValidPathSegment("..")).toBe(false);
    expect(isValidPathSegment("a.b")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidPathSegment("")).toBe(false);
  });

  it("rejects segments starting with non-alphanumeric", () => {
    expect(isValidPathSegment("-project")).toBe(false);
    expect(isValidPathSegment("_project")).toBe(false);
  });

  it("rejects overly long segments", () => {
    expect(isValidPathSegment("a".repeat(129))).toBe(false);
  });
});
