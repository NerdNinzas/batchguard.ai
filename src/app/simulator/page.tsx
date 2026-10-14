import Link from "next/link";

/**
 * Placeholder route. The Virtual Factory lives in src/simulator/ and will be
 * mounted here once built (see src/simulator/README.md).
 */
export default function SimulatorPage() {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-amber">/simulator</p>
        <h1 className="mt-3 text-3xl font-semibold">Virtual Factory — coming next</h1>
        <p className="mt-3 max-w-md text-muted">3D packaging line with live controls, fault injection and blind test mode.</p>
        <Link href="/" className="mt-8 inline-block text-cyan hover:underline">
          ← Back to landing
        </Link>
      </div>
    </main>
  );
}
