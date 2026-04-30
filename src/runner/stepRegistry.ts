import type { PlanStep, StepContext, StepResult, StepType } from "@/types";
import { ensureCodeGroup, ensureRepository } from "./steps/codeup";
import { ensureOssBucket } from "./steps/oss";
import { ensureDatabase } from "./steps/rds";
import { ensureAcrRepository } from "./steps/acr";
import { createBackendPipeline, createFrontendPipeline } from "./steps/flow";
import { reloadNginx, writeDeployScript, writeNginxConfig } from "./steps/ecs";

type StepHandler = (step: PlanStep, context: StepContext) => Promise<StepResult>;

export const stepRegistry: Record<StepType, StepHandler> = {
  ensureCodeGroup,
  ensureRepository,
  ensureOssBucket,
  ensureDatabase,
  ensureAcrRepository,
  writeDeployScript,
  writeNginxConfig,
  reloadNginx,
  createFrontendPipeline,
  createBackendPipeline
};
