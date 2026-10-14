"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { MuseGuide } from "@/components/muse/MuseGuide";
import { MuseLogo } from "@/components/muse/MuseLogo";
import { Button, Input } from "@/components/ui/Primitives";
import { useToast } from "@/components/ui/Toast";
import { ApiError, post, type User } from "@/lib/api";
import { firebaseEnabled, googleIdToken } from "@/lib/firebase";

export function AuthCard({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [gbusy, setGbusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function go(u: User) {
    toast("success", mode === "signup" ? `Welcome, ${u.name}!` : `Welcome back, ${u.name}`, u.org?.onboarded ? "Opening your dashboard." : "Let's set up your factory.");
    router.replace(u.org?.onboarded ? "/app" : "/onboarding");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const u = await post<User>(mode === "signup" ? "/api/auth/signup" : "/api/auth/login", mode === "signup" ? { name, email, password } : { email, password });
      go(u);
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setErr(null);
    setGbusy(true);
    try {
      const id_token = await googleIdToken();
      go(await post<User>("/api/auth/google", { id_token }));
    } catch (ex) {
      const msg = ex instanceof Error ? ex.message : "Google sign-in failed";
      setErr(msg);
      toast("warning", "Google sign-in", msg, 7000);
    } finally {
      setGbusy(false);
    }
  }

  const line = mode === "signup" ? "Hi! I'm Muse. Make an account and I'll help you connect your first machine in a few minutes." : "Welcome back. Sign in and I'll bring up your line.";

  return (
    <main className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-gradient-to-br from-sky-soft via-bg to-white lg:block">
        <div className="grid-bg absolute inset-0" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Link href="/" className="flex items-center gap-2.5">
            <MuseLogo size={42} />
            <span className="font-display text-2xl font-semibold text-ink">
              BatchGuard <span className="text-blue">AI</span>
            </span>
          </Link>
          <div>
            <h1 className="font-display text-5xl font-semibold leading-[1] text-ink xl:text-6xl">
              Your factory, watched by an agent that <span className="text-gradient">explains and calls.</span>
            </h1>
            <p className="mt-5 max-w-lg text-lg text-muted">Onboard a machine from its PDF manual. From then on, Muse watches it 24/7, explains every abnormal reading with evidence, and reaches the right person in time.</p>
          </div>
          <MuseGuide line={line} side="left" size={170} />
        </div>
      </section>

      <section className="grid place-items-center p-6">
        <form onSubmit={submit} className="card w-full max-w-md rounded-3xl p-8">
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <MuseLogo size={36} />
            <span className="font-display text-xl font-semibold text-ink">BatchGuard AI</span>
          </div>
          <h2 className="font-display text-3xl font-semibold text-ink">{mode === "signup" ? "Create your account" : "Sign in"}</h2>
          <p className="mt-1 text-sm text-muted">{mode === "signup" ? "Free during the AI Builder Cup." : "Use the email you registered with."}</p>

          <Button type="button" variant="secondary" className="mt-6 w-full" onClick={google} loading={gbusy}>
            <GoogleMark /> Continue with Google
            {!firebaseEnabled && <span className="ml-1 rounded-full bg-sky-soft px-2 py-0.5 font-mono text-[10px] text-muted">not configured</span>}
          </Button>
          <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>

          <div className="space-y-4">
            {mode === "signup" && <Input label="Your name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Aatif" autoComplete="name" />}
            <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@factory.com" autoComplete="email" />
            <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} placeholder="At least 8 characters" autoComplete={mode === "signup" ? "new-password" : "current-password"} error={err ?? undefined} />
          </div>
          <Button type="submit" className="mt-6 w-full" size="lg" loading={busy}>
            {mode === "signup" ? "Create account" : "Sign in"}
          </Button>
          <p className="mt-5 text-center text-sm text-muted">
            {mode === "signup" ? "Already have an account? " : "New to BatchGuard? "}
            <Link href={mode === "signup" ? "/login" : "/signup"} className="font-semibold text-blue hover:underline">
              {mode === "signup" ? "Sign in" : "Create one"}
            </Link>
          </p>
        </form>
      </section>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34.1 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C40.9 35.6 44 30.3 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
