import { appendFile, readFile } from "fs/promises";
import path from "path";
import type { RunLogEvent } from "@/types";
import { nowIso } from "@/lib/ids";
import { ensureDataDirs, runsDir } from "./paths";

export async function appendRunLog(runId: string, event: Omit<RunLogEvent, "time">) {
  await ensureDataDirs();
  const line = JSON.stringify({ time: nowIso(), ...event }) + "\n";
  await appendFile(path.join(runsDir, `${runId}.jsonl`), line, "utf8");
}

export async function readRunLogs(runId: string) {
  try {
    const content = await readFile(path.join(runsDir, `${runId}.jsonl`), "utf8");
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RunLogEvent);
  } catch {
    return [];
  }
}
