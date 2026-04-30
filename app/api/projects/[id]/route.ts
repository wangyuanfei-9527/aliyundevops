import { NextResponse } from "next/server";
import { getProject } from "@/storage/projects";
import { readRunLogs } from "@/storage/logs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) return NextResponse.json({ errors: ["项目不存在。"] }, { status: 404 });
  const logs = await readRunLogs(project.runId);
  return NextResponse.json({ project, logs });
}
