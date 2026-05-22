// =============================================================================
// Safe Command Execution — A2 Security Utilities
// Provides spawn-based command execution with timeout, structured output,
// and sensitive output filtering. Never uses shell string concatenation.
// =============================================================================

import { spawn, type ChildProcess } from "child_process";
import { redact } from "@/src/lib/redact";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ExecOptions {
  /** Working directory for the command */
  cwd?: string;
  /** Timeout in milliseconds. Default: 300_000 (5 minutes) */
  timeout?: number;
  /** Additional environment variables */
  env?: Record<string, string>;
  /** Max stdout/stderr buffer size in bytes. Default: 10 MB */
  maxBuffer?: number;
  /** Whether to filter sensitive values from output. Default: true */
  redactOutput?: boolean;
  /** Environment variable names whose values should be redacted from output */
  secretEnvNames?: string[];
}

const DEFAULT_TIMEOUT = 300_000; // 5 minutes
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

// ---------------------------------------------------------------------------
// Safe exec — spawn with array args, timeout, structured capture
// ---------------------------------------------------------------------------

/**
 * Execute a command safely using spawn with argument arrays.
 *
 * - Never concatenates shell strings — args are always an array.
 * - Captures stdout, stderr, and exit code separately.
 * - Supports configurable timeout that kills the process.
 * - Filters sensitive values from output by default.
 */
export async function safeExec(
  command: string,
  args: string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  const {
    cwd,
    timeout = DEFAULT_TIMEOUT,
    env,
    maxBuffer = DEFAULT_MAX_BUFFER,
    redactOutput = true,
    secretEnvNames = [],
  } = options;

  return new Promise<ExecResult>((resolve) => {
    const procEnv: NodeJS.ProcessEnv = { ...process.env };
    if (env) {
      Object.assign(procEnv, env);
    }

    const child: ChildProcess = spawn(command, args, {
      cwd,
      env: procEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      settled = true;
      child.kill("SIGKILL");
    }, timeout);

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    child.stdout?.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(stdout) + chunks.reduce((s, c) => s + c.length, 0) + chunk.length <= maxBuffer) {
        chunks.push(chunk);
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(stderr) + errChunks.reduce((s, c) => s + c.length, 0) + chunk.length <= maxBuffer) {
        errChunks.push(chunk);
      }
    });

    child.on("close", (exitCode: number | null) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
      }

      stdout = Buffer.concat(chunks).toString("utf-8");
      stderr = Buffer.concat(errChunks).toString("utf-8");

      // Collect secret values for redaction
      const secretValues: string[] = [];
      if (redactOutput) {
        for (const name of secretEnvNames) {
          const val = procEnv[name];
          if (val) secretValues.push(val);
        }
      }

      const filterOutput = (raw: string): string => {
        if (!redactOutput) return raw;
        let filtered = redact(raw);
        for (const val of secretValues) {
          if (val.length > 0) {
            filtered = filtered.replaceAll(val, "***");
          }
        }
        return filtered;
      };

      resolve({
        exitCode: exitCode ?? 1,
        stdout: filterOutput(stdout),
        stderr: filterOutput(stderr),
        timedOut,
      });
    });

    child.on("error", (err: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
      }
      resolve({
        exitCode: 1,
        stdout: "",
        stderr: err.message,
        timedOut: false,
      });
    });
  });
}
