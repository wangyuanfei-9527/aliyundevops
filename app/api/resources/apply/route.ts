import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Not implemented", route: "/api/resources/apply" },
    { status: 501 }
  );
}
