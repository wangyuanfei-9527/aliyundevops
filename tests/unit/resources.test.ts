// =============================================================================
// A3 Resources — Unit Tests
// Tests for name derivation, resource derivation, and manifest assembly.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  toUnderscored,
  toBucketSafe,
  bucketNameFrom,
  dbNameFrom,
  acrRepoNameFrom,
  dnsSplit,
  deployPathFrom,
  nginxConfPathFrom,
  codeGroupPathFrom,
  repositoryPathFrom,
  fullRepositoryPath,
  dnsRecordTypeForProjectType,
  terraformWorkDir,
  terraformStateFile,
} from "@/src/lib/names";
import {
  validateDomain,
  validateInputForDerivation,
  deriveResources,
} from "@/src/resources/derive";
import type { DeriveResourcesOptions } from "@/src/resources/derive";
import {
  assembleManifest,
  assembleResourcePlan,
  defaultTerraformConfig,
} from "@/src/resources/manifest";
import type { ManifestAssemblyInput } from "@/src/resources/manifest";
import type {
  ProjectInput,
  DerivedResources,
  TerraformPlanInfo,
} from "@/src/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const defaultOptions: DeriveResourcesOptions = {
  allowedRootDomains: ["tzxys.cn", "example.com"],
  acrNamespace: "test",
};

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

// =============================================================================
// names.ts — Pure derivation functions
// =============================================================================

describe("toUnderscored", () => {
  it("converts hyphens to underscores and lowercases", () => {
    expect(toUnderscored("My-Project")).toBe("my_project");
  });
  it("handles already-underscored input", () => {
    expect(toUnderscored("my_project")).toBe("my_project");
  });
});

describe("toBucketSafe", () => {
  it("lowercases and replaces non-safe chars with hyphens", () => {
    expect(toBucketSafe("My_Bucket")).toBe("my-bucket");
  });
  it("removes leading/trailing hyphens", () => {
    expect(toBucketSafe("-my-bucket-")).toBe("my-bucket");
  });
  it("collapses multiple hyphens", () => {
    expect(toBucketSafe("my---bucket")).toBe("my-bucket");
  });
});

describe("bucketNameFrom", () => {
  it("derives correct bucket name", () => {
    expect(bucketNameFrom("mall", "admin-web")).toBe("test-mall-admin-web");
  });
  it("handles special characters", () => {
    expect(bucketNameFrom("My_Group", "Test Site")).toBe("test-my-group-test-site");
  });
});

describe("dbNameFrom", () => {
  it("derives correct database name", () => {
    expect(dbNameFrom("mall", "order-service")).toBe("test_mall_order_service");
  });
  it("lowercases everything", () => {
    expect(dbNameFrom("Mall", "OrderService")).toBe("test_mall_orderservice");
  });
});

describe("acrRepoNameFrom", () => {
  it("lowercases the repo name", () => {
    expect(acrRepoNameFrom("Order-Service")).toBe("order-service");
  });
});

describe("dnsSplit", () => {
  it("splits subdomain from root domain", () => {
    const result = dnsSplit("order-test.tzxys.cn", ["tzxys.cn"]);
    expect(result).toEqual({ rr: "order-test", rootDomain: "tzxys.cn" });
  });
  it("handles multiple allowed roots — matches longest first", () => {
    const result = dnsSplit("sub.test.example.com", ["example.com", "test.example.com"]);
    expect(result).toEqual({ rr: "sub", rootDomain: "test.example.com" });
  });
  it("returns '@' for domain equal to root", () => {
    const result = dnsSplit("tzxys.cn", ["tzxys.cn"]);
    expect(result).toEqual({ rr: "@", rootDomain: "tzxys.cn" });
  });
  it("throws for unknown root domain", () => {
    expect(() => dnsSplit("foo.unknown.com", ["tzxys.cn"])).toThrow(
      'Domain "foo.unknown.com" does not match any allowed root domain',
    );
  });
});

describe("deployPathFrom", () => {
  it("derives correct deploy path", () => {
    expect(deployPathFrom("order-service")).toBe("/opt/apps/order-service");
  });
});

describe("nginxConfPathFrom", () => {
  it("derives correct nginx config path", () => {
    expect(nginxConfPathFrom("order-service")).toBe("/etc/nginx/conf.d/order-service.conf");
  });
});

describe("codeGroupPathFrom", () => {
  it("returns group as-is", () => {
    expect(codeGroupPathFrom("mall")).toBe("mall");
  });
});

describe("repositoryPathFrom", () => {
  it("returns name as-is", () => {
    expect(repositoryPathFrom("order-service")).toBe("order-service");
  });
});

describe("fullRepositoryPath", () => {
  it("combines group and name", () => {
    expect(fullRepositoryPath("mall", "order-service")).toBe("mall/order-service");
  });
});

describe("dnsRecordTypeForProjectType", () => {
  it("returns CNAME for frontend", () => {
    expect(dnsRecordTypeForProjectType("frontend")).toBe("CNAME");
  });
  it("returns A for backend", () => {
    expect(dnsRecordTypeForProjectType("backend")).toBe("A");
  });
});

describe("terraformWorkDir", () => {
  it("derives correct work dir", () => {
    expect(terraformWorkDir("mall", "order-service", "/data")).toBe(
      "/data/terraform/mall-order-service",
    );
  });
});

describe("terraformStateFile", () => {
  it("returns standard state filename", () => {
    expect(terraformStateFile()).toBe("terraform.tfstate");
  });
});

// =============================================================================
// derive.ts — Validation and derivation
// =============================================================================

describe("validateDomain", () => {
  it("accepts domain under allowed root", () => {
    const result = validateDomain("order-test.tzxys.cn", ["tzxys.cn"]);
    expect(result.rr).toBe("order-test");
    expect(result.rootDomain).toBe("tzxys.cn");
  });

  it("throws for domain not under any root", () => {
    expect(() => validateDomain("foo.bar.com", ["tzxys.cn"])).toThrow();
  });

  it("throws for empty allowed roots", () => {
    expect(() => validateDomain("foo.tzxys.cn", [])).toThrow("No allowed root domains configured");
  });
});

describe("validateInputForDerivation", () => {
  it("passes for valid backend input", () => {
    const warnings = validateInputForDerivation(backendInput, defaultOptions);
    expect(Array.isArray(warnings)).toBe(true);
  });

  it("passes for valid frontend input", () => {
    const warnings = validateInputForDerivation(frontendInput, defaultOptions);
    expect(Array.isArray(warnings)).toBe(true);
  });

  it("warns when backend has no servicePort", () => {
    const input: ProjectInput = { ...backendInput, servicePort: undefined };
    const warnings = validateInputForDerivation(input, defaultOptions);
    expect(warnings.some((w) => w.includes("servicePort"))).toBe(true);
  });

  it("warns when frontend has servicePort", () => {
    const input: ProjectInput = { ...frontendInput, servicePort: 3000 };
    const warnings = validateInputForDerivation(input, defaultOptions);
    expect(warnings.some((w) => w.includes("servicePort"))).toBe(true);
  });

  it("rejects invalid group characters", () => {
    const input: ProjectInput = { ...backendInput, group: "../../evil" };
    expect(() => validateInputForDerivation(input, defaultOptions)).toThrow("Invalid group");
  });

  it("rejects invalid name characters", () => {
    const input: ProjectInput = { ...backendInput, name: "../evil" };
    expect(() => validateInputForDerivation(input, defaultOptions)).toThrow("Invalid name");
  });

  it("rejects unknown domain", () => {
    const input: ProjectInput = { ...backendInput, domain: "foo.unknown.com" };
    expect(() => validateInputForDerivation(input, defaultOptions)).toThrow();
  });

  it("rejects empty group", () => {
    const input: ProjectInput = { ...backendInput, group: "" };
    expect(() => validateInputForDerivation(input, defaultOptions)).toThrow();
  });

  it("rejects missing type", () => {
    const input = { group: "mall", name: "test", domain: "test.tzxys.cn" } as unknown as ProjectInput;
    expect(() => validateInputForDerivation(input, defaultOptions)).toThrow();
  });
});

describe("deriveResources", () => {
  it("derives correct backend resources", () => {
    const derived = deriveResources(backendInput, defaultOptions);

    expect(derived.codeGroupPath).toBe("mall");
    expect(derived.repositoryPath).toBe("order-service");
    expect(derived.ossBucketName).toBe(""); // no OSS for backend
    expect(derived.databaseName).toBe("test_mall_order_service");
    expect(derived.acrNamespace).toBe("test");
    expect(derived.acrRepoName).toBe("order-service");
    expect(derived.dnsSubdomain).toBe("order-test");
    expect(derived.redisDbIndex).toBe(-1);
  });

  it("derives correct frontend resources", () => {
    const derived = deriveResources(frontendInput, defaultOptions);

    expect(derived.codeGroupPath).toBe("mall");
    expect(derived.repositoryPath).toBe("admin-web");
    expect(derived.ossBucketName).toBe("test-mall-admin-web");
    expect(derived.databaseName).toBe(""); // no DB for frontend
    expect(derived.acrNamespace).toBe(""); // no ACR for frontend
    expect(derived.acrRepoName).toBe(""); // no ACR for frontend
    expect(derived.dnsSubdomain).toBe("admin-test");
    expect(derived.redisDbIndex).toBe(-1);
  });

  it("derives resources for different root domain", () => {
    const input: ProjectInput = {
      group: "my-group",
      name: "my-app",
      type: "backend",
      domain: "my-app.example.com",
    };
    const derived = deriveResources(input, defaultOptions);
    expect(derived.dnsSubdomain).toBe("my-app");
    expect(derived.databaseName).toBe("test_my_group_my_app");
  });
});

// =============================================================================
// manifest.ts — Manifest and ResourcePlan assembly
// =============================================================================

describe("assembleManifest", () => {
  const derivedBackend: DerivedResources = deriveResources(backendInput, defaultOptions);

  const baseParams: ManifestAssemblyInput = {
    input: backendInput,
    derived: derivedBackend,
    yunxiao: {
      codeGroup: { status: "created", path: "mall" },
      repository: { status: "created", path: "order-service", url: "https://codeup.aliyun.com/mall/order-service.git" },
    },
    terraform: {
      workDir: "/data/terraform/mall-order-service",
      statePath: "terraform.tfstate",
      providerVersion: "1.227.0",
      outputs: {
        databaseName: "test_mall_order_service",
        databaseInstanceId: "rm-xxx",
        acrInstanceId: "cri-xxx",
        dnsTarget: "10.0.0.1",
      },
    },
  };

  it("assembles a complete backend manifest", () => {
    const manifest = assembleManifest(baseParams);

    expect(manifest.group).toBe("mall");
    expect(manifest.name).toBe("order-service");
    expect(manifest.type).toBe("backend");
    expect(manifest.codeGroup.status).toBe("created");
    expect(manifest.repository.status).toBe("created");
    expect(manifest.database).toBeDefined();
    expect(manifest.database?.name).toBe("test_mall_order_service");
    expect(manifest.database?.instanceId).toBe("rm-xxx");
    expect(manifest.acrRepository).toBeDefined();
    expect(manifest.acrRepository?.instanceId).toBe("cri-xxx");
    expect(manifest.acrRepository?.namespace).toBe("test");
    expect(manifest.acrRepository?.name).toBe("order-service");
    expect(manifest.dnsRecord.type).toBe("A");
    expect(manifest.dnsRecord.target).toBe("10.0.0.1");
    expect(manifest.dnsRecord.status).toBe("managed");
    expect(manifest.deployPath).toBe("/opt/apps/order-service");
    expect(manifest.nginxConfPath).toBe("/etc/nginx/conf.d/order-service.conf");
    expect(manifest.ossBucket).toBeUndefined(); // no OSS for backend
  });

  it("assembles a complete frontend manifest", () => {
    const derivedFrontend = deriveResources(frontendInput, defaultOptions);
    const params: ManifestAssemblyInput = {
      input: frontendInput,
      derived: derivedFrontend,
      yunxiao: {
        codeGroup: { status: "exists", path: "mall" },
        repository: { status: "created", path: "admin-web" },
      },
      terraform: {
        workDir: "/data/terraform/mall-admin-web",
        statePath: "terraform.tfstate",
        providerVersion: "1.227.0",
        outputs: {
          ossBucketName: "test-mall-admin-web",
          dnsTarget: "oss-cn-hangzhou.aliyuncs.com",
        },
      },
    };

    const manifest = assembleManifest(params);

    expect(manifest.type).toBe("frontend");
    expect(manifest.ossBucket).toBeDefined();
    expect(manifest.ossBucket?.name).toBe("test-mall-admin-web");
    expect(manifest.dnsRecord.type).toBe("CNAME");
    expect(manifest.dnsRecord.target).toBe("oss-cn-hangzhou.aliyuncs.com");
    expect(manifest.database).toBeUndefined();
    expect(manifest.acrRepository).toBeUndefined();
    expect(manifest.deployPath).toBeUndefined();
    expect(manifest.nginxConfPath).toBeUndefined();
  });

  it("includes Redis allocation when provided", () => {
    const manifest = assembleManifest({
      ...baseParams,
      redis: {
        instanceId: "r-xxx",
        host: "r-xxx.redis.rds.aliyuncs.com",
        port: 6379,
        db: 3,
        passwordEnv: "REDIS_PASSWORD",
      },
    });

    expect(manifest.redis).toBeDefined();
    expect(manifest.redis?.db).toBe(3);
    expect(manifest.redis?.passwordEnv).toBe("REDIS_PASSWORD");
  });

  it("works without Terraform outputs (uses derived names as fallback)", () => {
    const manifest = assembleManifest({
      ...baseParams,
      terraform: {
        workDir: "/data/tf",
        statePath: "terraform.tfstate",
        providerVersion: "1.227.0",
        outputs: {},
      },
    });

    expect(manifest.database?.name).toBe("test_mall_order_service"); // from derived
    expect(manifest.database?.instanceId).toBe(""); // no TF output
    expect(manifest.dnsRecord.target).toBe(""); // no TF output
  });

  it("handles existing code group and repository", () => {
    const manifest = assembleManifest({
      ...baseParams,
      yunxiao: {
        codeGroup: { status: "exists", path: "mall" },
        repository: { status: "exists", path: "order-service" },
      },
    });

    expect(manifest.codeGroup.status).toBe("exists");
    expect(manifest.repository.status).toBe("exists");
  });
});

describe("assembleResourcePlan", () => {
  it("assembles a valid ResourcePlan", () => {
    const derived = deriveResources(backendInput, defaultOptions);
    const tfInfo: TerraformPlanInfo = {
      workDir: "/data/terraform/mall-order-service",
      statePath: "terraform.tfstate",
      providerVersion: "1.227.0",
      hasChanges: true,
      createCount: 3,
      updateCount: 0,
      destroyCount: 0,
    };

    const plan = assembleResourcePlan({
      input: backendInput,
      derived,
      terraform: tfInfo,
      warnings: ["servicePort recommended"],
    });

    expect(plan.project).toBe(backendInput);
    expect(plan.derived).toBe(derived);
    expect(plan.terraform).toBe(tfInfo);
    expect(plan.warnings).toEqual(["servicePort recommended"]);
  });
});

describe("defaultTerraformConfig", () => {
  it("returns correct paths", () => {
    const config = defaultTerraformConfig("mall", "order-service", "/data", "1.227.0");
    expect(config.workDir).toBe("/data/terraform/mall-order-service");
    expect(config.statePath).toBe("terraform.tfstate");
    expect(config.providerVersion).toBe("1.227.0");
  });
});
