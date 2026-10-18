"use client";

import { PlayCircle } from "lucide-react";
import { Reveal } from "@/components/ui/Reveal";
import { DEMO_VIDEO_THUMB, DEMO_VIDEO_URL } from "@/lib/demo";

/** The AI Builder Cup submission video: thumbnail with a play button, opens the video in a new tab. */
export function DemoVideo() {
  return (
    <section id="demo-video" className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <Reveal>
        <div className="mb-6 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-blue">Demo video · AI Builder Cup 2026</p>
          <h2 className="font-display mt-3 text-4xl font-semibold leading-[1.05] text-ink sm:text-5xl">Watch BatchGuard end to end</h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted">A manual becomes a monitoring spec, a machine breaks, Muse investigates, calls the engineer and shuts the line down when nobody answers.</p>
        </div>
        <a
          href={DEMO_VIDEO_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Watch the BatchGuard demo video"
          className="group relative mx-auto block aspect-video max-w-4xl overflow-hidden rounded-3xl border border-line bg-ink shadow-[0_30px_80px_-30px_rgba(11,26,51,.7)] transition hover:-translate-y-0.5 hover:shadow-[0_40px_90px_-30px_rgba(30,111,255,.5)]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={DEMO_VIDEO_THUMB} alt="BatchGuard demo video thumbnail: when a machine breaks, Muse calls you" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
          <span className="absolute inset-0 grid place-items-center">
            <span className="grid h-20 w-20 place-items-center rounded-full bg-white/95 text-blue shadow-2xl ring-8 ring-white/20 transition group-hover:scale-105">
              <PlayCircle size={48} />
            </span>
          </span>
          <span className="absolute bottom-4 left-4 rounded-full bg-black/60 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-white backdrop-blur">▶ Play the demo</span>
        </a>
      </Reveal>
    </section>
  );
}
