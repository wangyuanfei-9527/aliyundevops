// =============================================================================
// Terraform Template Renderer — A4 Terraform
// Renders HCL templates + tfvars into the project work directory.
// =============================================================================

import fs from "fs";
import path from "path";
import type { ProjectInput, DerivedResources } from "@/src/types";
import { renderTemplateToFile } from "@/src/lib/renderTemplate";
import { safePath } from "@/src/lib/paths";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TerraformTemplateVars = Record<string, string> & {
  region: string;
  project_key: string;
  providerVersion: string;
  root_domain: string;
  dns_rr: string;
  ecs_public_ip: string;
  oss_endpoint: string;
  rds_instance_id: string;
  rds_character_set: string;
  database_name: string;
  acr_instance_id: string;
  acr_namespace: string;
  acr_repo_name: string;
  oss_bucket: string;
};

export interface TerraformDataConfig {
  templateDir: string;
  dataDir: string;
  providerVersion: string;
  region: string;
  ecsPublicIp: string;
  rdsInstanceId: string;
  acrInstanceId: string;
  ossEndpoint: string;
}

// ---------------------------------------------------------------------------
// Compute template variables from project input and config
// ---------------------------------------------------------------------------

/**
 * Build the template variable map from project input, derived resources, and config.
 */
export function computeTemplateVars(
  input: ProjectInput,
  derived: DerivedResources,
  config: TerraformDataConfig,
): TerraformTemplateVars {
  const dnsParts = input.domain.split(".");
  const rootDomain = dnsParts.length > 1 ? dnsParts.slice(-2).join(".") : input.domain;

  return {
    region: config.region,
    project_key: `${input.group}-${input.name}`,
    providerVersion: config.providerVersion,
    root_domain: derived.dnsSubdomain === "@" ? rootDomain : rootDomain,
    dns_rr: derived.dnsSubdomain,
    ecs_public_ip: config.ecsPublicIp,
    oss_endpoint: config.ossEndpoint,
    rds_instance_id: config.rdsInstanceId,
    rds_character_set: "utf8mb4",
    database_name: derived.databaseName,
    acr_instance_id: config.acrInstanceId,
    acr_namespace: derived.acrNamespace,
    acr_repo_name: derived.acrRepoName,
    oss_bucket: derived.ossBucketName,
  };
}

// ---------------------------------------------------------------------------
// Render terraform.tfvars content
// ---------------------------------------------------------------------------

/**
 * Generate terraform.tfvars content from template variables.
 */
export function generateTfvars(vars: TerraformTemplateVars): string {
  const lines: string[] = [
    `region = "${vars.region}"`,
    `project_key = "${vars.project_key}"`,
    `root_domain = "${vars.root_domain}"`,
    `dns_rr = "${vars.dns_rr}"`,
    `ecs_public_ip = "${vars.ecs_public_ip}"`,
    `oss_endpoint = "${vars.oss_endpoint}"`,
    `rds_instance_id = "${vars.rds_instance_id}"`,
    `rds_character_set = "${vars.rds_character_set}"`,
    `database_name = "${vars.database_name}"`,
    `acr_instance_id = "${vars.acr_instance_id}"`,
    `acr_namespace = "${vars.acr_namespace}"`,
    `acr_repo_name = "${vars.acr_repo_name}"`,
    `oss_bucket = "${vars.oss_bucket}"`,
  ];
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

/**
 * Render all Terraform files into the project work directory.
 *
 * Files generated:
 * - main.tf (from main.tf.hbs)
 * - variables.tf (from variables.tf.hbs)
 * - resources.tf (from resources-backend.tf.hbs or resources-frontend.tf.hbs)
 * - outputs.tf (from outputs.tf.hbs)
 * - terraform.tfvars (generated from vars)
 *
 * @returns Path to the work directory
 */
export function renderTerraformFiles(
  input: ProjectInput,
  derived: DerivedResources,
  config: TerraformDataConfig,
): { workDir: string; vars: TerraformTemplateVars } {
  const validatedWorkDir = safePath(config.dataDir, `terraform/${input.group}-${input.name}`);

  const vars = computeTemplateVars(input, derived, config);
  const templateDir = config.templateDir;

  // Ensure work directory exists
  fs.mkdirSync(validatedWorkDir, { recursive: true });

  // Render shared templates
  const sharedTemplates = ["main.tf.hbs", "variables.tf.hbs", "outputs.tf.hbs"];
  for (const tmpl of sharedTemplates) {
    const templatePath = path.join(templateDir, tmpl);
    if (fs.existsSync(templatePath)) {
      renderTemplateToFile(templatePath, validatedWorkDir, vars);
    }
  }

  // Render type-specific resource template
  const resourceTemplate =
    input.type === "frontend" ? "resources-frontend.tf.hbs" : "resources-backend.tf.hbs";
  const resourceTemplatePath = path.join(templateDir, resourceTemplate);
  if (fs.existsSync(resourceTemplatePath)) {
    const rendered = renderTemplateToFile(resourceTemplatePath, validatedWorkDir, vars);
    // Rename to resources.tf
    const targetPath = path.join(validatedWorkDir, "resources.tf");
    if (rendered !== targetPath) {
      fs.renameSync(rendered, targetPath);
    }
  }

  // Generate terraform.tfvars
  const tfvarsContent = generateTfvars(vars);
  fs.writeFileSync(path.join(validatedWorkDir, "terraform.tfvars"), tfvarsContent, "utf-8");

  return { workDir: validatedWorkDir, vars };
}
