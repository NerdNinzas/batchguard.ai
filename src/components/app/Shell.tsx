"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Activity, Bell, BookOpenCheck, Boxes, ChevronDown, Cpu, LayoutDashboard, LogOut, Menu, PhoneCall, Radio, Settings, Siren, Users, Workflow, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { MuseChip } from "@/components/muse/MuseChip";
import { MuseVoiceBar } from "@/components/muse/MuseConsole";
import { MuseLiveProvider } from "@/components/muse/MuseLive";
import { MuseLogo } from "@/components/muse/MuseLogo";
import { Badge } from "@/components/ui/Primitives";
import { useToast } from "@/components/ui/Toast";
import { fmtAgo, get, post, useLive, type LiveEvent, type Notification, type User } from "@/lib/api";

const NAV = [
  { href: "/app", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/app/machines", label: "Machines", icon: Cpu },
  { href: "/app/onboard", label: "Onboard machine", icon: BookOpenCheck },
  { href: "/app/workflow", label: "Workflow builder", icon: Workflow },
  { href: "/app/factory", label: "3D factory", icon: Boxes },
  { href: "/app/telemetry", label: "Telemetry", icon: Radio },
  { href: "/app/incidents", label: "Incidents", icon: Siren },
  { href: "/app/voice", label: "Voice AI · Gemini Live", icon: PhoneCall },
  { href: "/app/observability", label: "Observability", icon: Activity },
  { href: "/app/contacts", label: "Escalation contacts", icon: Users },
  { href: "/app/settings", label: "Settings & API", icon: Settings },
];

const MUSE_LINES: Record<string, string> = {
  "/app": "Here's your line at a glance. Green is good; I'll tell you the moment something drifts.",
  "/app/machines": "Every machine I'm watching. Click one for live charts against its verified limits.",
  "/app/onboard": "Upload a manual and I'll pre-fill the limits. You verify each one — nothing goes live unverified.",
  "/app/workflow": "Wire the line: upstream → downstream. I use this to reason across machines.",
  "/app/factory": "Your onboarded machines, live in 3D. Colours mirror what I'm seeing right now.",
  "/app/telemetry": "Raw readings as they arrive. Handy for checking a device is posting correctly.",
  "/app/incidents": "Everything I've caught, with evidence for and against each cause.",
  "/app/observability": "How the pipeline itself is doing: ingestion, API latency, my own runs.",
  "/app/contacts": "Who I call, and in what order. Quiet hours are respected except for emergencies.",
  "/app/settings": "Integrations and keys. Gemini and SMTP are optional — I fall back gracefully.",
};

type AppCtx = { user: User; live: boolean; subscribe: (fn: (e: LiveEvent) => void) => () => void; refreshUser: () => Promise<void> };
const Ctx = createContext<AppCtx | null>(null);
export const useApp = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp outside Shell");
  return c;
};

export function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [bell, setBell] = useState(false);
  const [menu, setMenu] = useState(false);
  const [listeners] = useState(() => new Set<(e: LiveEvent) => void>());

  const refreshUser = useCallback(async () => {
    try {
      const u = await get<User>("/api/auth/me");
      if (!u.org?.onboarded) router.replace("/onboarding");
      setUser(u);
    } catch {
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    if (user) get<Notification[]>("/api/notifications").then(setNotifs).catch(() => {});
  }, [user]);

  const live = useLive(
    (e) => {
      listeners.forEach((fn) => fn(e));
      if (e.type === "notification") {
        const n = e.data as unknown as Notification;
        setNotifs((s) => [n, ...s].slice(0, 50));
        if (n.channel === "in_app") toast(n.subject.includes("CRITICAL") || n.subject.includes("EMERGENCY") ? "error" : "warning", n.subject, n.body, 8000);
      }
      if (e.type === "incident" && e.data.status === "resolved") toast("success", "Incident resolved", String(e.data.title));
    },
    Boolean(user),
  );

  const subscribe = useCallback((fn: (e: LiveEvent) => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, [listeners]);

  const ctx = useMemo(() => (user ? { user, live, subscribe, refreshUser } : null), [user, live, subscribe, refreshUser]);
  const unread = notifs.filter((n) => !n.read && n.channel === "in_app").length;
  const museLine = MUSE_LINES[Object.keys(MUSE_LINES).filter((k) => pathname === k || (k !== "/app" && pathname.startsWith(k))).sort((a, b) => b.length - a.length)[0] ?? "/app"];

  if (!ctx) return <div className="grid min-h-screen place-items-center text-sm text-muted">Loading your factory…</div>;

  async function logout() {
    await post("/api/auth/logout");
    router.replace("/login");
  }

  return (
    <Ctx.Provider value={ctx}>
      <MuseLiveProvider>
      <div className="flex min-h-screen bg-bg">
        {/* sidebar */}
        <aside className={`fixed inset-y-0 left-0 z-40 w-64 border-r border-line bg-white transition-transform lg:static lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="flex h-16 items-center justify-between px-5">
            <Link href="/app" className="flex items-center gap-2.5">
              <MuseLogo size={36} />
              <span className="font-display text-lg font-semibold text-ink">
                BatchGuard <span className="text-blue">AI</span>
              </span>
            </Link>
            <button onClick={() => setOpen(false)} className="lg:hidden" aria-label="Close menu">
              <X size={18} />
            </button>
          </div>
          <nav className="mt-2 space-y-0.5 px-3">
            {NAV.map((n) => {
              const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
              const Icon = n.icon;
              return (
                <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${active ? "bg-blue text-white shadow-sm shadow-blue/25" : "text-muted hover:bg-sky-soft hover:text-ink"}`}>
                  <Icon size={17} />
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="absolute inset-x-0 bottom-0 border-t border-line p-4">
            <div className="flex items-center gap-2 text-xs text-muted">
              <span className={`h-2 w-2 rounded-full ${live ? "bg-green" : "bg-amber"}`} />
              {live ? "Live stream connected" : "Reconnecting…"}
            </div>
            <p className="mt-2 truncate text-xs text-muted">{ctx.user.org?.name}</p>
          </div>
        </aside>
        {open && <div className="fixed inset-0 z-30 bg-ink/30 lg:hidden" onClick={() => setOpen(false)} />}

        {/* main */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-line bg-white/80 px-4 backdrop-blur sm:px-6">
            <div className="flex items-center gap-3">
              <button onClick={() => setOpen(true)} className="lg:hidden" aria-label="Open menu">
                <Menu size={20} />
              </button>
              <p className="font-display text-xl font-semibold text-ink">{NAV.find((n) => (n.exact ? pathname === n.href : pathname.startsWith(n.href)))?.label ?? "BatchGuard"}</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <button onClick={() => { setBell((b) => !b); if (!bell && unread) post("/api/notifications/read").then(() => setNotifs((s) => s.map((n) => ({ ...n, read: 1 })))); }} className="relative rounded-xl p-2 text-muted hover:bg-sky-soft hover:text-ink" aria-label="Notifications">
                  <Bell size={20} />
                  {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-red px-1 font-mono text-[10px] font-bold text-white">{unread}</span>}
                </button>
                <AnimatePresence>
                  {bell && (
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className="card absolute right-0 mt-2 w-[380px] max-w-[calc(100vw-2rem)] rounded-2xl p-2">
                      <p className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Notifications</p>
                      <div className="max-h-[60vh] overflow-y-auto">
                        {notifs.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">Nothing yet. Muse will post here when a machine drifts.</p>}
                        {notifs.map((n) => (
                          <Link key={n.id} href={n.incident_id ? `/app/incidents/${n.incident_id}` : "/app/incidents"} onClick={() => setBell(false)} className="block rounded-xl px-3 py-2.5 hover:bg-sky-soft">
                            <div className="flex items-center justify-between gap-2">
                              <Badge tone={n.channel === "voice" ? "violet" : n.channel === "email" ? "blue" : n.status.startsWith("failed") ? "red" : "green"}>{n.channel} · {n.status}</Badge>
                              <span className="text-[11px] text-muted">{fmtAgo(n.sent_at)}</span>
                            </div>
                            <p className="mt-1 truncate text-sm font-semibold text-ink">{n.subject}</p>
                            <p className="truncate text-xs text-muted">{n.body}</p>
                          </Link>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <div className="relative">
                <button onClick={() => { setMenu((m) => !m); setBell(false); }} aria-expanded={menu} className={`flex items-center gap-2 rounded-xl border bg-white px-3 py-1.5 text-sm transition ${menu ? "border-blue ring-4 ring-blue/10" : "border-line hover:border-blue/50"}`}>
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-blue text-xs font-bold text-white">{ctx.user.name.slice(0, 1).toUpperCase()}</span>
                  <span className="hidden sm:inline">{ctx.user.name}</span>
                  <ChevronDown size={14} className={`text-muted transition ${menu ? "rotate-180" : ""}`} />
                </button>
                <AnimatePresence>
                  {menu && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className="card absolute right-0 z-20 mt-2 w-60 rounded-xl p-1.5">
                        <div className="px-3 py-2">
                          <p className="truncate text-sm font-semibold text-ink">{ctx.user.name}</p>
                          <p className="truncate text-xs text-muted">{ctx.user.email}</p>
                          <p className="mt-1 truncate text-[11px] text-muted">{ctx.user.org?.name}</p>
                        </div>
                        <div className="my-1 h-px bg-line" />
                        <Link href="/app/settings" onClick={() => setMenu(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink hover:bg-sky-soft"><Settings size={14} /> Settings & API</Link>
                        <Link href="/app/contacts" onClick={() => setMenu(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink hover:bg-sky-soft"><Users size={14} /> Escalation contacts</Link>
                        <div className="my-1 h-px bg-line" />
                        <button onClick={logout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-red hover:bg-red/5"><LogOut size={14} /> Sign out</button>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </header>
          <main className="flex-1 p-4 sm:p-6">{children}</main>
        </div>

        {pathname !== "/app" && <MuseChip line={museLine} />}
        {pathname !== "/app" && <MuseVoiceBar />}
      </div>
      </MuseLiveProvider>
    </Ctx.Provider>
  );
}
