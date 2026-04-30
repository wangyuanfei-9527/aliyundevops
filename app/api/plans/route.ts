import { NextResponse } from "next/server";
import type { ProjectInput } from "@/types";
import { loadConfig } from "@/config/config";
import { createExecutionPlan } from "@/ai/planner";
import { validateProjectInput, validatePlan } from "@/ai/schemas";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ProjectInput;
    const config = loadConfig();
    const { input, errors } = validateProjectInput(body, config.domain.allowedRoot);
    if (errors.length > 0) {
      return NextResponse.json({ errors }, { status: 400 });
    }

    const plan = await createExecutionPlan(input, config);
    const planErrors = validatePlan(plan, config.domain.allowedRoot);
    if (planErrors.length > 0) {
      return NextResponse.json({ errors: planErrors }, { status: 400 });
    }

    return NextResponse.json({ plan });
  } catch (error) {
    return NextResponse.json(
      { errors: [error instanceof Error ? error.message : String(error)] },
      { status: 500 }
    );
  }
}
