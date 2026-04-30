import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aliyun Test Env Automation",
  description: "Local tool for bootstrapping test environments on Aliyun."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
