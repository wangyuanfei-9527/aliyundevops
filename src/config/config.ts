import { existsSync, readFileSync } from "fs";
import path from "path";
import type { AppConfig } from "@/types";

const root = process.cwd();

const defaultConfig: AppConfig = {
  executionMode: "dry-run",
  aliyun: {
    region: "cn-hangzhou",
    profile: "default",
    ossEndpoint: "oss-cn-hangzhou.aliyuncs.com"
  },
  yunxiao: {
    domain: "https://devops.aliyun.com",
    organizationId: "",
    tokenEnv: "YUNXIAO_TOKEN"
  },
  flow: {
    runnerGroup: "public/cn-hangzhou",
    container: "build-steps-public-registry.cn-hangzhou.cr.aliyuncs.com/build-steps/alinux3:latest"
  },
  rds: {
    instanceId: "",
    defaultCharset: "utf8mb4"
  },
  acr: {
    instanceId: "",
    namespace: "test"
  },
  ecs: {
    testInstanceId: "",
    appRoot: "/opt/apps",
    nginxConfDir: "/etc/nginx/conf.d"
  },
  domain: {
    allowedRoot: ""
  },
  ai: {
    provider: "local",
    model: "gpt-5.2"
  }
};

function mergeConfig(base: AppConfig, override: Partial<AppConfig>): AppConfig {
  return {
    ...base,
    ...override,
    aliyun: { ...base.aliyun, ...override.aliyun },
    yunxiao: { ...base.yunxiao, ...override.yunxiao },
    flow: { ...base.flow, ...override.flow },
    rds: { ...base.rds, ...override.rds },
    acr: { ...base.acr, ...override.acr },
    ecs: { ...base.ecs, ...override.ecs },
    domain: { ...base.domain, ...override.domain },
    ai: { ...base.ai, ...override.ai }
  };
}

export function loadConfig(): AppConfig {
  const localPath = path.join(root, "src", "config", "local.json");
  let config = defaultConfig;

  if (existsSync(localPath)) {
    const parsed = JSON.parse(readFileSync(localPath, "utf8")) as Partial<AppConfig>;
    config = mergeConfig(config, parsed);
  }

  const executionMode =
    process.env.EXECUTION_MODE === "live" ? "live" : config.executionMode;

  const aiProvider =
    process.env.OPENAI_API_KEY && process.env.AI_PLANNER_MODE !== "local"
      ? "openai"
      : config.ai.provider;

  return mergeConfig(config, {
    executionMode,
    ai: {
      provider: aiProvider,
      model: process.env.OPENAI_MODEL || config.ai.model
    }
  });
}

export function getYunxiaoToken(config: AppConfig) {
  return process.env[config.yunxiao.tokenEnv] || process.env.YUNXIAO_TOKEN || "";
}
