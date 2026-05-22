// =============================================================================
// Application Configuration Loader — A9 API
// Loads config from environment variables + optional local.json overrides.
// Provides typed access to all service-layer configuration.
// =============================================================================

import fs from "fs";
import path from "path";
import type { AppConfig } from "@/src/types";

// ---------------------------------------------------------------------------
// Local config file
// ---------------------------------------------------------------------------

interface LocalConfig {
  aliyun?: { region?: string };
  yunxiao?: { organizationId?: string; baseUrl?: string };
  terraform?: { templateDir?: string; dataDir?: string; providerVersion?: string };
  redis?: { instanceId?: string; host?: string; port?: number; passwordEnv?: string; maxDatabases?: number };
  defaults?: { servicePort?: number; dnsTTL?: number };
  dns?: { allowedRootDomains?: string[] };
  acr?: { namespace?: string };
  ecs?: { publicIp?: string };
  rds?: { instanceId?: string; characterSet?: string };
  acrInstance?: { id?: string };
  oss?: { endpoint?: string };
}

function loadLocalConfig(): LocalConfig {
  const configPath = path.join(process.cwd(), "src/config/local.json");
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(content) as LocalConfig;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

const localConfig = loadLocalConfig();

function env(key: string, fallback: string): string;
function env(key: string): string | undefined;
function env(key: string, fallback?: string): string | undefined {
  const value = process.env[key];
  if (value !== undefined) return value;
  return fallback;
}

function envRequired(key: string, fallback?: string): string {
  const value = env(key, fallback ?? "");
  if (!value) {
    throw new Error(`Required configuration "${key}" is not set`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Exported config
// ---------------------------------------------------------------------------

export function getAppConfig(): AppConfig {
  return {
    aliyun: {
      region: env("ALIYUN_REGION", localConfig.aliyun?.region ?? "cn-hangzhou"),
    },
    yunxiao: {
      organizationId: envRequired("YUNXIAO_ORG_ID", localConfig.yunxiao?.organizationId),
      baseUrl: env("YUNXIAO_BASE_URL", localConfig.yunxiao?.baseUrl ?? "https://devops.cn-hangzhou.aliyuncs.com"),
    },
    terraform: {
      templateDir: env("TERRAFORM_TEMPLATE_DIR", localConfig.terraform?.templateDir ?? "templates/terraform"),
      dataDir: env("TERRAFORM_DATA_DIR", localConfig.terraform?.dataDir ?? "data"),
      providerVersion: env("TERRAFORM_PROVIDER_VERSION", localConfig.terraform?.providerVersion ?? "1.209.0"),
    },
    redis: {
      instanceId: envRequired("REDIS_INSTANCE_ID", localConfig.redis?.instanceId),
      host: envRequired("REDIS_HOST", localConfig.redis?.host),
      port: Number(env("REDIS_PORT", String(localConfig.redis?.port ?? 6379))),
      passwordEnv: env("REDIS_PASSWORD_ENV", localConfig.redis?.passwordEnv ?? "REDIS_PASSWORD"),
      maxDatabases: Number(env("REDIS_MAX_DATABASES", String(localConfig.redis?.maxDatabases ?? 16))),
    },
    defaults: {
      servicePort: Number(env("DEFAULT_SERVICE_PORT", String(localConfig.defaults?.servicePort ?? 8080))),
      dnsTTL: Number(env("DNS_TTL", String(localConfig.defaults?.dnsTTL ?? 600))),
    },
  };
}

// ---------------------------------------------------------------------------
// Extended config for resource derivation
// ---------------------------------------------------------------------------

export interface ExtendedConfig extends AppConfig {
  dns: {
    allowedRootDomains: string[];
  };
  acr: {
    namespace: string;
  };
  ecs: {
    publicIp: string;
  };
  rds: {
    instanceId: string;
    characterSet: string;
  };
  acrInstance: {
    id: string;
  };
  oss: {
    endpoint: string;
  };
}

export function getExtendedConfig(): ExtendedConfig {
  const base = getAppConfig();

  // DNS root domains: prefer local config array, then env comma-separated
  const localRoots = localConfig.dns?.allowedRootDomains;
  const envRoots = env("DNS_ROOT_DOMAINS", "");
  const allowedRootDomains = localRoots && localRoots.length > 0
    ? localRoots
    : envRoots.split(",").filter(Boolean);

  return {
    ...base,
    dns: {
      allowedRootDomains,
    },
    acr: {
      namespace: env("ACR_NAMESPACE", localConfig.acr?.namespace ?? "test"),
    },
    ecs: {
      publicIp: envRequired("ECS_PUBLIC_IP", localConfig.ecs?.publicIp),
    },
    rds: {
      instanceId: envRequired("RDS_INSTANCE_ID", localConfig.rds?.instanceId),
      characterSet: env("RDS_CHARACTER_SET", localConfig.rds?.characterSet ?? "utf8mb4"),
    },
    acrInstance: {
      id: envRequired("ACR_INSTANCE_ID", localConfig.acrInstance?.id),
    },
    oss: {
      endpoint: env("OSS_ENDPOINT", localConfig.oss?.endpoint ?? `oss-${base.aliyun.region}.aliyuncs.com`),
    },
  };
}

// ---------------------------------------------------------------------------
// Data directory helper
// ---------------------------------------------------------------------------

export function getDataDir(): string {
  return getAppConfig().terraform.dataDir;
}
