"use client";

import { motion } from "framer-motion";
import { Activity, Building2, CheckCircle2, Gauge, Leaf, PhoneCall, Plus, ShieldCheck, Trash2, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MuseGuide } from "@/components/muse/MuseGuide";
import { MuseLogo } from "@/components/muse/MuseLogo";
import { Button, Input, Modal, Select } from "@/components/ui/Primitives";
import { useToast } from "@/components/ui/Toast";
import { get, post, put, type Contact, type User } from "@/lib/api";

const USE_CASES = [
  { id: "predictive_maintenance", label: "Predictive maintenance", body: "Catch bearing wear, overheating and drift before a breakdown.", icon: Wrench },
  { id: "quality", label: "Quality drift", body: "Link speed, load and temperature drift to defective output.", icon: Gauge },
  { id: "reliability", label: "Reliability & uptime", body: "Know the line is healthy; be called when it isn't.", icon: Activity },
  { id: "escalation", label: "Night-shift escalation", body: "Email and voice escalation when nobody is watching the dashboard.", icon: PhoneCall },
  { id: "sustainability", label: "Energy & scrap", body: "Less scrap, less energy wasted on faulty runs.", icon: Leaf },
  { id: "compliance", label: "Audit trail", body: "Every incident, diagnosis and fix recorded with evidence.", icon: ShieldCheck },
];

const STEPS = ["Organisation", "Use cases", "Escalation contacts", "Done"];

const LINES = [
  "First, tell me about your factory. The owner's phone is what I call when something is critical.",
  "What do you want me to watch for? Pick everything that applies — it tunes what I prioritise.",
  "Who should I reach, and in which order? If the first person doesn't answer or acknowledge, I call the next, once each.",
  "That's it! You're registered. Next, let's onboard your first machine from its manual.",
];

export default function OnboardingPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [org, setOrg] = useState({ name: "", owner_name: "", owner_email: "", phone: "", industry: "Packaging", size: "11-50", timezone: "Asia/Singapore" });
  const [uses, setUses] = useState<string[]>([]);
  const [contacts, setContacts] = useState<Partial<Contact>[]>([{ name: "", role: "Owner", phone: "", email: "", escalation_order: 1 }]);

  useEffect(() => {
    get<User>("/api/auth/me")
      .then((u) => {
        setUser(u);
        if (u.org?.onboarded) router.replace("/app");
        setOrg((o) => ({ ...o, owner_name: u.org?.owner_name || u.name, owner_email: u.org?.owner_email || u.email, name: u.org?.name || "", phone: u.org?.phone || "" }));
        if (u.org?.use_cases?.length) setUses(u.org.use_cases);
        setContacts((c) => [{ ...c[0], name: u.name, email: u.email }]);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  async function next() {
    setBusy(true);
    try {
      if (step === 0) {
        await post("/api/org", org);
        toast("success", "Organisation saved", `${org.name} is ready.`);
      } else if (step === 1) {
        if (!uses.length) {
          toast("warning", "Pick at least one use case");
          return;
        }
        await put("/api/org/use-cases", { use_cases: uses });
      } else if (step === 2) {
        const valid = contacts.filter((c) => c.name && (c.phone || c.email));
        if (!valid.length) {
          toast("warning", "Add at least one contact", "A name plus a phone or email.");
          return;
        }
        const existing = await get<Contact[]>("/api/contacts");
        if (!existing.length) for (const c of valid) await post("/api/contacts", { ...c, escalation_order: Number(c.escalation_order) || 1 });
        await post("/api/org/complete-onboarding");
        toast("success", "You're successfully registered 🎉", "Muse is on duty. Let's onboard your first machine.", 7000);
      } else {
        router.replace("/app/onboard");
        return;
      }
      setStep((s) => s + 1);
    } catch (e) {
      toast("error", "Could not save", e instanceof Error ? e.message : "Try again");
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;

  return (
    <main className="relative min-h-screen overflow-hidden bg-bg">
      <div className="grid-bg absolute inset-0" />
      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <MuseLogo size={40} />
          <span className="font-display text-xl font-semibold text-ink">
            BatchGuard <span className="text-blue">AI</span>
          </span>
        </div>
        <ol className="hidden items-center gap-2 md:flex">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span className={`grid h-7 w-7 place-items-center rounded-full font-mono text-xs font-semibold ${i < step ? "bg-green text-white" : i === step ? "bg-blue text-white" : "bg-sky-soft text-muted"}`}>{i < step ? <CheckCircle2 size={14} /> : i + 1}</span>
              <span className={`text-sm ${i === step ? "font-semibold text-ink" : "text-muted"}`}>{s}</span>
              {i < STEPS.length - 1 && <span className="mx-1 h-px w-8 bg-line" />}
            </li>
          ))}
        </ol>
      </header>

      <Modal open title={STEPS[step]} closable={false} width="max-w-2xl">
        {step === 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Organisation / factory name" value={org.name} onChange={(e) => setOrg({ ...org, name: e.target.value })} placeholder="Factory A" className="sm:col-span-2" autoFocus />
            <Input label="Owner name" value={org.owner_name} onChange={(e) => setOrg({ ...org, owner_name: e.target.value })} />
            <Input label="Owner email" type="email" value={org.owner_email} onChange={(e) => setOrg({ ...org, owner_email: e.target.value })} />
            <Input label="Phone (for critical calls)" value={org.phone} onChange={(e) => setOrg({ ...org, phone: e.target.value })} placeholder="+65 …" />
            <Select label="Industry" value={org.industry} onChange={(e) => setOrg({ ...org, industry: e.target.value })}>
              {["Packaging", "Food & beverage", "Automotive parts", "Electronics", "Textiles", "Pharma", "Plastics", "Metal fabrication", "Other"].map((x) => <option key={x}>{x}</option>)}
            </Select>
            <Select label="Team size" value={org.size} onChange={(e) => setOrg({ ...org, size: e.target.value })}>
              {["1-10", "11-50", "51-200", "201-1000", "1000+"].map((x) => <option key={x}>{x}</option>)}
            </Select>
            <Select label="Timezone" value={org.timezone} onChange={(e) => setOrg({ ...org, timezone: e.target.value })}>
              {["Asia/Singapore", "Asia/Kolkata", "Asia/Jakarta", "Asia/Tokyo", "Asia/Manila", "Australia/Sydney", "UTC"].map((x) => <option key={x}>{x}</option>)}
            </Select>
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {USE_CASES.map((u) => {
              const on = uses.includes(u.id);
              const Icon = u.icon;
              return (
                <button key={u.id} type="button" onClick={() => setUses((s) => (on ? s.filter((x) => x !== u.id) : [...s, u.id]))} className={`flex items-start gap-3 rounded-xl border p-4 text-left transition ${on ? "border-blue bg-blue/5 ring-4 ring-blue/10" : "border-line bg-white hover:border-blue/40"}`}>
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${on ? "bg-blue text-white" : "bg-sky-soft text-blue"}`}>
                    <Icon size={18} />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-ink">{u.label}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted">{u.body}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            {contacts.map((c, i) => (
              <motion.div key={i} layout className="grid gap-2 rounded-xl border border-line bg-white p-3 sm:grid-cols-[auto_1fr_1fr_1fr_1fr_auto] sm:items-end">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-blue font-mono text-xs font-semibold text-white">{i + 1}</span>
                <Input label="Name" value={c.name ?? ""} onChange={(e) => setContacts((s) => s.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
                <Input label="Role" value={c.role ?? ""} onChange={(e) => setContacts((s) => s.map((x, k) => (k === i ? { ...x, role: e.target.value } : x)))} placeholder="Maintenance lead" />
                <Input label="Phone" value={c.phone ?? ""} onChange={(e) => setContacts((s) => s.map((x, k) => (k === i ? { ...x, phone: e.target.value } : x)))} placeholder="+65 …" />
                <Input label="Email" type="email" value={c.email ?? ""} onChange={(e) => setContacts((s) => s.map((x, k) => (k === i ? { ...x, email: e.target.value } : x)))} />
                <button type="button" onClick={() => setContacts((s) => s.filter((_, k) => k !== i))} disabled={contacts.length === 1} className="rounded-lg p-2 text-muted hover:bg-sky-soft hover:text-red disabled:opacity-30" aria-label="Remove">
                  <Trash2 size={16} />
                </button>
              </motion.div>
            ))}
            <Button type="button" variant="secondary" size="sm" onClick={() => setContacts((s) => [...s, { name: "", role: "", phone: "", email: "", escalation_order: s.length + 1 }])}>
              <Plus size={14} /> Add next contact
            </Button>
            <p className="text-xs text-muted">Order matters: contact 1 is called first. Each contact gets one call; no answer or no acknowledgement moves to the next.</p>
          </div>
        )}

        {step === 3 && (
          <div className="grid place-items-center py-6 text-center">
            <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }} className="grid h-20 w-20 place-items-center rounded-full bg-green/15 text-green">
              <CheckCircle2 size={44} />
            </motion.div>
            <h3 className="font-display mt-5 text-3xl font-semibold text-ink">{org.name || "Your factory"} is registered</h3>
            <p className="mt-2 max-w-md text-sm text-muted">Muse is on duty. Now onboard your first machine: upload its PDF manual and Muse pre-fills every limit for you to verify.</p>
            <div className="mt-5 flex items-center gap-2 text-xs text-muted">
              <Building2 size={14} /> {org.industry} · {org.size} people · {org.timezone}
            </div>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between">
          <Button type="button" variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || step === 3}>
            Back
          </Button>
          <Button type="button" onClick={next} loading={busy} size="lg">
            {step === 3 ? "Onboard a machine →" : step === 2 ? "Finish registration" : "Continue"}
          </Button>
        </div>
      </Modal>

      <div className="pointer-events-none fixed bottom-4 right-4 z-[95] hidden md:block">
        <MuseGuide line={LINES[step]} />
      </div>
    </main>
  );
}
