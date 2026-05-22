// =============================================================================
// Run Log Storage — A5 Storage
// JSONL append-only log for deployment run records.
// Each line is a complete RunLog JSON object. Logs are sanitized before writing.
// =============================================================================

import fs from "fs";
import type { RunLog, PlanStep } from "@/src/types";
import { redact } from "@/src/lib/redact";
import { safeDataPath } from "@/src/lib/paths";

// ---------------------------------------------------------------------------
// File layout
// ---------------------------------------------------------------------------

const LOGS_DIR = "logs";

function logsDir(dataDir: string): string {
  return safeDataPath(LOGS_DIR, dataDir);
}

function projectLogFile(projectId: string, dataDir: string): string {
  return safeDataPath(`${LOGS_DIR}/${projectId}.jsonl`, dataDir);
}

// ---------------------------------------------------------------------------
// Log sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitize a RunLog by redacting sensitive values from step parameters and errors.
 */
function sanitizeRunLog(log: RunLog): RunLog {
  return {
    ...log,
    steps: log.steps.map((step) => ({
      ...step,
      params: step.params
        ? Object.fromEntries(
            Object.entries(step.params).map(([k, v]) => [k, redact(v)]),
          )
        : undefined,
      error: step.error ? redact(step.error) : undefined,
    })),
  };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Append a new run log entry for a project.
 * Creates the log file if it doesn't exist.
 */
export function appendRunLog(log: RunLog, dataDir: string): void {
  const dir = logsDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });

  const sanitized = sanitizeRunLog(log);
  const line = JSON.stringify(sanitized) + "\n";
  const filePath = projectLogFile(log.projectId, dataDir);

  fs.appendFileSync(filePath, line, "utf-8");
}

/**
 * Update an existing run log entry by replacing the last matching entry by ID.
 * Used to update step statuses during execution.
 */
export function updateRunLog(log: RunLog, dataDir: string): void {
  const filePath = projectLogFile(log.projectId, dataDir);

  if (!fs.existsSync(filePath)) {
    // If no file exists, just append
    appendRunLog(log, dataDir);
    return;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  // Find and replace the matching log entry
  let replaced = false;
  const updatedLines = lines.map((line) => {
    try {
      const entry = JSON.parse(line) as RunLog;
      if (entry.id === log.id) {
        replaced = true;
        return JSON.stringify(sanitizeRunLog(log));
      }
    } catch {
      // Skip malformed lines
    }
    return line;
  });

  if (!replaced) {
    updatedLines.push(JSON.stringify(sanitizeRunLog(log)));
  }

  // Atomic write the entire file
  const tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, updatedLines.join("\n") + "\n", "utf-8");
  fs.renameSync(tmpPath, filePath);
}

/**
 * Get the latest run log for a project.
 * Returns null if no logs exist.
 */
export function getLatestRunLog(projectId: string, dataDir: string): RunLog | null {
  const logs = getRunLogs(projectId, dataDir);
  return logs.length > 0 ? logs[logs.length - 1] : null;
}

/**
 * Get all run logs for a project, ordered by startedAt.
 */
export function getRunLogs(projectId: string, dataDir: string): RunLog[] {
  const filePath = projectLogFile(projectId, dataDir);

  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);
  const logs: RunLog[] = [];

  for (const line of lines) {
    try {
      logs.push(JSON.parse(line) as RunLog);
    } catch {
      // Skip malformed lines
    }
  }

  return logs.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/**
 * Create a new RunLog with status "running" and empty steps.
 */
export function createRunLog(
  projectId: string,
  steps: PlanStep[],
): RunLog {
  return {
    id: `run-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    projectId,
    startedAt: new Date().toISOString(),
    status: "running",
    steps,
  };
}

/**
 * Finalize a run log by setting status and finishedAt.
 */
export function finalizeRunLog(
  log: RunLog,
  status: "completed" | "failed",
): RunLog {
  return {
    ...log,
    status,
    finishedAt: new Date().toISOString(),
  };
}
