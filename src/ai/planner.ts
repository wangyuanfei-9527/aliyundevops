// =============================================================================
// Deploy Planner — A7 AI
// Takes ProjectProfile + ResourceManifest, sends to LLM,
// validates output against DeployPlanSchema.
// =============================================================================

import type { ILLMProvider, LLMMessage } from "@/src/ai/llmProvider";
import { validateDeployPlan } from "@/src/ai/schemas";
import type { ProjectProfile, ResourceManifest, DeployPlan } from "@/src/types";
import { STEP_TYPES } from "@/src/types";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const PLANNER_SYSTEM_PROMPT = `You are a DevOps deployment planner for Alibaba Cloud test environments.
Given a project profile and provisioned resources, generate a complete deployment plan.

Rules:
1. Generate deployment artifacts (Dockerfile, docker-compose, deploy script, nginx config, pipeline YAML) as appropriate for the project type.
2. Only use whitelisted step types. Available step types:
${STEP_TYPES.map((t) => `   - ${t}`).join("\n")}
3. NEVER include secret values in env variables. Put secret env var NAMES in secretEnvNames only.
4. Steps must have unique IDs within a plan.
5. Provide clear reasoning, assumptions, warnings, and manual steps.
6. Frontend projects: use CNAME DNS, OSS bucket, no database/ACR.
7. Backend projects: use A record DNS, RDS database, ACR repository.

Output a JSON object matching this schema:
{
  "profile": { ...ProjectProfile... },
  "manifest": { ...ResourceManifest... },
  "artifacts": { dockerfile?, dockerCompose?, deployScript?, nginxConfig?, pipelineYaml?, buildScript? },
  "env": { "variables": {}, "secretEnvNames": [] },
  "ports": { "servicePort": number, "hostPort"?: number },
  "steps": [{ "id": "string", "type": "StepType", "name": "string", "description"?: "string" }],
  "reasoning": "string",
  "assumptions": ["string"],
  "warnings": ["string"],
  "manualSteps": ["string"]
}

Respond ONLY with valid JSON. No markdown, no code fences.`;

// ---------------------------------------------------------------------------
// Input assembly
// ---------------------------------------------------------------------------

export interface PlannerInput {
  profile: ProjectProfile;
  manifest: ResourceManifest;
}

/**
 * Build the user message for the deploy planner.
 */
export function buildPlannerPrompt(input: PlannerInput): string {
  const parts: string[] = ["## Deployment Plan Request\n"];

  parts.push("### Project Profile");
  parts.push("```json");
  parts.push(JSON.stringify(input.profile, null, 2));
  parts.push("```\n");

  parts.push("### Provisioned Resources (ResourceManifest)");
  parts.push("```json");
  parts.push(JSON.stringify(input.manifest, null, 2));
  parts.push("```\n");

  parts.push("### Instructions");
  parts.push("Generate a complete DeployPlan that:");
  parts.push("1. Includes appropriate deployment artifacts for this project type");
  parts.push("2. Uses only whitelisted StepType values for steps");
  parts.push("3. Lists any sensitive env var names in secretEnvNames (never values)");
  parts.push("4. Provides all steps needed from code commit to health check");
  parts.push("5. Notes any assumptions or warnings");

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Plan generation
// ---------------------------------------------------------------------------

/**
 * Generate a DeployPlan from a project profile and resource manifest.
 *
 * 1. Assembles prompt from profile + manifest
 * 2. Sends to LLM
 * 3. Validates output against DeployPlanSchema (includes StepType whitelist check)
 * 4. Retries once on validation failure
 *
 * @throws Error if LLM is not configured or output fails validation after retries
 */
export async function generateDeployPlan(
  provider: ILLMProvider,
  input: PlannerInput,
): Promise<DeployPlan> {
  const userContent = buildPlannerPrompt(input);

  const messages: LLMMessage[] = [
    { role: "system", content: PLANNER_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];

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

    const validation = validateDeployPlan(parsed.data);
    if (validation.success) {
      return validation.data as DeployPlan;
    }

    const issues = validation.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    lastError = `Schema validation failed: ${issues}`;
  }

  throw new Error(
    `Deploy plan generation failed after 2 attempts. Last error: ${lastError ?? "unknown"}`,
  );
}

// ---------------------------------------------------------------------------
// JSON parsing helper
// ---------------------------------------------------------------------------

function parseJSON(raw: string): { success: true; data: unknown } | { success: false; error: string } {
  try {
    return { success: true, data: JSON.parse(raw) };
  } catch {
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
