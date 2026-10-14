import { Navbar } from "@/components/landing/Navbar";
import { Hero } from "@/components/landing/Hero";
import { Marquee } from "@/components/landing/Marquee";
import { Story } from "@/components/landing/Story";
import { Problem } from "@/components/landing/Problem";
import { Journey } from "@/components/landing/Journey";
import { Pipeline } from "@/components/landing/Pipeline";
import { MuseCompanion } from "@/components/muse/MuseCompanion";
import { Agent } from "@/components/landing/Agent";
import { Architecture } from "@/components/landing/Architecture";
import { Evaluation } from "@/components/landing/Evaluation";
import { Scale } from "@/components/landing/Scale";
import { CTA } from "@/components/landing/CTA";
import { Footer } from "@/components/landing/Footer";

export default function Home() {
  return (
    <main className="relative">
      <Navbar />
      <Hero />
      <Marquee />
      <Story />
      <Problem />
      <Journey />
      <Pipeline />
      <Agent />
      <Architecture />
      <Evaluation />
      <Scale />
      <CTA />
      <Footer />
      <MuseCompanion />
    </main>
  );
}
