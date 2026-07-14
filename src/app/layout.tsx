import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import "./globals.css";

// 构建时下载并自托管 Manrope（可变字体，覆盖 400-800 字重），
// 运行时零外部字体请求；中文仍走 font-family 后备栈里的 PingFang SC。
const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-manrope",
});

export const metadata: Metadata = {
  title: "TrendLens",
  description: "个人化科技、互联网与 LLM 趋势雷达",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "TrendLens",
  },
  applicationName: "TrendLens",
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: "/trendlens-icon.png",
    apple: "/trendlens-icon.png",
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#f7f6f1",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html className={manrope.variable} lang="zh-CN">
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
