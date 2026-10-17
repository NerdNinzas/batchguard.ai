import { NextResponse } from "next/server";
import { engine } from "@/server/engine";

export const dynamic = "force-dynamic";
type Body = { action: "target" | "release" | "preset" | "running" | "speed"; parameter?: string; target?: number; ramp_s?: number; preset?: string; running?: boolean; speed?: number };

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = (await req.json()) as Body;
  const e = engine();
  try {
    if (b.action === "target" && b.parameter != null && b.target != null) e.setTarget(id, b.parameter, Number(b.target), Number(b.ramp_s ?? 30));
    else if (b.action === "release") e.release(id, b.parameter);
    else if (b.action === "preset" && b.preset) e.preset(id, b.preset);
    else if (b.action === "running") e.setRunning(id, Boolean(b.running));
    else if (b.action === "speed") e.setSpeed(id, Number(b.speed ?? 1));
    else return NextResponse.json({ error: "bad action" }, { status: 400 });
    return NextResponse.json({ ok: true, machine: e.snapshot().machines.find((m) => m.id === id) });
  } catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 }); }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try { await engine().removeMachine(id); return NextResponse.json({ ok: true }); }
  catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 }); }
}
