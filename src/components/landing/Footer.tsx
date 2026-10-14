import { MuseLogo } from "@/components/muse/MuseLogo";

export function Footer() {
  return (
    <footer className="border-t border-line py-10">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-4 sm:px-6 md:flex-row lg:px-8">
        <div className="flex items-center gap-2.5">
          <MuseLogo size={36} />
          <div>
            <p className="text-sm font-semibold">BatchGuard AI</p>
            <p className="text-xs text-muted">Advisory only. Never changes a machine. Suggestions are for qualified personnel.</p>
          </div>
        </div>
        <p className="font-mono text-[11px] uppercase tracking-widest text-muted">
          Google Cloud AI Builder Cup 2026 · Manufacturing · 3D assets: Kenney (CC0)
        </p>
      </div>
    </footer>
  );
}
