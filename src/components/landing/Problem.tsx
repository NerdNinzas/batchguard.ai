"use client";

import { Section } from "@/components/ui/Section";
import { Reveal } from "@/components/ui/Reveal";
import { GlowCard } from "@/components/ui/GlowCard";
import { PROBLEMS, THEME_ALIGNMENT } from "@/lib/content";
import { FileWarning, BellOff, AlarmClockOff, MoonStar, UserX, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = { FileWarning, BellOff, AlarmClockOff, MoonStar, UserX };

export function Problem() {
  return (
    <Section
      id="problem"
      eyebrow="The gap"
      title={
        <>
          A threshold alarm at 2 a.m. says <span className="text-red">“temperature high”</span>. Nobody knows why.
        </>
      }
      lead="Small and mid-sized factories produce data but have no affordable way to watch it, understand it, or act on it in time. Enterprise condition monitoring is expensive, needs integrators, and still stops at a threshold."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PROBLEMS.map((p, i) => {
          const Icon = ICONS[p.icon];
          return (
            <Reveal key={p.title} delay={i * 0.06}>
              <GlowCard accent="red" className="h-full">
                <div className="mb-4 inline-grid h-11 w-11 place-items-center rounded-xl border border-red/30 bg-red/10 text-red">
                  <Icon size={20} />
                </div>
                <h3 className="text-lg font-semibold text-ink">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{p.body}</p>
              </GlowCard>
            </Reveal>
          );
        })}
        <Reveal delay={0.3}>
          <div className="glass glow-amber flex h-full flex-col justify-between rounded-2xl border-amber/30 p-6">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-amber">Problem statement</p>
            <p className="mt-3 text-base leading-relaxed text-ink">
              Factory owners need a low-setup way to connect machines, detect abnormal behaviour early, understand the
              likely cause with evidence, and make sure the right person is reached in time — without replacing human
              judgement on the shop floor.
            </p>
          </div>
        </Reveal>
      </div>

      <Reveal className="mt-16">
        <p className="mb-4 font-mono text-xs uppercase tracking-[0.25em] text-muted">Theme alignment · Intelligent Operations & Industrial Efficiency</p>
        <div className="grid gap-3 md:grid-cols-5">
          {THEME_ALIGNMENT.map((t) => (
            <div key={t.goal} className="rounded-xl border border-line bg-white p-4">
              <p className="text-sm font-semibold text-blue">{t.goal}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">{t.how}</p>
            </div>
          ))}
        </div>
      </Reveal>
    </Section>
  );
}
