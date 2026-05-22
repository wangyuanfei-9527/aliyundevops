// =============================================================================
// OSS Step Executors — A8 Runner
// Handles OSS static website configuration.
// All operations go through IOssAdapter — no direct OSS API calls.
// =============================================================================

import type { StepContext, StepResult } from "@/src/runner/stepRegistry";

// ---------------------------------------------------------------------------
// Phase 3: OSS website configuration
// ---------------------------------------------------------------------------

/** configureOssWebsite — configure static website hosting on the OSS bucket */
export async function configureOssWebsite(ctx: StepContext): Promise<StepResult> {
  const bucket = ctx.plan.manifest.ossBucket;
  if (!bucket) {
    return { success: false, message: "No OSS bucket in resource manifest" };
  }

  const indexPage = ctx.step.params?.indexPage ?? "index.html";
  const errorPage = ctx.step.params?.errorPage ?? "error.html";

  const result = await ctx.adapters.oss.configureWebsite(bucket.name, indexPage, errorPage);

  return {
    success: result.success,
    message: result.success
      ? `OSS website configured on bucket "${bucket.name}" (index: ${indexPage}, error: ${errorPage})`
      : `Failed to configure OSS website on bucket "${bucket.name}"`,
  };
}
