// =============================================================================
// Project Analyzer — A7 AI
// Reads repository files, sends to LLM for analysis,
// validates output against ProjectProfileSchema.
// =============================================================================

import type { ILLMProvider, LLMMessage } from "@/src/ai/llmProvider";
import { validateProjectProfile } from "@/src/ai/schemas";
import type { ProjectProfile } from "@/src/types";
import type { RepoFileInfo } from "@/src/lib/codeupReader";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const ANALYZER_SYSTEM_PROMPT = `You are a project analysis expert. Analyze the provided repository files and produce a JSON ProjectProfile.

Rules:
1. Identify the primary programming language, framework, and build tool.
2. Determine if the project needs a database and/or Redis.
3. Identify the service port the application listens on.
4. Check if Dockerfile or docker-compose files exist.
5. Provide clear reasoning for your analysis.
6. Report any warnings about missing or ambiguous configuration.

Output a JSON object matching this schema exactly:
{
  "language": "node" | "java" | "go" | "python" | "other",
  "framework": "string (e.g. Spring Boot, Next.js, Express)",
  "frameworkVersion": "string (optional)",
  "buildTool": "string (e.g. maven, npm, pnpm, go build)",
  "buildCommand": "string",
  "artifactDir": "string (optional, e.g. target, dist, build)",
  "runtimeCommand": "string (optional)",
  "needsDatabase": boolean,
  "databaseType": "mysql" | "postgresql" | "mongodb" (optional),
  "needsRedis": boolean,
  "servicePort": number,
  "hasDockerfile": boolean,
  "hasDockerCompose": boolean,
  "reasoning": "string — explain your analysis",
  "warnings": ["string"]
}

Respond ONLY with valid JSON. No markdown, no code fences.`;

// ---------------------------------------------------------------------------
// Input assembly
// ---------------------------------------------------------------------------

/**
 * Build the user message content from repository file info.
 */
export function buildAnalyzerPrompt(files: RepoFileInfo[], rootListing: string[]): string {
  const parts: string[] = ["## Repository Analysis Request\n"];

  parts.push("### Root Directory Files");
  parts.push(rootListing.length > 0 ? rootListing.join(", ") : "(empty or unavailable)");
  parts.push("");

  parts.push("### Key File Contents");
  for (const file of files) {
    if (file.exists && file.content) {
      parts.push(`#### ${file.path}`);
      parts.push("```");
      parts.push(file.content.length > 8000 ? file.content.substring(0, 8000) + "\n... (truncated)" : file.content);
      parts.push("```");
      parts.push("");
    }
  }

  const foundCount = files.filter((f) => f.exists).length;
  parts.push(`### Summary\nFound ${foundCount} of ${files.length} key files.`);

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Analysis execution
// ---------------------------------------------------------------------------

export interface AnalyzeProjectInput {
  files: RepoFileInfo[];
  rootListing: string[];
}

/**
 * Analyze a repository and produce a ProjectProfile.
 *
 * 1. Assembles prompt from repo files
 * 2. Sends to LLM
 * 3. Validates output against schema
 * 4. Retries once on validation failure with error feedback
 *
 * @throws Error if LLM is not configured or output fails validation after retries
 */
export async function analyzeProject(
  provider: ILLMProvider,
  input: AnalyzeProjectInput,
): Promise<ProjectProfile> {
  const userContent = buildAnalyzerPrompt(input.files, input.rootListing);

  const messages: LLMMessage[] = [
    { role: "system", content: ANALYZER_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];

  // Try up to 2 times: initial + 1 retry with error feedback
  let lastError: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (lastError) {
      messages.push({
        role: "assistant",
        content: "(previous attempt produced invalid output)",
      });
      messages.push({
        role: "user",
        content: `Your previous output failed validation: ${lastError}\n\nPlease fix and output valid JSON again.`,
      });
    }

    const response = await provider.complete(messages);
    const parsed = parseJSON(response.content);

    if (!parsed.success) {
      lastError = `Failed to parse JSON: ${parsed.error}`;
      continue;
    }

    const validation = validateProjectProfile(parsed.data);
    if (validation.success) {
      return validation.data as ProjectProfile;
    }

    const issues = validation.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    lastError = `Schema validation failed: ${issues}`;
  }

  throw new Error(
    `AI analysis failed after 2 attempts. Last error: ${lastError ?? "unknown"}`,
  );
}

// ---------------------------------------------------------------------------
// JSON parsing helper
// ---------------------------------------------------------------------------

function parseJSON(raw: string): { success: true; data: unknown } | { success: false; error: string } {
  try {
    // Try direct parse
    return { success: true, data: JSON.parse(raw) };
  } catch {
    // Try extracting JSON from markdown code fences
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match?.[1]) {
      try {
        return { success: true, data: JSON.parse(match[1].trim()) };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    }
    return { success: false, error: "No valid JSON found in response" };
  }
}
