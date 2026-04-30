import type { PlanStep, StepContext, StepResult } from "@/types";
import { formatCommand, runCommand } from "@/lib/commands";
import { renderTemplate } from "@/lib/templates";

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

async function runEcsShell(context: StepContext, name: string, script: string) {
  const args = [
    "ecs",
    "RunCommand",
    "--region",
    context.config.aliyun.region,
    "--Type",
    "RunShellScript",
    "--Name",
    name,
    "--InstanceId.1",
    context.config.ecs.testInstanceId,
    "--CommandContent",
    script
  ];

  if (context.config.executionMode === "dry-run") {
    return { dryRun: true, command: formatCommand("aliyun", args) };
  }

  if (!context.config.ecs.testInstanceId) {
    throw new Error("Missing ecs.testInstanceId in local config.");
  }
  const result = await runCommand("aliyun", args);
  if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout || "RunCommand failed");
  return { dryRun: false, stdout: result.stdout, stderr: result.stderr };
}

export async function writeDeployScript(
  step: PlanStep,
  context: StepContext
): Promise<StepResult> {
  const deployPath = String(step.params.deployPath || context.plan.resources.deployPath);
  const servicePort = Number(step.params.servicePort || context.plan.project.servicePort || 18080);
  const repository = context.plan.resources.acrRepository || context.plan.project.name;
  const deployScript = await renderTemplate("deploy.sh.hbs", {
    projectName: context.plan.project.name,
    servicePort,
    image: `${context.config.acr.namespace}/${repository}:latest`
  });
  const compose = await renderTemplate("docker-compose.yml.hbs", {
    projectName: context.plan.project.name,
    servicePort,
    image: `${context.config.acr.namespace}/${repository}:latest`
  });
  const script = [
    `mkdir -p ${shellQuote(deployPath)}`,
    `cat > ${shellQuote(`${deployPath}/deploy.sh`)} <<'EOF_DEPLOY'`,
    deployScript,
    "EOF_DEPLOY",
    `cat > ${shellQuote(`${deployPath}/docker-compose.yml`)} <<'EOF_COMPOSE'`,
    compose,
    "EOF_COMPOSE",
    `chmod +x ${shellQuote(`${deployPath}/deploy.sh`)}`
  ].join("\n");
  const result = await runEcsShell(context, `${context.plan.project.name}-write-deploy`, script);

  return {
    step: step.type,
    status: "success",
    resourceId: deployPath,
    message:
      context.config.executionMode === "dry-run"
        ? `dry-run: would write deploy files to ${deployPath}`
        : `deploy files written to ${deployPath}`,
    data: result
  };
}

export async function writeNginxConfig(
  step: PlanStep,
  context: StepContext
): Promise<StepResult> {
  const nginxConfPath = String(step.params.nginxConfPath || context.plan.resources.nginxConfPath);
  const servicePort = Number(step.params.servicePort || context.plan.project.servicePort || 18080);
  const nginxConf = await renderTemplate("nginx.conf.hbs", {
    domain: context.plan.project.domain,
    servicePort
  });
  const script = [
    `cat > ${shellQuote(nginxConfPath)} <<'EOF_NGINX'`,
    nginxConf,
    "EOF_NGINX"
  ].join("\n");
  const result = await runEcsShell(context, `${context.plan.project.name}-write-nginx`, script);

  return {
    step: step.type,
    status: "success",
    resourceId: nginxConfPath,
    message:
      context.config.executionMode === "dry-run"
        ? `dry-run: would write Nginx config to ${nginxConfPath}`
        : `Nginx config written to ${nginxConfPath}`,
    data: result
  };
}

export async function reloadNginx(
  step: PlanStep,
  context: StepContext
): Promise<StepResult> {
  const nginxConfPath = String(step.params.nginxConfPath || context.plan.resources.nginxConfPath);
  const script = "nginx -t && systemctl reload nginx";
  const result = await runEcsShell(context, `${context.plan.project.name}-reload-nginx`, script);

  return {
    step: step.type,
    status: "success",
    resourceId: nginxConfPath,
    message:
      context.config.executionMode === "dry-run"
        ? "dry-run: would run nginx -t && systemctl reload nginx"
        : "Nginx validated and reloaded",
    data: result
  };
}
