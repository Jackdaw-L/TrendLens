import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import "./globals.css";

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
    icon: "/trendlens-icon.svg",
    apple: "/trendlens-icon.svg",
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
    <html lang="zh-CN">
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
