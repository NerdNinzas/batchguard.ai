"use client";

import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MuseLogo } from "./MuseLogo";

/**
 * Compact Muse for dashboard pages: a small head with a one-line bubble.
 * Click the head to collapse to just the avatar (remembered); the head gives a
 * tiny bounce whenever the line changes.
 */
export function MuseChip({ line }: { line: string }) {
  const [open, setOpen] = useState(true);
  const bounce = useAnimationControls();
  const last = useRef("");

  useEffect(() => {
    try {
      setOpen(localStorage.getItem("muse.chip") !== "closed");
    } catch {}
  }, []);

  useEffect(() => {
    if (last.current === line) return;
    last.current = line;
    bounce.start({ y: [0, -6, 0], rotate: [0, -6, 6, 0], transition: { duration: 0.6 } });
  }, [line, bounce]);

  function toggle() {
    setOpen((o) => {
      try {
        localStorage.setItem("muse.chip", o ? "closed" : "open");
      } catch {}
      return !o;
    });
  }

  return (
    <div className="fixed bottom-4 right-4 z-30 flex items-end gap-2">
      <AnimatePresence>
        {open && (
          <motion.div key={line} initial={{ opacity: 0, y: 6, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.96 }} transition={{ duration: 0.2 }} className="card relative mb-1 max-w-[260px] rounded-xl px-3 py-2">
            <div className="flex items-start gap-2">
              <p className="text-[12px] leading-snug text-ink">{line}</p>
              <button onClick={toggle} className="-mr-1 -mt-0.5 rounded p-0.5 text-muted hover:text-ink" aria-label="Hide Muse">
                <X size={12} />
              </button>
            </div>
            <span className="absolute -right-1 bottom-3 h-2.5 w-2.5 rotate-45 border-r border-t border-line bg-white" />
          </motion.div>
        )}
      </AnimatePresence>
      <motion.button animate={bounce} onClick={toggle} title={open ? "Hide Muse" : "Show Muse"} className="rounded-full shadow-[0_8px_20px_-8px_rgba(30,111,255,.5)] ring-2 ring-white">
        <MuseLogo size={44} />
      </motion.button>
    </div>
  );
}
