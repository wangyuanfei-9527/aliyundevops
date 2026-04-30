"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ExecutionPlan, ProjectInput, ProjectRecord, ProjectType } from "@/types";

interface Props {
  initialProjects: ProjectRecord[];
}

const defaultForm: ProjectInput = {
  group: "",
  name: "",
  type: "frontend",
  domain: "",
  buildCommand: "pnpm install && pnpm build",
  artifactDir: "dist",
  servicePort: 18080
};

export function ProjectConsole({ initialProjects }: Props) {
  const [projects, setProjects] = useState(initialProjects);
  const [form, setForm] = useState<ProjectInput>(defaultForm);
  const [plan, setPlan] = useState<ExecutionPlan | null>(null);
  const [message, setMessage] = useState<string>("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const isFrontend = form.type === "frontend";

  const visibleProjects = useMemo(() => projects.slice(0, 8), [projects]);

  function update<K extends keyof ProjectInput>(key: K, value: ProjectInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function generatePlan() {
    setBusy(true);
    setErrors([]);
    setMessage("");
    setPlan(null);
    try {
      const response = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const data = await response.json();
      if (!response.ok) {
        setErrors(data.errors || ["生成计划失败。"]);
        return;
      }
      setPlan(data.plan);
      setMessage("计划已生成。");
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    } finally {
      setBusy(false);
    }
  }

  async function executePlan() {
    if (!plan) return;
    setBusy(true);
    setErrors([]);
    setMessage("");
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan })
      });
      const data = await response.json();
      if (!response.ok) {
        setErrors(data.errors || ["执行失败。"]);
        return;
      }
      setMessage(`执行结束：${data.status}，runId=${data.runId}`);
      const projectsResponse = await fetch("/api/projects");
      const projectsData = await projectsResponse.json();
      setProjects(projectsData.projects || []);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid">
      <section className="panel">
        <div className="panelHeader">
          <h2 className="panelTitle">新建测试项目</h2>
        </div>
        <div className="panelBody">
          <div className="form">
            <div className="row">
              <label className="field">
                <span className="label">项目分组</span>
                <input
                  className="input"
                  value={form.group}
                  placeholder="mall"
                  onChange={(event) => update("group", event.target.value)}
                />
              </label>
              <label className="field">
                <span className="label">项目名</span>
                <input
                  className="input"
                  value={form.name}
                  placeholder="order-web"
                  onChange={(event) => update("name", event.target.value)}
                />
              </label>
            </div>

            <div className="row">
              <label className="field">
                <span className="label">项目类型</span>
                <select
                  className="select"
                  value={form.type}
                  onChange={(event) => update("type", event.target.value as ProjectType)}
                >
                  <option value="frontend">frontend</option>
                  <option value="backend">backend</option>
                </select>
              </label>
              <label className="field">
                <span className="label">测试域名</span>
                <input
                  className="input"
                  value={form.domain}
                  placeholder="order-test.example.com"
                  onChange={(event) => update("domain", event.target.value)}
                />
              </label>
            </div>

            {isFrontend ? (
              <div className="row">
                <label className="field">
                  <span className="label">构建命令</span>
                  <input
                    className="input"
                    value={form.buildCommand || ""}
                    onChange={(event) => update("buildCommand", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="label">产物目录</span>
                  <input
                    className="input"
                    value={form.artifactDir || ""}
                    onChange={(event) => update("artifactDir", event.target.value)}
                  />
                </label>
              </div>
            ) : (
              <label className="field">
                <span className="label">服务端口</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={65535}
                  value={form.servicePort || 18080}
                  onChange={(event) => update("servicePort", Number(event.target.value))}
                />
                <span className="hint">Nginx 会反代到测试服务器 127.0.0.1:端口。</span>
              </label>
            )}

            {message ? <div className="notice">{message}</div> : null}
            {errors.length ? (
              <div className="notice error">
                {errors.map((error) => (
                  <div key={error}>{error}</div>
                ))}
              </div>
            ) : null}

            <div className="actions">
              <button className="button primary" disabled={busy} onClick={generatePlan}>
                生成计划
              </button>
              <button className="button" disabled={busy || !plan} onClick={executePlan}>
                执行计划
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <h2 className="panelTitle">执行计划</h2>
        </div>
        <div className="panelBody">
          {plan ? <PlanPreview plan={plan} /> : <div className="notice">先填写表单并生成计划。</div>}
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <h2 className="panelTitle">最近项目</h2>
        </div>
        <div className="panelBody">
          <div className="list">
            {visibleProjects.length ? (
              visibleProjects.map((project) => (
                <div className="item" key={project.id}>
                  <div className="itemTop">
                    <div>
                      <h3 className="itemTitle">{project.name}</h3>
                      <p className="itemMeta">
                        {project.group} / {project.type} / {project.domain}
                      </p>
                    </div>
                    <span
                      className={`badge ${
                        project.status === "created"
                          ? "success"
                          : project.status === "failed"
                            ? "danger"
                            : "warning"
                      }`}
                    >
                      {project.status}
                    </span>
                  </div>
                  <div className="actions">
                    <Link className="button" href={`/projects/${project.id}`}>
                      查看
                    </Link>
                  </div>
                </div>
              ))
            ) : (
              <div className="notice">暂无项目记录。</div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function PlanPreview({ plan }: { plan: ExecutionPlan }) {
  return (
    <div className="plan">
      {plan.warnings.length ? (
        <div className="notice">
          {plan.warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      ) : null}

      <div className="resourceGrid">
        {Object.entries(plan.resources).map(([key, value]) => (
          <div className="kv" key={key}>
            <div className="kvLabel">{key}</div>
            <div className="kvValue">{value || "-"}</div>
          </div>
        ))}
      </div>

      <div className="steps">
        {plan.steps.map((step) => (
          <div className="step" key={`${step.type}-${step.title}`}>
            <div>
              <div className="stepName">{step.title}</div>
              <div className="stepParams">{JSON.stringify(step.params)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
