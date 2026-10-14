"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import { MuseLogo } from "@/components/muse/MuseLogo";
import { NAV } from "@/lib/content";

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const f = () => setScrolled(window.scrollY > 24);
    f();
    window.addEventListener("scroll", f, { passive: true });
    return () => window.removeEventListener("scroll", f);
  }, []);

  return (
    <motion.header
      initial={{ y: -40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className={`fixed inset-x-0 top-0 z-50 transition-all ${scrolled ? "py-3" : "py-5"}`}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className={`flex items-center justify-between rounded-2xl px-4 py-2.5 transition-all ${scrolled ? "glass" : ""}`}>
          <Link href="/" className="flex items-center gap-2.5">
            <MuseLogo size={42} />
            <span className="font-display text-xl font-semibold tracking-tight">
              BatchGuard <span className="text-blue">AI</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-7 text-sm text-muted md:flex">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="transition-colors hover:text-ink">
                {n.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <a href="#journey" className="rounded-xl bg-blue px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110">
              See how it works
            </a>
          </div>

          <button aria-label="Menu" className="md:hidden" onClick={() => setOpen((v) => !v)}>
            {open ? <X /> : <Menu />}
          </button>
        </div>

        {open && (
          <div className="glass mt-2 flex flex-col gap-1 rounded-2xl p-3 md:hidden">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} onClick={() => setOpen(false)} className="rounded-lg px-3 py-2 text-sm text-muted hover:bg-white hover:text-ink">
                {n.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </motion.header>
  );
}
