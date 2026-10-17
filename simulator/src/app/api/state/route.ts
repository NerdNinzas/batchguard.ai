import { NextResponse } from "next/server";
import { engine } from "@/server/engine";

export const dynamic = "force-dynamic";
export async function GET() {
  const e = engine();
  if (!e.started) e.start().catch(() => {});
  return NextResponse.json(e.snapshot());
}
