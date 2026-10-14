"use client";

import dynamic from "next/dynamic";
import { ArrowRight, Code2, PlayCircle } from "lucide-react";
import { Reveal } from "@/components/ui/Reveal";

const ParticleField = dynamic(() => import("@/components/three/ParticleField"), { ssr: false });

export function CTA() {
  return (
    <section id="cta" className="relative overflow-hidden py-32">
      <ParticleField />
      <div className="absolute inset-0 bg-gradient-to-b from-bg via-transparent to-bg" />
      <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6">
        <Reveal>
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-blue">Demo · Oct 18, 2026</p>
          <h2 className="font-display mt-4 text-5xl font-semibold leading-[1] text-ink sm:text-6xl md:text-7xl">
            Upload a manual. <span className="text-gradient">Break a machine.</span> Answer the phone.
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted">
            Three minutes from onboarding to an evidence-backed diagnosis and a voice call. Every step is a real round trip
            through Google Cloud.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <a href="#story" className="group inline-flex items-center gap-2 rounded-xl bg-blue px-6 py-3.5 font-semibold text-white transition hover:brightness-110">
              Replay the incident <ArrowRight size={18} className="transition group-hover:translate-x-0.5" />
            </a>
            <a href="#" className="inline-flex items-center gap-2 rounded-xl border border-line bg-white px-6 py-3.5 text-fg transition hover:border-blue/50 hover:text-blue">
              <PlayCircle size={18} /> Watch the demo
            </a>
            <a href="#" className="inline-flex items-center gap-2 rounded-xl border border-line bg-white px-6 py-3.5 text-fg transition hover:border-blue/50 hover:text-blue">
              <Code2 size={18} /> GitHub
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
