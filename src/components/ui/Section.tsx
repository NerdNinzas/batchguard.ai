import type { ReactNode } from "react";
import { Reveal } from "./Reveal";

export function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
  className = "",
}: {
  id?: string;
  eyebrow?: string;
  title?: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`relative py-24 md:py-32 ${className}`}>
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        {(eyebrow || title) && (
          <Reveal className="mb-14 max-w-3xl">
            {eyebrow && (
              <p className="mb-3 font-mono text-xs uppercase tracking-[0.25em] text-blue">
                {eyebrow}
              </p>
            )}
            {title && (
              <h2 className="font-display text-4xl font-semibold leading-[1.02] text-ink sm:text-5xl md:text-6xl">
                {title}
              </h2>
            )}
            {lead && <p className="mt-5 text-lg leading-relaxed text-muted">{lead}</p>}
          </Reveal>
        )}
        {children}
      </div>
    </section>
  );
}
