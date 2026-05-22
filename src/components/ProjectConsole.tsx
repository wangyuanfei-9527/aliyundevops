"use client";

import { useState, useCallback } from "react";

// =============================================================================
// Types
// =============================================================================

type WizardStep =
  | "input"
  | "derive"
  | "plan"
  | "apply"
  | "analyze"
  | "deployPlan"
  | "execute"
  | "logs";

interface ProjectForm {
  group: string;
  name: string;
  type: "frontend" | "backend";
  domain: string;
  servicePort: string;
}

interface ApiError {
  message: string;
  details?: string;
}

interface StepResult {
  id: string;
  type: string;
  name: string;
  status: "pending" | "running" | "success" | "failed" | "skipped";
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

// =============================================================================
// Sub-components
// =============================================================================

function TerraformPlanSummary({ planInfo }: { planInfo: Record<string, number> }) {
  return (
    <div className="flex gap-4 mb-4">
      <div>
        <span className="text-tertiary text-xs">创建</span>
        <div className="font-mono" style={{ color: "var(--color-success)" }}>
          +{planInfo.createCount ?? 0}
        </div>
      </div>
      <div>
        <span className="text-tertiary text-xs">变更</span>
        <div className="font-mono" style={{ color: "var(--color-warning)" }}>
          ~{planInfo.updateCount ?? 0}
        </div>
      </div>
      <div>
        <span className="text-tertiary text-xs">销毁</span>
        <div className="font-mono" style={{ color: "var(--color-error)" }}>
          -{planInfo.destroyCount ?? 0}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Main component
// =============================================================================

export default function ProjectConsole() {
  // ---- State ----
  const [currentStep, setCurrentStep] = useState<WizardStep>("input");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [form, setForm] = useState<ProjectForm>({
    group: "",
    name: "",
    type: "backend",
    domain: "",
    servicePort: "8080",
  });

  // API response data
  const [projectId, setProjectId] = useState<string>("");
  const [derived, setDerived] = useState<Record<string, string> | null>(null);
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);
  const [terraformPlan, setTerraformPlan] = useState<Record<string, unknown> | null>(null);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [deployPlan, setDeployPlan] = useState<Record<string, unknown> | null>(null);
  const [runSteps, setRunSteps] = useState<StepResult[]>([]);
  const [runStatus, setRunStatus] = useState<string>("");
  const [warnings, setWarnings] = useState<string[]>([]);

  // ---- API helper ----
  const apiPost = useCallback(async (url: string, body: Record<string, unknown>) => {
    setError(null);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.ok) {
      const err: ApiError = { message: json.error ?? "Unknown error" };
      if (json.details) err.details = json.details;
      throw err;
    }
    return json.data;
  }, []);

  // ---- Step handlers ----

  const handleDerive = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiPost("/api/resources/derive", {
        group: form.group,
        name: form.name,
        type: form.type,
        domain: form.domain,
        servicePort: Number(form.servicePort) || undefined,
      });
      setDerived(data.derived);
      setWarnings(data.warnings ?? []);
      setCurrentStep("derive");
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  }, [form, apiPost]);

  const handlePlan = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiPost("/api/resources/plan", {
        group: form.group,
        name: form.name,
        type: form.type,
        domain: form.domain,
        servicePort: Number(form.servicePort) || undefined,
      });
      setProjectId(data.projectId);
      setManifest(data.manifest);
      setTerraformPlan(data.terraformPlan);
      if (data.warnings) setWarnings((prev) => [...prev, ...data.warnings]);
      setCurrentStep("plan");
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  }, [form, apiPost]);

  const handleApply = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiPost("/api/resources/apply", {
        projectId,
        authorized: true,
      });
      setManifest(data.manifest);
      setCurrentStep("apply");
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  }, [projectId, apiPost]);

  const handleAnalyze = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiPost("/api/analyze", { projectId });
      setProfile(data.profile);
      setCurrentStep("analyze");
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  }, [projectId, apiPost]);

  const handleDeployPlan = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiPost("/api/deploy-plan", { projectId });
      setDeployPlan(data.deployPlan);
      setCurrentStep("deployPlan");
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  }, [projectId, apiPost]);

  const handleExecute = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiPost("/api/runs", {
        projectId,
        authorized: true,
      });
      setRunSteps(data.steps ?? []);
      setRunStatus(data.status);
      setCurrentStep("logs");
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  }, [projectId, apiPost]);

  const handleRetryStep = useCallback(async (stepId: string) => {
    setLoading(true);
    try {
      const data = await apiPost("/api/runs/step", {
        projectId,
        stepId,
        authorized: true,
      });
      if (data.step) {
        setRunSteps((prev) =>
          prev.map((s) => (s.id === data.step.id ? data.step : s)),
        );
      }
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  }, [projectId, apiPost]);

  // ---- Helpers ----

  const updateForm = (field: keyof ProjectForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const isFormValid =
    form.group.trim() !== "" &&
    form.name.trim() !== "" &&
    form.domain.trim() !== "" &&
    form.type !== null;

  // Step definitions for the wizard bar
  const stepDefs: Array<{ key: WizardStep; label: string }> = [
    { key: "input", label: "项目信息" },
    { key: "derive", label: "资源推导" },
    { key: "plan", label: "Terraform Plan" },
    { key: "apply", label: "Apply" },
    { key: "analyze", label: "AI 分析" },
    { key: "deployPlan", label: "部署方案" },
    { key: "execute", label: "执行" },
    { key: "logs", label: "日志" },
  ];

  const stepIndex = stepDefs.findIndex((s) => s.key === currentStep);

  function stepDotClass(key: WizardStep): string {
    const idx = stepDefs.findIndex((s) => s.key === key);
    if (idx < stepIndex) return "step-dot done";
    if (idx === stepIndex) return "step-dot active";
    return "step-dot";
  }

  // ---- Render ----

  return (
    <div className="console-shell">
      {/* Header */}
      <header className="flex items-center justify-between mb-6">
        <h1>阿里云测试环境控制台</h1>
        {projectId && (
          <span className="badge badge-neutral">
            {projectId}
          </span>
        )}
      </header>

      {/* Step bar */}
      <nav className="steps-bar" aria-label="向导步骤">
        {stepDefs.map((s) => (
          <div key={s.key} className={stepDotClass(s.key)}>
            {s.label}
          </div>
        ))}
      </nav>

      {/* Error display */}
      {error && (
        <div className="alert alert-error" role="alert">
          <strong>{error.message}</strong>
          {error.details && (
            <p className="text-sm mt-2" style={{ wordBreak: "break-word" }}>
              {error.details}
            </p>
          )}
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="alert alert-warning">
          <strong>注意</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
            {warnings.map((w, i) => (
              <li key={i} className="text-sm">{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- Step: Input ---- */}
      {currentStep === "input" && (
        <section className="panel" aria-label="项目信息">
          <div className="panel-header">
            <h2 className="panel-title">填写项目信息</h2>
          </div>
          <div className="form-grid">
            <div>
              <label htmlFor="f-group">代码组 (Group)</label>
              <input
                id="f-group"
                type="text"
                placeholder="例如 mall"
                value={form.group}
                onChange={(e) => updateForm("group", e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="f-name">项目名称 (Name)</label>
              <input
                id="f-name"
                type="text"
                placeholder="例如 order-service"
                value={form.name}
                onChange={(e) => updateForm("name", e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="f-type">项目类型</label>
              <select
                id="f-type"
                value={form.type}
                onChange={(e) => updateForm("type", e.target.value)}
              >
                <option value="backend">后端 (Backend)</option>
                <option value="frontend">前端 (Frontend)</option>
              </select>
            </div>
            <div>
              <label htmlFor="f-port">服务端口</label>
              <input
                id="f-port"
                type="number"
                placeholder="8080"
                value={form.servicePort}
                onChange={(e) => updateForm("servicePort", e.target.value)}
              />
            </div>
            <div className="full-width">
              <label htmlFor="f-domain">域名</label>
              <input
                id="f-domain"
                type="text"
                placeholder="例如 order.test.example.com"
                value={form.domain}
                onChange={(e) => updateForm("domain", e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-between mt-6">
            <div />
            <button
              className="btn btn-primary"
              disabled={!isFormValid || loading}
              onClick={handleDerive}
            >
              {loading ? <span className="spinner" /> : null}
              推导资源
            </button>
          </div>
        </section>
      )}

      {/* ---- Step: Derive ---- */}
      {currentStep === "derive" && derived && (
        <section className="panel" aria-label="资源推导结果">
          <div className="panel-header">
            <h2 className="panel-title">资源推导结果</h2>
            <span className="badge badge-success">完成</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>资源</th>
                <th>推导值</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(derived).map(([key, value]) => (
                <tr key={key}>
                  <td className="text-secondary">{key}</td>
                  <td className="font-mono text-sm">{value || "(空)"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-between mt-6">
            <button className="btn btn-secondary" onClick={() => setCurrentStep("input")}>
              返回修改
            </button>
            <button className="btn btn-primary" disabled={loading} onClick={handlePlan}>
              {loading ? <span className="spinner" /> : null}
              执行资源规划
            </button>
          </div>
        </section>
      )}

      {/* ---- Step: Terraform Plan ---- */}
      {currentStep === "plan" && terraformPlan && (
        <section className="panel" aria-label="Terraform Plan 结果">
          <div className="panel-header">
            <h2 className="panel-title">Terraform Plan</h2>
            <span className={terraformPlan.success ? "badge badge-success" : "badge badge-error"}>
              {terraformPlan.success ? "有变更" : "Plan 失败"}
            </span>
          </div>
          {Boolean(terraformPlan.success) && Boolean(terraformPlan.planInfo) ? (
            <TerraformPlanSummary planInfo={terraformPlan.planInfo as Record<string, number>} />
          ) : null}
          {!terraformPlan.success && terraformPlan.error != null && (
            <div className="alert alert-error">{String(terraformPlan.error)}</div>
          )}
          <div className="flex justify-between mt-6">
            <button className="btn btn-secondary" onClick={() => setCurrentStep("input")}>
              返回
            </button>
            {Boolean(terraformPlan.success) && (
              <button className="btn btn-danger" disabled={loading} onClick={handleApply}>
                {loading ? <span className="spinner" /> : null}
                确认 Apply (创建真实资源)
              </button>
            )}
          </div>
        </section>
      )}

      {/* ---- Step: Apply ---- */}
      {currentStep === "apply" && manifest && (
        <section className="panel" aria-label="资源清单">
          <div className="panel-header">
            <h2 className="panel-title">资源清单 (ResourceManifest)</h2>
            <span className="badge badge-success">已就绪</span>
          </div>
          <div className="code-block">
            {JSON.stringify(manifest, null, 2)}
          </div>
          <div className="flex justify-between mt-6">
            <button className="btn btn-secondary" onClick={() => setCurrentStep("plan")}>
              返回
            </button>
            <button className="btn btn-primary" disabled={loading} onClick={handleAnalyze}>
              {loading ? <span className="spinner" /> : null}
              AI 分析仓库
            </button>
          </div>
        </section>
      )}

      {/* ---- Step: Analyze ---- */}
      {currentStep === "analyze" && profile && (
        <section className="panel" aria-label="AI 分析结果">
          <div className="panel-header">
            <h2 className="panel-title">项目分析 (ProjectProfile)</h2>
            <span className="badge badge-info">{String(profile.language ?? "")}</span>
          </div>
          <table className="data-table">
            <thead>
              <tr><th>属性</th><th>值</th></tr>
            </thead>
            <tbody>
              {Object.entries(profile).map(([key, value]) => (
                <tr key={key}>
                  <td className="text-secondary">{key}</td>
                  <td className="text-sm">
                    {typeof value === "object" ? JSON.stringify(value) : String(value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-between mt-6">
            <button className="btn btn-secondary" onClick={() => setCurrentStep("apply")}>
              返回
            </button>
            <button className="btn btn-primary" disabled={loading} onClick={handleDeployPlan}>
              {loading ? <span className="spinner" /> : null}
              生成部署方案
            </button>
          </div>
        </section>
      )}

      {/* ---- Step: Deploy Plan ---- */}
      {currentStep === "deployPlan" && deployPlan && (
        <section className="panel" aria-label="部署方案">
          <div className="panel-header">
            <h2 className="panel-title">部署方案 (DeployPlan)</h2>
            <span className="badge badge-info">
              {Array.isArray(deployPlan.steps) ? deployPlan.steps.length : 0} 步骤
            </span>
          </div>
          {Array.isArray(deployPlan.steps) && (
            <ul className="step-list">
              {(deployPlan.steps as Array<Record<string, unknown>>).map((step, i) => (
                <li key={String(step.id ?? i)} className="step-item">
                  <span className="step-icon step-icon-pending">{i + 1}</span>
                  <div>
                    <div className="step-name">{String(step.name)}</div>
                    <div className="text-xs text-tertiary">{String(step.type)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {Boolean(deployPlan.reasoning) && (
            <div className="mt-4">
              <h4>分析说明</h4>
              <p className="text-sm text-secondary mt-2">{String(deployPlan.reasoning)}</p>
            </div>
          )}
          <div className="flex justify-between mt-6">
            <button className="btn btn-secondary" onClick={() => setCurrentStep("analyze")}>
              返回
            </button>
            <button className="btn btn-danger" disabled={loading} onClick={handleExecute}>
              {loading ? <span className="spinner" /> : null}
              确认执行部署
            </button>
          </div>
        </section>
      )}

      {/* ---- Step: Logs ---- */}
      {currentStep === "logs" && (
        <section className="panel" aria-label="执行日志">
          <div className="panel-header">
            <h2 className="panel-title">执行日志</h2>
            <span className={
              runStatus === "completed"
                ? "badge badge-success"
                : runStatus === "failed"
                  ? "badge badge-error"
                  : "badge badge-info"
            }>
              {runStatus || "执行中"}
            </span>
          </div>

          {runSteps.length > 0 ? (
            <ul className="step-list">
              {runSteps.map((step, i) => (
                <li key={step.id} className="step-item">
                  <span className={`step-icon step-icon-${step.status}`}>
                    {step.status === "running" ? (
                      <span className="spinner" style={{ width: 12, height: 12 }} />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div className="step-name">{step.name}</div>
                    <div className="text-xs text-tertiary">
                      {step.type}
                      {step.startedAt && (
                        <> &middot; {new Date(step.startedAt).toLocaleTimeString()}</>
                      )}
                    </div>
                    {step.error && (
                      <div className="step-error">{step.error}</div>
                    )}
                  </div>
                  {step.status === "failed" && (
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: "var(--text-xs)", padding: "2px 8px" }}
                      disabled={loading}
                      onClick={() => handleRetryStep(step.id)}
                    >
                      重试
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">
              <h3>无执行记录</h3>
              <p>尚未开始执行部署步骤。</p>
            </div>
          )}

          <div className="flex justify-between mt-6">
            <button
              className="btn btn-secondary"
              onClick={() => {
                setCurrentStep("input");
                setProjectId("");
                setDerived(null);
                setManifest(null);
                setTerraformPlan(null);
                setProfile(null);
                setDeployPlan(null);
                setRunSteps([]);
                setRunStatus("");
                setWarnings([]);
              }}
            >
              开始新项目
            </button>
          </div>
        </section>
      )}

      {/* Loading overlay */}
      {loading && (
        <div
          style={{
            position: "fixed", bottom: 24, right: 24,
            background: "var(--accent)", color: "#fff",
            padding: "8px 16px", borderRadius: "var(--radius-lg)",
            fontSize: "var(--text-sm)", fontWeight: 500,
            boxShadow: "var(--shadow-lg)",
            display: "flex", alignItems: "center", gap: 8,
          }}
        >
          <span className="spinner" style={{ borderTopColor: "#fff" }} />
          执行中...
        </div>
      )}
    </div>
  );
}
