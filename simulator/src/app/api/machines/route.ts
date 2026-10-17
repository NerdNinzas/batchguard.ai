import { NextResponse } from "next/server";
import { engine } from "@/server/engine";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const body = (await req.json()) as { type: string; name?: string };
  try { const id = await engine().addMachine(body.type, body.name); return NextResponse.json({ ok: true, id }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
