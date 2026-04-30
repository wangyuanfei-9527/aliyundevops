import { ProjectConsole } from "@/components/ProjectConsole";
import { listProjects } from "@/storage/projects";

export const dynamic = "force-dynamic";

export default async function Home() {
  const projects = await listProjects();

  return (
    <main className="page">
      <div className="shell">
        <div className="topbar">
          <div>
            <h1 className="title">测试环境自动化</h1>
            <p className="subtitle">
              本地自用工具：生成执行计划，按白名单步骤创建测试环境资源。
            </p>
          </div>
          <span className="badge warning">默认 dry-run</span>
        </div>
        <ProjectConsole initialProjects={projects} />
      </div>
    </main>
  );
}
