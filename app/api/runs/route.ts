import { NextResponse } from "next/server";
import type { ExecutionPlan } from "@/types";
import { runProjectPlan } from "@/runner/runProject";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { plan: ExecutionPlan };
    if (!body.plan) {
      return NextResponse.json({ errors: ["缺少执行计划。"] }, { status: 400 });
    }
    const result = await runProjectPlan(body.plan);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { errors: [error instanceof Error ? error.message : String(error)] },
      { status: 500 }
    );
  }
}
