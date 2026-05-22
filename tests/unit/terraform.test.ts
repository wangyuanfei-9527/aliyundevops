// =============================================================================
// A4 Terraform — Unit Tests
// Tests for template rendering, plan/output parsing, and executor behavior.
// =============================================================================

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { renderTemplateString, renderTemplateToFile } from "@/src/lib/renderTemplate";
import {
  computeTemplateVars,
  generateTfvars,
  renderTerraformFiles,
  type TerraformDataConfig,
} from "@/src/terraform/render";
import {
  parsePlanSummary,
  parsePlanOutput,
  parseOutputJson,
} from "@/src/terraform/parser";
import { terraformApply } from "@/src/terraform/executor";
import type { ProjectInput, DerivedResources } from "@/src/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const backendInput: ProjectInput = {
  group: "mall",
  name: "order-service",
  type: "backend",
  domain: "order-test.tzxys.cn",
  servicePort: 18080,
};

const frontendInput: ProjectInput = {
  group: "mall",
  name: "admin-web",
  type: "frontend",
  domain: "admin-test.tzxys.cn",
};

const derivedBackend: DerivedResources = {
  codeGroupPath: "mall",
  repositoryPath: "order-service",
  ossBucketName: "",
  databaseName: "test_mall_order_service",
  acrNamespace: "test",
  acrRepoName: "order-service",
  dnsSubdomain: "order-test",
  redisDbIndex: -1,
};

const derivedFrontend: DerivedResources = {
  codeGroupPath: "mall",
  repositoryPath: "admin-web",
  ossBucketName: "test-mall-admin-web",
  databaseName: "",
  acrNamespace: "",
  acrRepoName: "",
  dnsSubdomain: "admin-test",
  redisDbIndex: -1,
};

const defaultConfig: TerraformDataConfig = {
  templateDir: "templates/terraform",
  dataDir: "",
  providerVersion: "~> 1.278",
  region: "cn-hangzhou",
  ecsPublicIp: "10.0.0.1",
  rdsInstanceId: "rm-xxx",
  acrInstanceId: "cri-xxx",
  ossEndpoint: "oss-cn-hangzhou.aliyuncs.com",
};

// =============================================================================
// renderTemplate.ts
// =============================================================================

describe("renderTemplateString", () => {
  it("renders a simple template", () => {
    const result = renderTemplateString("Hello {{name}}!", { name: "world" });
    expect(result).toBe("Hello world!");
  });

  it("handles numeric values", () => {
    const result = renderTemplateString("Port: {{port}}", { port: 8080 });
    expect(result).toBe("Port: 8080");
  });

  it("handles boolean values", () => {
    const result = renderTemplateString("Enabled: {{enabled}}", { enabled: true });
    expect(result).toBe("Enabled: true");
  });

  it("handles missing context gracefully (empty string)", () => {
    const result = renderTemplateString("Value: {{missing}}", {});
    expect(result).toBe("Value: ");
  });
});

describe("renderTemplateToFile", () => {
  it("renders template and writes file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-test-"));
    const templatePath = path.join(tmpDir, "test.tf.hbs");
    fs.writeFileSync(templatePath, 'region = "{{region}}"', "utf-8");

    const outputPath = renderTemplateToFile(templatePath, tmpDir, { region: "cn-hangzhou" });

    expect(outputPath).toBe(path.join(tmpDir, "test.tf"));
    expect(fs.readFileSync(outputPath, "utf-8")).toBe('region = "cn-hangzhou"');

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("creates target directory if it does not exist", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-test-"));
    const templatePath = path.join(tmpDir, "test.tf.hbs");
    fs.writeFileSync(templatePath, "content", "utf-8");

    const nestedDir = path.join(tmpDir, "nested", "dir");
    const outputPath = renderTemplateToFile(templatePath, nestedDir, {});

    expect(fs.existsSync(outputPath)).toBe(true);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// =============================================================================
// render.ts — Template variable computation and tfvars generation
// =============================================================================

describe("computeTemplateVars", () => {
  it("computes correct vars for backend", () => {
    const vars = computeTemplateVars(backendInput, derivedBackend, defaultConfig);

    expect(vars.region).toBe("cn-hangzhou");
    expect(vars.project_key).toBe("mall-order-service");
    expect(vars.dns_rr).toBe("order-test");
    expect(vars.ecs_public_ip).toBe("10.0.0.1");
    expect(vars.database_name).toBe("test_mall_order_service");
    expect(vars.rds_instance_id).toBe("rm-xxx");
    expect(vars.acr_instance_id).toBe("cri-xxx");
    expect(vars.acr_namespace).toBe("test");
    expect(vars.acr_repo_name).toBe("order-service");
    expect(vars.oss_bucket).toBe("");
  });

  it("computes correct vars for frontend", () => {
    const vars = computeTemplateVars(frontendInput, derivedFrontend, defaultConfig);

    expect(vars.oss_bucket).toBe("test-mall-admin-web");
    expect(vars.database_name).toBe("");
    expect(vars.acr_repo_name).toBe("");
    expect(vars.dns_rr).toBe("admin-test");
  });
});

describe("generateTfvars", () => {
  it("generates valid tfvars content", () => {
    const vars = computeTemplateVars(backendInput, derivedBackend, defaultConfig);
    const tfvars = generateTfvars(vars);

    expect(tfvars).toContain('region = "cn-hangzhou"');
    expect(tfvars).toContain('project_key = "mall-order-service"');
    expect(tfvars).toContain('dns_rr = "order-test"');
    expect(tfvars).toContain('database_name = "test_mall_order_service"');
    expect(tfvars).toContain('oss_bucket = ""');
  });
});

describe("renderTerraformFiles", () => {
  it("renders all files for a backend project", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-render-"));
    const templateDir = path.join(tmpDir, "templates");
    const dataDir = path.join(tmpDir, "data");

    // Copy real templates
    fs.mkdirSync(templateDir, { recursive: true });
    const realTemplates = [
      "main.tf.hbs",
      "variables.tf.hbs",
      "resources-backend.tf.hbs",
      "resources-frontend.tf.hbs",
      "outputs.tf.hbs",
    ];
    for (const tmpl of realTemplates) {
      const src = path.join("templates", "terraform", tmpl);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(templateDir, tmpl));
      }
    }

    const config: TerraformDataConfig = { ...defaultConfig, templateDir, dataDir };
    const result = renderTerraformFiles(backendInput, derivedBackend, config);

    // Verify work dir was created
    expect(fs.existsSync(result.workDir)).toBe(true);

    // Verify key files exist
    expect(fs.existsSync(path.join(result.workDir, "main.tf"))).toBe(true);
    expect(fs.existsSync(path.join(result.workDir, "variables.tf"))).toBe(true);
    expect(fs.existsSync(path.join(result.workDir, "resources.tf"))).toBe(true);
    expect(fs.existsSync(path.join(result.workDir, "outputs.tf"))).toBe(true);
    expect(fs.existsSync(path.join(result.workDir, "terraform.tfvars"))).toBe(true);

    // Verify main.tf contains provider config
    const mainTf = fs.readFileSync(path.join(result.workDir, "main.tf"), "utf-8");
    expect(mainTf).toContain("aliyun/alicloud");
    expect(mainTf).toContain("~> 1.278");

    // Verify resources.tf contains backend resources
    const resourcesTf = fs.readFileSync(path.join(result.workDir, "resources.tf"), "utf-8");
    expect(resourcesTf).toContain("alicloud_db_database");
    expect(resourcesTf).toContain("alicloud_cr_ee_repo");
    expect(resourcesTf).toContain("alicloud_alidns_record");
    expect(resourcesTf).toContain('type        = "A"');

    // Verify tfvars content
    const tfvars = fs.readFileSync(path.join(result.workDir, "terraform.tfvars"), "utf-8");
    expect(tfvars).toContain('database_name = "test_mall_order_service"');
    expect(tfvars).toContain('dns_rr = "order-test"');

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("renders frontend resources correctly", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-render-"));
    const templateDir = path.join(tmpDir, "templates");
    const dataDir = path.join(tmpDir, "data");

    fs.mkdirSync(templateDir, { recursive: true });
    const realTemplates = [
      "main.tf.hbs",
      "variables.tf.hbs",
      "resources-backend.tf.hbs",
      "resources-frontend.tf.hbs",
      "outputs.tf.hbs",
    ];
    for (const tmpl of realTemplates) {
      const src = path.join("templates", "terraform", tmpl);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(templateDir, tmpl));
      }
    }

    const config: TerraformDataConfig = { ...defaultConfig, templateDir, dataDir };
    const result = renderTerraformFiles(frontendInput, derivedFrontend, config);

    const resourcesTf = fs.readFileSync(path.join(result.workDir, "resources.tf"), "utf-8");
    expect(resourcesTf).toContain("alicloud_oss_bucket");
    expect(resourcesTf).toContain("alicloud_oss_bucket_acl");
    expect(resourcesTf).toContain('type        = "CNAME"');
    expect(resourcesTf).not.toContain("alicloud_db_database");

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("rejects path traversal in group/name", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-render-"));
    const maliciousInput: ProjectInput = {
      group: "evil",
      name: "../../../../etc",
      type: "backend",
      domain: "test.tzxys.cn",
    };
    const derived: DerivedResources = {
      ...derivedBackend,
      repositoryPath: "../../../../etc",
      databaseName: "test_evil___etc",
      acrRepoName: "../../../../etc",
    };

    expect(() =>
      renderTerraformFiles(maliciousInput, derived, {
        ...defaultConfig,
        templateDir: tmpDir,
        dataDir: tmpDir,
      }),
    ).toThrow();

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// =============================================================================
// parser.ts — Plan and output parsing
// =============================================================================

describe("parsePlanSummary", () => {
  it("parses standard plan output", () => {
    const output = `
Terraform will perform the following actions:

  + alicloud_db_database.main will be created
  + alicloud_cr_ee_repo.main will be created
  + alicloud_alidns_record.main will be created

Plan: 3 to add, 0 to change, 0 to destroy.
`;
    const summary = parsePlanSummary(output);
    expect(summary.createCount).toBe(3);
    expect(summary.updateCount).toBe(0);
    expect(summary.destroyCount).toBe(0);
  });

  it("parses plan with changes and destroys", () => {
    const output = "Plan: 1 to add, 2 to change, 1 to destroy.";
    const summary = parsePlanSummary(output);
    expect(summary.createCount).toBe(1);
    expect(summary.updateCount).toBe(2);
    expect(summary.destroyCount).toBe(1);
  });

  it("parses no-changes output", () => {
    const output = "No changes. Your infrastructure matches the configuration.";
    const summary = parsePlanSummary(output);
    expect(summary.createCount).toBe(0);
    expect(summary.updateCount).toBe(0);
    expect(summary.destroyCount).toBe(0);
  });

  it("returns zeros for unparseable output", () => {
    const summary = parsePlanSummary("some random output without plan summary");
    expect(summary.createCount).toBe(0);
    expect(summary.updateCount).toBe(0);
    expect(summary.destroyCount).toBe(0);
  });
});

describe("parsePlanOutput", () => {
  it("assembles TerraformPlanInfo from plan output", () => {
    const output = "Plan: 3 to add, 0 to change, 0 to destroy.";
    const info = parsePlanOutput(output, "/workdir", "terraform.tfstate", "~> 1.278");

    expect(info.workDir).toBe("/workdir");
    expect(info.statePath).toBe("terraform.tfstate");
    expect(info.providerVersion).toBe("~> 1.278");
    expect(info.hasChanges).toBe(true);
    expect(info.createCount).toBe(3);
    expect(info.updateCount).toBe(0);
    expect(info.destroyCount).toBe(0);
  });

  it("sets hasChanges=false for no-changes plan", () => {
    const output = "No changes. Your infrastructure matches the configuration.";
    const info = parsePlanOutput(output, "/workdir", "terraform.tfstate", "~> 1.278");
    expect(info.hasChanges).toBe(false);
  });
});

describe("parseOutputJson", () => {
  it("parses terraform output JSON", () => {
    const json = JSON.stringify({
      dns_record: { value: "order-test.tzxys.cn" },
      database_name: { value: "test_mall_order_service" },
      database_instance_id: { value: "rm-xxx" },
      acr_repo_name: { value: "order-service" },
      acr_instance_id: { value: "cri-xxx" },
      oss_bucket: { value: "" },
    });
    const outputs = parseOutputJson(json);

    expect(outputs.dns_record).toBe("order-test.tzxys.cn");
    expect(outputs.database_name).toBe("test_mall_order_service");
    expect(outputs.database_instance_id).toBe("rm-xxx");
    expect(outputs.acr_repo_name).toBe("order-service");
    expect(outputs.acr_instance_id).toBe("cri-xxx");
    expect(outputs.oss_bucket).toBeUndefined(); // empty string is filtered
  });

  it("parses frontend outputs", () => {
    const json = JSON.stringify({
      dns_record: { value: "admin-test.tzxys.cn" },
      oss_bucket: { value: "test-mall-admin-web" },
    });
    const outputs = parseOutputJson(json);

    expect(outputs.oss_bucket).toBe("test-mall-admin-web");
    expect(outputs.dns_record).toBe("admin-test.tzxys.cn");
    expect(outputs.database_name).toBeUndefined();
  });

  it("returns empty object for invalid JSON", () => {
    const outputs = parseOutputJson("not valid json");
    expect(outputs).toEqual({});
  });

  it("returns empty object for empty string", () => {
    const outputs = parseOutputJson("");
    expect(outputs).toEqual({});
  });
});

// =============================================================================
// executor.ts — Authorization guard tests (no real terraform calls)
// =============================================================================

describe("terraformApply authorization", () => {
  it("rejects apply without authorization", async () => {
    const result = await terraformApply(
      {
        workDir: "/tmp/test",
        providerVersion: "~> 1.278",
      },
      false,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("authorization");
    expect(result.rawOutput).toBe("");
  });

  it("rejects apply with default (no authorized param)", async () => {
    const result = await terraformApply({
      workDir: "/tmp/test",
      providerVersion: "~> 1.278",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("authorization");
  });
});
