// =============================================================================
// API Response Helpers — A9 API
// Unified JSON response helpers for all route handlers.
// =============================================================================

import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Success responses
// ---------------------------------------------------------------------------

export function success(data: unknown, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status });
}

// ---------------------------------------------------------------------------
// Error responses
// ---------------------------------------------------------------------------

export function badRequest(message: string, details?: string): NextResponse {
  return NextResponse.json(
    { ok: false, error: message, details },
    { status: 400 },
  );
}

export function notFound(message: string): NextResponse {
  return NextResponse.json(
    { ok: false, error: message },
    { status: 404 },
  );
}

export function forbidden(message: string): NextResponse {
  return NextResponse.json(
    { ok: false, error: message },
    { status: 403 },
  );
}

export function internalError(message: string, details?: string): NextResponse {
  return NextResponse.json(
    { ok: false, error: message, details },
    { status: 500 },
  );
}

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

/**
 * Parse JSON body from a Next.js Request.
 * Returns parsed data or null if invalid.
 */
export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
