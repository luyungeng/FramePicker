import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FramePicker - 视频转序列帧/GIF工具",
  description: "浏览器端在线视频转序列帧/GIF一站式工具，专为游戏特效开发者设计。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
