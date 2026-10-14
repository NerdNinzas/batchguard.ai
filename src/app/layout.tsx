import type { Metadata } from "next";
import { Barlow, Barlow_Condensed, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const barlow = Barlow({ variable: "--font-barlow", subsets: ["latin"], weight: ["400", "500", "600"] });
const barlowCondensed = Barlow_Condensed({ variable: "--font-barlow-condensed", subsets: ["latin"], weight: ["500", "600", "700"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "BatchGuard AI — An AI agent that watches your machines 24/7",
  description:
    "Onboard a machine from its PDF manual in two minutes. From then on, an AI agent watches it 24/7, explains every abnormal reading with evidence, and calls you when it is serious. Built on Google Cloud for the AI Builder Cup 2026.",
  openGraph: {
    title: "BatchGuard AI",
    description:
      "Factory monitoring with an investigating AI agent — detection, diagnosis, and phone-call escalation. Built on Gemini, ADK and Google Cloud.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${barlow.variable} ${barlowCondensed.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-bg text-fg">{children}</body>
    </html>
  );
}
