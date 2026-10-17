import { NextResponse } from "next/server";
import { engine } from "@/server/engine";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { action?: string };
  const e = engine();
  if (b.action === "reload") await e.loadMachines().catch(() => {});
  else e.allNormal();
  return NextResponse.json({ ok: true });
}
