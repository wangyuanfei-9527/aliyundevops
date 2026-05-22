// =============================================================================
// Terraform Output Parser — A4 Terraform
// Parses terraform plan stdout and terraform output JSON.
// =============================================================================

import type { TerraformPlanInfo } from "@/src/types";

// ---------------------------------------------------------------------------
// Plan summary parser
// ---------------------------------------------------------------------------

/**
 * Regex to match Terraform plan summary line.
 * Example: "Plan: 3 to add, 0 to change, 0 to destroy."
 * Also matches: "No changes. Your infrastructure matches the configuration."
 */
const PLAN_SUMMARY_REGEX =
  /Plan:\s*(\d+)\s*to\s*add,\s*(\d+)\s*to\s*change,\s*(\d+)\s*to\s*destroy/;

const NO_CHANGES_PATTERN = /No changes\./;

/**
 * Parse terraform plan stdout into a TerraformPlanInfo summary.
 *
 * @param planOutput - Raw stdout from `terraform plan`
 * @param workDir - Terraform working directory
 * @param statePath - State file path
 * @param providerVersion - Provider version used
 * @returns TerraformPlanInfo with parsed counts
 */
export function parsePlanOutput(
  planOutput: string,
  workDir: string,
  statePath: string,
  providerVersion: string,
): TerraformPlanInfo {
  const summary = parsePlanSummary(planOutput);

  return {
    workDir,
    statePath,
    providerVersion,
    hasChanges: summary.createCount > 0 || summary.updateCount > 0 || summary.destroyCount > 0,
    createCount: summary.createCount,
    updateCount: summary.updateCount,
    destroyCount: summary.destroyCount,
  };
}

/**
 * Parse just the plan summary counts from plan output.
 */
export function parsePlanSummary(
  output: string,
): { createCount: number; updateCount: number; destroyCount: number } {
  // Check for "No changes" first
  if (NO_CHANGES_PATTERN.test(output)) {
    return { createCount: 0, updateCount: 0, destroyCount: 0 };
  }

  const match = output.match(PLAN_SUMMARY_REGEX);
  if (match) {
    return {
      createCount: parseInt(match[1], 10),
      updateCount: parseInt(match[2], 10),
      destroyCount: parseInt(match[3], 10),
    };
  }

  // Fallback: if we can't parse, return zeros (plan might have errored)
  return { createCount: 0, updateCount: 0, destroyCount: 0 };
}

// ---------------------------------------------------------------------------
// Terraform output parser
// ---------------------------------------------------------------------------

export interface TerraformOutputs {
  dns_record?: string;
  database_name?: string;
  database_instance_id?: string;
  acr_repo_name?: string;
  acr_instance_id?: string;
  oss_bucket?: string;
}

/**
 * Parse `terraform output -json` stdout into a structured object.
 *
 * Expected format:
 * ```json
 * {
 *   "dns_record": { "value": "order-test.tzxys.cn" },
 *   "database_name": { "value": "test_mall_order_service" }
 * }
 * ```
 *
 * @param outputJson - Raw JSON stdout from `terraform output -json`
 * @returns Parsed outputs with values extracted
 */
export function parseOutputJson(outputJson: string): TerraformOutputs {
  try {
    const raw = JSON.parse(outputJson) as Record<string, { value: string }>;
    const result: TerraformOutputs = {};

    if (raw.dns_record?.value) result.dns_record = raw.dns_record.value;
    if (raw.database_name?.value) result.database_name = raw.database_name.value;
    if (raw.database_instance_id?.value) result.database_instance_id = raw.database_instance_id.value;
    if (raw.acr_repo_name?.value) result.acr_repo_name = raw.acr_repo_name.value;
    if (raw.acr_instance_id?.value) result.acr_instance_id = raw.acr_instance_id.value;
    if (raw.oss_bucket?.value) result.oss_bucket = raw.oss_bucket.value;

    return result;
  } catch {
    // If JSON parsing fails, return empty outputs
    return {};
  }
}
