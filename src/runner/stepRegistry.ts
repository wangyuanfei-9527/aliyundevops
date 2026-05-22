// =============================================================================
// Step Registry — A8 Runner
// Maps whitelisted StepType values to step executor functions.
// Unknown step types are rejected at runtime.
// No arbitrary shell execution is possible through this registry.
// =============================================================================

import { STEP_TYPES, type StepType, type PlanStep, type DeployPlan } from "@/src/types";
import type { IYunxiaoAdapter } from "@/src/lib/yunxiao";
import type { TerraformExecConfig } from "@/src/terraform/executor";

// ---------------------------------------------------------------------------
// Adapter interfaces — abstract external service calls
// ---------------------------------------------------------------------------

/** ECS adapter — wraps cloud assistant commands (no SSH) */
export interface IEcsAdapter {
  /** Run a command on the ECS instance via cloud assistant */
  runCommand(command: string): Promise<{ success: boolean; output?: string; exitCode?: number }>;
  /** Write a file to the ECS instance */
  writeFile(remotePath: string, content: string): Promise<{ success: boolean }>;
}

/** OSS adapter — wraps OSS API calls */
export interface IOssAdapter {
  /** Configure static website hosting on an OSS bucket */
  configureWebsite(bucket: string, indexPage: string, errorPage: string): Promise<{ success: boolean }>;
}

// ---------------------------------------------------------------------------
// Step execution types
// ---------------------------------------------------------------------------

/** Result returned by a step executor */
export interface StepResult {
  success: boolean;
  message?: string;
}

/** Context provided to every step executor */
export interface StepContext {
  /** The step being executed */
  step: PlanStep;
  /** The full deploy plan */
  plan: DeployPlan;
  /** Service adapters */
  adapters: {
    yunxiao: IYunxiaoAdapter;
    ecs: IEcsAdapter;
    oss: IOssAdapter;
  };
  /** Terraform execution config (required for terraform steps) */
  terraformConfig?: TerraformExecConfig;
  /** Whether terraform apply is authorized */
  authorized: boolean;
  /** Local data directory for log storage */
  dataDir: string;
}

/** A step executor function */
export type StepExecutor = (ctx: StepContext) => Promise<StepResult>;

// ---------------------------------------------------------------------------
// Registry implementation
// ---------------------------------------------------------------------------

const registry = new Map<StepType, StepExecutor>();

const VALID_STEP_TYPES = new Set<string>(STEP_TYPES);

/**
 * Register a step executor for a given StepType.
 * Throws if the type is not in the whitelist.
 */
export function registerStep(type: StepType, executor: StepExecutor): void {
  if (!VALID_STEP_TYPES.has(type)) {
    throw new Error(`Cannot register unknown step type: "${type}". Only whitelisted STEP_TYPES are allowed.`);
  }
  registry.set(type, executor);
}

/**
 * Get the executor for a step type, or undefined if not registered.
 */
export function getStepExecutor(type: StepType): StepExecutor | undefined {
  return registry.get(type);
}

/**
 * Execute a registered step.
 * Throws for unknown types (not in whitelist) or unregistered types.
 */
export async function executeStep(ctx: StepContext): Promise<StepResult> {
  const { type } = ctx.step;

  if (!VALID_STEP_TYPES.has(type)) {
    return {
      success: false,
      message: `Rejected unknown step type: "${type}". Only whitelisted STEP_TYPES are allowed.`,
    };
  }

  const executor = registry.get(type);
  if (!executor) {
    return {
      success: false,
      message: `No executor registered for step type: "${type}".`,
    };
  }

  return executor(ctx);
}

/**
 * Get all currently registered step types.
 */
export function getRegisteredStepTypes(): StepType[] {
  return [...registry.keys()];
}

/**
 * Check if a step type is currently registered.
 */
export function isStepRegistered(type: string): boolean {
  return registry.has(type as StepType);
}

/**
 * Clear all registered executors. Used for testing.
 */
export function clearRegistry(): void {
  registry.clear();
}

// ---------------------------------------------------------------------------
// Mock adapters — for testing
// ---------------------------------------------------------------------------

export class MockEcsAdapter implements IEcsAdapter {
  private commandLog: Array<{ command: string; result: { success: boolean; output?: string; exitCode?: number } }> = [];
  private fileLog: Array<{ path: string; content: string }> = [];
  private nextCommandResult: { success: boolean; output?: string; exitCode?: number } = { success: true, output: "ok" };
  private nextWriteResult: { success: boolean } = { success: true };

  /** Set the result for the next runCommand call */
  setNextCommandResult(result: { success: boolean; output?: string; exitCode?: number }): void {
    this.nextCommandResult = result;
  }

  /** Set the result for the next writeFile call */
  setNextWriteResult(result: { success: boolean }): void {
    this.nextWriteResult = result;
  }

  async runCommand(command: string): Promise<{ success: boolean; output?: string; exitCode?: number }> {
    this.commandLog.push({ command, result: this.nextCommandResult });
    const result = this.nextCommandResult;
    this.nextCommandResult = { success: true, output: "ok" }; // reset to default
    return result;
  }

  async writeFile(remotePath: string, content: string): Promise<{ success: boolean }> {
    this.fileLog.push({ path: remotePath, content });
    const result = this.nextWriteResult;
    this.nextWriteResult = { success: true }; // reset to default
    return result;
  }

  /** Test helpers */
  getCommandLog(): Array<{ command: string; result: { success: boolean; output?: string; exitCode?: number } }> {
    return [...this.commandLog];
  }

  getFileLog(): Array<{ path: string; content: string }> {
    return [...this.fileLog];
  }

  getWrittenFiles(): Map<string, string> {
    const map = new Map<string, string>();
    for (const entry of this.fileLog) {
      map.set(entry.path, entry.content);
    }
    return map;
  }
}

export class MockOssAdapter implements IOssAdapter {
  private websiteConfigs: Array<{ bucket: string; indexPage: string; errorPage: string }> = [];
  private nextResult: { success: boolean } = { success: true };

  /** Set the result for the next configureWebsite call */
  setNextResult(result: { success: boolean }): void {
    this.nextResult = result;
  }

  async configureWebsite(bucket: string, indexPage: string, errorPage: string): Promise<{ success: boolean }> {
    this.websiteConfigs.push({ bucket, indexPage, errorPage });
    const result = this.nextResult;
    this.nextResult = { success: true }; // reset
    return result;
  }

  /** Test helper */
  getWebsiteConfigs(): Array<{ bucket: string; indexPage: string; errorPage: string }> {
    return [...this.websiteConfigs];
  }
}
