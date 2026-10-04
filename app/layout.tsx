import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "听见 · AI 智能听写",
  description: "拍下课本，圈出重点，按你的节奏听写。",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
