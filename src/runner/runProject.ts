// =============================================================================
// Run Project Orchestrator — A8 Runner
// Sequentially executes deployment steps, logs progress, stops on failure.
// Supports single-step retry for failed steps.
// =============================================================================

import type { DeployPlan, RunLog, PlanStep, StepStatus } from "@/src/types";
import { STEP_TYPES } from "@/src/types";
import type { IYunxiaoAdapter } from "@/src/lib/yunxiao";
import type { TerraformExecConfig } from "@/src/terraform/executor";
import {
  registerStep,
  executeStep,
  clearRegistry,
  type StepContext,
  type IEcsAdapter,
  type IOssAdapter,
} from "@/src/runner/stepRegistry";
import { createRunLog, updateRunLog, finalizeRunLog, appendRunLog } from "@/src/storage/logs";
import { terraformInit, terraformPlan, terraformApply } from "@/src/terraform/executor";

// ---------------------------------------------------------------------------
// Step executor imports
// ---------------------------------------------------------------------------
import {
  ensureCodeGroup,
  ensureRepository,
  commitDockerfile,
  commitDockerCompose,
  commitDeployScript,
  commitBuildConfig,
} from "@/src/runner/steps/codeup";
import {
  writeDeployScript,
  deployToEcs,
  writeNginxConfig,
  reloadNginx,
  healthCheck,
} from "@/src/runner/steps/ecs";
import { configureOssWebsite } from "@/src/runner/steps/oss";
import { createFrontendPipeline, createBackendPipeline } from "@/src/runner/steps/flow";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RunProjectOptions {
  /** The confirmed deploy plan to execute */
  plan: DeployPlan;
  /** Yunxiao adapter for Codeup/Flow operations */
  yunxiao: IYunxiaoAdapter;
  /** ECS adapter for deployment operations */
  ecs: IEcsAdapter;
  /** OSS adapter for website configuration */
  oss: IOssAdapter;
  /** Terraform execution config (required for terraform steps) */
  terraformConfig?: TerraformExecConfig;
  /** Whether terraform apply is authorized */
  authorized?: boolean;
  /** Local data directory for log storage */
  dataDir: string;
}

// ---------------------------------------------------------------------------
// Terraform step executors
// ---------------------------------------------------------------------------

async function terraformInitStep(ctx: StepContext): Promise<{ success: boolean; message?: string }> {
  if (!ctx.terraformConfig) {
    return { success: false, message: "No Terraform config provided" };
  }
  const result = await terraformInit(ctx.terraformConfig);
  return {
    success: result.exitCode === 0,
    message: result.exitCode === 0
      ? "Terraform init completed"
      : `Terraform init failed (exit code ${result.exitCode}): ${result.stderr}`,
  };
}

async function terraformPlanStep(ctx: StepContext): Promise<{ success: boolean; message?: string }> {
  if (!ctx.terraformConfig) {
    return { success: false, message: "No Terraform config provided" };
  }
  const result = await terraformPlan(ctx.terraformConfig);
  return {
    success: result.success,
    message: result.success
      ? `Terraform plan completed (add: ${result.planInfo.createCount}, change: ${result.planInfo.updateCount}, destroy: ${result.planInfo.destroyCount})`
      : `Terraform plan failed: ${result.error ?? "unknown error"}`,
  };
}

async function terraformApplyStep(ctx: StepContext): Promise<{ success: boolean; message?: string }> {
  if (!ctx.terraformConfig) {
    return { success: false, message: "No Terraform config provided" };
  }
  if (!ctx.authorized) {
    return { success: false, message: "Terraform apply requires explicit authorization" };
  }
  const result = await terraformApply(ctx.terraformConfig, true);
  return {
    success: result.success,
    message: result.success
      ? "Terraform apply completed"
      : `Terraform apply failed: ${result.error ?? "unknown error"}`,
  };
}

// ---------------------------------------------------------------------------
// Step registration
// ---------------------------------------------------------------------------

/** Register all built-in step executors. Safe to call multiple times. */
export function registerAllSteps(): void {
  clearRegistry();

  // Phase 1: Yunxiao provisioning
  registerStep("ensureCodeGroup", ensureCodeGroup);
  registerStep("ensureRepository", ensureRepository);

  // Phase 2: Terraform
  registerStep("terraformInit", terraformInitStep);
  registerStep("terraformPlan", terraformPlanStep);
  registerStep("terraformApply", terraformApplyStep);

  // Phase 3: Codeup commits
  registerStep("commitDockerfile", commitDockerfile);
  registerStep("commitDockerCompose", commitDockerCompose);
  registerStep("commitDeployScript", commitDeployScript);
  registerStep("commitBuildConfig", commitBuildConfig);

  // Phase 3: ECS
  registerStep("writeDeployScript", writeDeployScript);
  registerStep("deployToEcs", deployToEcs);
  registerStep("writeNginxConfig", writeNginxConfig);
  registerStep("reloadNginx", reloadNginx);
  registerStep("configureOssWebsite", configureOssWebsite);
  registerStep("healthCheck", healthCheck);

  // Phase 3: Pipelines
  registerStep("createFrontendPipeline", createFrontendPipeline);
  registerStep("createBackendPipeline", createBackendPipeline);
}

// ---------------------------------------------------------------------------
// Step status helpers
// ---------------------------------------------------------------------------

function updateStepStatus(steps: PlanStep[], stepId: string, updates: Partial<PlanStep>): PlanStep[] {
  return steps.map((s) => s.id === stepId ? { ...s, ...updates } : s);
}

function markRemainingSkipped(steps: PlanStep[], fromIndex: number): PlanStep[] {
  return steps.map((s, i) => i > fromIndex ? { ...s, status: "skipped" as StepStatus } : s);
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Execute a full deployment plan sequentially.
 *
 * - Iterates through all steps in order
 * - Updates step status: pending → running → success/failed
 * - Stops on first failure, marks remaining steps as "skipped"
 * - Persists log to storage after each step
 * - Returns the final RunLog
 */
export async function runProject(options: RunProjectOptions): Promise<RunLog> {
  const { plan, dataDir } = options;
  const projectId = `${plan.manifest.group}-${plan.manifest.name}`;

  // Ensure steps are registered
  registerAllSteps();

  // Create run log
  let log = createRunLog(projectId, plan.steps);
  appendRunLog(log, dataDir);

  for (let i = 0; i < plan.steps.length; i++) {
    const step = log.steps[i];

    // Update to running
    log = {
      ...log,
      steps: updateStepStatus(log.steps, step.id, {
        status: "running",
        startedAt: new Date().toISOString(),
      }),
    };
    updateRunLog(log, dataDir);

    // Build context
    const ctx: StepContext = {
      step: log.steps[i],
      plan,
      adapters: {
        yunxiao: options.yunxiao,
        ecs: options.ecs,
        oss: options.oss,
      },
      terraformConfig: options.terraformConfig,
      authorized: options.authorized ?? false,
      dataDir,
    };

    // Execute
    let result: { success: boolean; message?: string };
    try {
      result = await executeStep(ctx);
    } catch (err) {
      result = {
        success: false,
        message: `Step execution error: ${(err as Error).message}`,
      };
    }

    // Update step result
    const stepStatus: StepStatus = result.success ? "success" : "failed";
    log = {
      ...log,
      steps: updateStepStatus(log.steps, step.id, {
        status: stepStatus,
        finishedAt: new Date().toISOString(),
        error: result.success ? undefined : result.message,
      }),
    };

    // If failed, mark remaining as skipped and finalize
    if (!result.success) {
      log = {
        ...log,
        steps: markRemainingSkipped(log.steps, i),
      };
      log = finalizeRunLog(log, "failed");
      updateRunLog(log, dataDir);
      return log;
    }

    updateRunLog(log, dataDir);
  }

  // All steps succeeded
  log = finalizeRunLog(log, "completed");
  updateRunLog(log, dataDir);
  return log;
}

// ---------------------------------------------------------------------------
// Single-step retry
// ---------------------------------------------------------------------------

/**
 * Retry a single failed step by its ID.
 * Re-executes only the specified step and updates the log.
 * The step's status is reset to "pending" before execution.
 *
 * @returns Updated RunLog
 */
export async function retryStep(
  log: RunLog,
  stepId: string,
  options: Omit<RunProjectOptions, "plan"> & { plan: DeployPlan },
): Promise<RunLog> {
  const { plan, dataDir } = options;

  // Find the step
  const stepIndex = log.steps.findIndex((s) => s.id === stepId);
  if (stepIndex === -1) {
    throw new Error(`Step "${stepId}" not found in run log`);
  }

  const step = log.steps[stepIndex];
  if (step.status !== "failed") {
    throw new Error(`Step "${stepId}" is not in failed state (current: ${step.status})`);
  }

  // Ensure steps are registered
  registerAllSteps();

  // Reset step to pending
  let updatedLog: RunLog = {
    ...log,
    status: "running",
    steps: updateStepStatus(log.steps, stepId, {
      status: "pending",
      error: undefined,
      startedAt: undefined,
      finishedAt: undefined,
    }),
  };

  // Update to running
  updatedLog = {
    ...updatedLog,
    steps: updateStepStatus(updatedLog.steps, stepId, {
      status: "running",
      startedAt: new Date().toISOString(),
    }),
  };
  updateRunLog(updatedLog, dataDir);

  // Build context
  const ctx: StepContext = {
    step: updatedLog.steps[stepIndex],
    plan,
    adapters: {
      yunxiao: options.yunxiao,
      ecs: options.ecs,
      oss: options.oss,
    },
    terraformConfig: options.terraformConfig,
    authorized: options.authorized ?? false,
    dataDir,
  };

  // Execute
  let result: { success: boolean; message?: string };
  try {
    result = await executeStep(ctx);
  } catch (err) {
    result = {
      success: false,
      message: `Step execution error: ${(err as Error).message}`,
    };
  }

  const stepStatus: StepStatus = result.success ? "success" : "failed";
  updatedLog = {
    ...updatedLog,
    steps: updateStepStatus(updatedLog.steps, stepId, {
      status: stepStatus,
      finishedAt: new Date().toISOString(),
      error: result.success ? undefined : result.message,
    }),
  };

  // Finalize log
  const allDone = updatedLog.steps.every(
    (s) => s.status === "success" || s.status === "skipped",
  );
  if (allDone) {
    updatedLog = finalizeRunLog(updatedLog, "completed");
  } else {
    updatedLog = { ...updatedLog, status: result.success ? "running" : "failed" };
  }

  updateRunLog(updatedLog, dataDir);
  return updatedLog;
}

// ---------------------------------------------------------------------------
// Validate that all step types in a plan are in the whitelist
// ---------------------------------------------------------------------------

/**
 * Validate that all step types in a deploy plan are in the STEP_TYPES whitelist.
 * Returns an array of invalid step types (empty if all valid).
 */
export function validatePlanStepTypes(plan: DeployPlan): string[] {
  const validTypes = new Set<string>(STEP_TYPES);
  return plan.steps
    .map((s) => s.type)
    .filter((t) => !validTypes.has(t));
}
