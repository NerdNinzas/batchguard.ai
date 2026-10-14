"use client";

import { motion } from "framer-motion";
import { useRef, type ReactNode, type MouseEvent } from "react";

/** Glass card with a cursor-following spotlight. */
export function GlowCard({
  children,
  className = "",
  accent = "blue",
}: {
  children: ReactNode;
  className?: string;
  accent?: "blue" | "amber" | "red" | "green" | "violet";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const colors = {
    blue: "30,111,255",
    amber: "255,176,32",
    red: "255,77,79",
    green: "47,212,138",
    violet: "139,124,255",
  }[accent];

  function onMove(e: MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      className={`glass group relative overflow-hidden rounded-2xl p-6 ${className}`}
      style={
        {
          "--mx": "50%",
          "--my": "50%",
        } as React.CSSProperties
      }
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background: `radial-gradient(360px circle at var(--mx) var(--my), rgba(${colors},0.16), transparent 45%)`,
        }}
      />
      <div className="relative">{children}</div>
    </motion.div>
  );
}
