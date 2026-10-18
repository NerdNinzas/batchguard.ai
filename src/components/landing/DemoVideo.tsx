"use client";

import { PlayCircle } from "lucide-react";
import { useState } from "react";
import { Reveal } from "@/components/ui/Reveal";
import { DEMO_VIDEO_THUMB, DEMO_VIDEO_URL } from "@/lib/demo";

/** YouTube id from youtu.be/<id>, youtube.com/watch?v=<id> or /embed/<id>. */
function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|v=|\/embed\/)([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}

/** The AI Builder Cup submission video: thumbnail with a play button; plays right here on the page. */
export function DemoVideo() {
  const [playing, setPlaying] = useState(false);
  const id = youtubeId(DEMO_VIDEO_URL);
  const embed = id ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1` : null;

  return (
    <section id="demo-video" className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <Reveal>
        <div className="mb-6 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-blue">Demo video · AI Builder Cup 2026</p>
          <h2 className="font-display mt-3 text-4xl font-semibold leading-[1.05] text-ink sm:text-5xl">Watch BatchGuard end to end</h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted">A manual becomes a monitoring spec, a machine breaks, Muse investigates, calls the engineer and shuts the line down when nobody answers.</p>
        </div>
        <div className="relative mx-auto aspect-video max-w-4xl overflow-hidden rounded-3xl border border-line bg-ink shadow-[0_30px_80px_-30px_rgba(11,26,51,.7)]">
          {playing && embed ? (
            <iframe
              src={embed}
              title="BatchGuard demo video"
              className="absolute inset-0 h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          ) : (
            <button
              type="button"
              onClick={() => (embed ? setPlaying(true) : window.open(DEMO_VIDEO_URL, "_blank", "noopener"))}
              aria-label="Play the BatchGuard demo video"
              className="group absolute inset-0 block h-full w-full text-left"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={DEMO_VIDEO_THUMB} alt="BatchGuard demo video thumbnail: when a machine breaks, Muse calls you" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]" />
              <span className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
              <span className="absolute inset-0 grid place-items-center">
                <span className="grid h-20 w-20 place-items-center rounded-full bg-white/95 text-blue shadow-2xl ring-8 ring-white/20 transition group-hover:scale-105">
                  <PlayCircle size={48} />
                </span>
              </span>
              <span className="absolute bottom-4 left-4 rounded-full bg-black/60 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-white backdrop-blur">▶ Play the demo</span>
            </button>
          )}
        </div>
      </Reveal>
    </section>
  );
}
