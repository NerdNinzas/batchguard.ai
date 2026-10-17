import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "BatchGuard · Virtual Factory", description: "A virtual factory that streams telemetry into BatchGuard AI. Turn the dials, inject faults, watch Muse react." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en"><body className="min-h-screen bg-bg text-ink antialiased">{children}</body></html>
  );
}
