// =============================================================================
// POST /api/resources/derive — A9 API
// Deterministic resource name derivation. No cloud calls, no side effects.
// =============================================================================

import { validateInputForDerivation, deriveResources } from "@/src/resources/derive";
import { validateProjectInput } from "@/src/ai/schemas";
import { getExtendedConfig } from "@/src/config/config";
import { success, badRequest, internalError, parseJsonBody } from "@/src/lib/apiResponse";

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request);
    if (!body) {
      return badRequest("Request body must be valid JSON");
    }

    // Validate input schema
    const validation = validateProjectInput(body);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      return badRequest("Invalid project input", issues);
    }

    const input = validation.data;
    const config = getExtendedConfig();

    // Validate for derivation (path safety + domain)
    let warnings: string[];
    try {
      warnings = validateInputForDerivation(input, {
        allowedRootDomains: config.dns.allowedRootDomains,
        acrNamespace: config.acr.namespace,
      });
    } catch (err) {
      return badRequest((err as Error).message);
    }

    // Derive resource names (pure function)
    const derived = deriveResources(input, {
      allowedRootDomains: config.dns.allowedRootDomains,
      acrNamespace: config.acr.namespace,
    });

    return success({ input, derived, warnings });
  } catch (err) {
    return internalError("Resource derivation failed", (err as Error).message);
  }
}
