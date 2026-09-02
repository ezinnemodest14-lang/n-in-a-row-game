import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "N-in-a-Row — MCTS + RAVE AI",
  description:
    "Gomoku-style N-in-a-Row against an MCTS + RAVE engine with threat classification, persistent learning and a neural evaluator.",
  keywords: ["N-in-a-row", "Gomoku", "MCTS", "RAVE", "game AI", "Next.js"],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "N-in-a-Row — MCTS + RAVE AI",
    description: "Play against a learning MCTS + RAVE engine",
    siteName: "N-in-a-Row",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
