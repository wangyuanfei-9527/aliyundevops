import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Not implemented", route: "/api/runs/step" },
    { status: 501 }
  );
}
