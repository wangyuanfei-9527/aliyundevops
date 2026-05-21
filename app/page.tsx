import "./globals.css";

const principles = [
  "Terraform 管理基础设施资源",
  "AI 只生成可审核部署方案",
  "Runner 只执行白名单步骤",
  "默认不触达真实云资源"
];

export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="eyebrow">local-safe foundation</p>
        <h1>阿里云测试环境自动化控制台</h1>
        <p className="summary">
          当前阶段只搭建工程基础、测试和验证入口，后续模块将在安全边界内逐步填充。
        </p>
        <ul aria-label="架构原则">
          {principles.map((principle) => (
            <li key={principle}>{principle}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
