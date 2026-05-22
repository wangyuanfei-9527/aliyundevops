// =============================================================================
// Terraform Executor — A4 Terraform
// Wraps terraform init/plan/apply/output commands using safeExec.
// - Uses argument arrays (never shell string concatenation)
// - Captures stdout/stderr/exitCode separately
// - Supports configurable timeout
// - apply requires explicit authorization
// - No destroy capability
// =============================================================================

import { safeExec, type ExecResult, type ExecOptions } from "@/src/lib/commands";
import { parsePlanOutput, parseOutputJson, type TerraformOutputs } from "@/src/terraform/parser";
import type { TerraformPlanInfo } from "@/src/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TerraformExecConfig {
  /** Working directory for terraform commands */
  workDir: string;
  /** State file path (relative to workDir) */
  statePath?: string;
  /** Provider version */
  providerVersion: string;
  /** Timeout in milliseconds per command. Default: 600_000 (10 minutes) */
  timeout?: number;
  /** Environment variable names containing secrets to redact from output */
  secretEnvNames?: string[];
  /** Extra environment variables to pass to terraform */
  env?: Record<string, string>;
}

export interface TerraformPlanResult {
  success: boolean;
  planInfo: TerraformPlanInfo;
  rawOutput: string;
  error?: string;
}

export interface TerraformApplyResult {
  success: boolean;
  rawOutput: string;
  error?: string;
}

export interface TerraformOutputResult {
  success: boolean;
  outputs: TerraformOutputs;
  rawOutput: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT = 600_000; // 10 minutes
const TERRAFORM_BIN = "terraform";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildExecOptions(config: TerraformExecConfig): ExecOptions {
  return {
    cwd: config.workDir,
    timeout: config.timeout ?? DEFAULT_TIMEOUT,
    secretEnvNames: config.secretEnvNames ?? [],
    env: config.env,
    redactOutput: true,
  };
}

// ---------------------------------------------------------------------------
// terraform init
// ---------------------------------------------------------------------------

/**
 * Run `terraform init` in the work directory.
 * Downloads providers and initializes the backend.
 */
export async function terraformInit(
  config: TerraformExecConfig,
): Promise<ExecResult> {
  return safeExec(
    TERRAFORM_BIN,
    ["init", "-input=false", "-no-color"],
    buildExecOptions(config),
  );
}

// ---------------------------------------------------------------------------
// terraform plan
// ---------------------------------------------------------------------------

/**
 * Run `terraform plan` and parse the result into TerraformPlanInfo.
 *
 * @returns Structured plan result with parsed summary
 */
export async function terraformPlan(
  config: TerraformExecConfig,
): Promise<TerraformPlanResult> {
  const result = await safeExec(
    TERRAFORM_BIN,
    ["plan", "-input=false", "-no-color"],
    buildExecOptions(config),
  );

  const planInfo = parsePlanOutput(
    result.stdout + "\n" + result.stderr,
    config.workDir,
    config.statePath ?? "terraform.tfstate",
    config.providerVersion,
  );

  return {
    success: result.exitCode === 0,
    planInfo,
    rawOutput: result.timedOut ? "[timed out]" : result.stdout,
    error: result.exitCode !== 0 && !result.timedOut
      ? result.stderr || `terraform plan exited with code ${result.exitCode}`
      : result.timedOut ? "terraform plan timed out" : undefined,
  };
}

// ---------------------------------------------------------------------------
// terraform apply (requires authorization)
// ---------------------------------------------------------------------------

/**
 * Run `terraform apply`.
 *
 * **IMPORTANT**: This command creates real cloud resources.
 * The `authorized` parameter must be explicitly `true` to proceed.
 * If `authorized` is `false` or omitted, the function throws an error
 * without executing any command.
 *
 * Per AGENTS.md §3, this is a high-risk command that requires
 * explicit user authorization in the current session.
 */
export async function terraformApply(
  config: TerraformExecConfig,
  authorized: boolean = false,
): Promise<TerraformApplyResult> {
  if (!authorized) {
    return {
      success: false,
      rawOutput: "",
      error: "terraform apply requires explicit authorization. Pass authorized=true to proceed.",
    };
  }

  const result = await safeExec(
    TERRAFORM_BIN,
    ["apply", "-auto-approve", "-input=false", "-no-color"],
    buildExecOptions(config),
  );

  return {
    success: result.exitCode === 0,
    rawOutput: result.timedOut ? "[timed out]" : result.stdout,
    error: result.exitCode !== 0 && !result.timedOut
      ? result.stderr || `terraform apply exited with code ${result.exitCode}`
      : result.timedOut ? "terraform apply timed out" : undefined,
  };
}

// ---------------------------------------------------------------------------
// terraform output
// ---------------------------------------------------------------------------

/**
 * Run `terraform output -json` and parse the structured outputs.
 * Typically called after a successful `terraform apply`.
 */
export async function terraformOutput(
  config: TerraformExecConfig,
): Promise<TerraformOutputResult> {
  const result = await safeExec(
    TERRAFORM_BIN,
    ["output", "-json"],
    buildExecOptions(config),
  );

  if (result.exitCode !== 0) {
    return {
      success: false,
      outputs: {},
      rawOutput: result.stdout,
      error: result.stderr || `terraform output exited with code ${result.exitCode}`,
    };
  }

  const outputs = parseOutputJson(result.stdout);

  return {
    success: true,
    outputs,
    rawOutput: result.stdout,
  };
}

// ---------------------------------------------------------------------------
// terraform fmt (safe — no side effects on cloud resources)
// ---------------------------------------------------------------------------

/**
 * Run `terraform fmt` to canonicalize HCL files.
 * Safe to run without authorization.
 */
export async function terraformFmt(
  config: TerraformExecConfig,
): Promise<ExecResult> {
  return safeExec(
    TERRAFORM_BIN,
    ["fmt", "-recursive", "-no-color"],
    buildExecOptions(config),
  );
}
