"use client";

import { useEffect, useState } from "react";

/** Current time in ms, ticking every second; 0 until mounted (effects only, so render stays pure). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
