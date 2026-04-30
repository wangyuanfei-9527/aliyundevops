import type { ProjectInput } from "@/types";
import { shortHash } from "./ids";

export function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function dbNameFrom(group: string, name: string) {
  return `test_${group}_${name}`.replaceAll("-", "_").slice(0, 64);
}

export function bucketNameFrom(group: string, name: string) {
  const base = `test-${group}-${name}`.slice(0, 54);
  return `${base}-${shortHash(`${group}/${name}`, 6)}`;
}

export function acrRepositoryFrom(group: string, name: string) {
  return `${group}/${name}`;
}

export function normalizeInput(input: ProjectInput): ProjectInput {
  return {
    ...input,
    group: normalizeSlug(input.group),
    name: normalizeSlug(input.name),
    domain: input.domain.trim().toLowerCase(),
    buildCommand: input.buildCommand?.trim() || undefined,
    artifactDir: input.artifactDir?.trim() || undefined,
    servicePort: input.servicePort
  };
}

export function defaultBuildCommand(type: ProjectInput["type"]) {
  return type === "frontend" ? "pnpm install && pnpm build" : "docker build";
}
