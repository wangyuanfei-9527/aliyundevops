export const metadata = {
  title: "Aliyun DevOps Automation",
  description: "Local console for safe test environment automation"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
