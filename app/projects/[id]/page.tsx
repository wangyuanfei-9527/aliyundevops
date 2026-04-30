import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject } from "@/storage/projects";
import { readRunLogs } from "@/storage/logs";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const logs = await readRunLogs(project.runId);

  return (
    <main className="page">
      <div className="shell">
        <div className="topbar">
          <div>
            <h1 className="title">{project.name}</h1>
            <p className="subtitle">
              {project.group} / {project.type} / {project.domain}
            </p>
          </div>
          <Link className="button" href="/">
            返回
          </Link>
        </div>

        <div className="grid">
          <section className="panel">
            <div className="panelHeader">
              <h2 className="panelTitle">资源</h2>
            </div>
            <div className="panelBody">
              <div className="resourceGrid">
                {Object.entries(project.resources).map(([key, value]) => (
                  <div className="kv" key={key}>
                    <div className="kvLabel">{key}</div>
                    <div className="kvValue">{value || "-"}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panelHeader">
              <h2 className="panelTitle">执行日志</h2>
            </div>
            <div className="panelBody">
              <pre className="codeBlock">
                {logs.length
                  ? logs
                      .map(
                        (log) =>
                          `${log.time} [${log.level}] ${log.step}: ${log.message}${
                            log.data ? ` ${JSON.stringify(log.data)}` : ""
                          }`
                      )
                      .join("\n")
                  : "暂无日志"}
              </pre>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
