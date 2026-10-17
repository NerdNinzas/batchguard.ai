"use client";
import { Spot } from "@/components/muse/MuseLive";

import { Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app/Shell";
import { Button, Card, Input, Spinner } from "@/components/ui/Primitives";
import { useToast } from "@/components/ui/Toast";
import { del, get, post, put, type Contact } from "@/lib/api";

export default function ContactsPage() {
  const { toast } = useToast();
  const [items, setItems] = useState<Contact[] | null>(null);
  const [draft, setDraft] = useState<Partial<Contact>>({ name: "", role: "", phone: "", email: "", escalation_order: 1, quiet_start: "", quiet_end: "" });
  const load = () => get<Contact[]>("/api/contacts").then((c) => { setItems(c); setDraft((d) => ({ ...d, escalation_order: c.length + 1 })); });
  useEffect(() => { load(); }, []);
  const { subscribe } = useApp();
  useEffect(() => subscribe((e) => { if (e.type === "contact") load(); }), [subscribe]);
  if (!items) return <Spinner />;

  async function add() {
    if (!draft.name) return toast("warning", "Name is required");
    await post("/api/contacts", draft);
    setDraft({ name: "", role: "", phone: "", email: "", escalation_order: items!.length + 2, quiet_start: "", quiet_end: "" });
    toast("success", "Contact added");
    load();
  }
  async function save(c: Contact) { await put(`/api/contacts/${c.id}`, c); toast("success", "Saved"); load(); }
  async function remove(id: string) { await del(`/api/contacts/${id}`); load(); }
  const set = (id: string, patch: Partial<Contact>) => setItems((s) => s!.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  return (
    <div className="space-y-5">
      <Spot k="ladder"><Card title="Escalation ladder" action={<span className="text-xs text-muted">Warning → email #1 · Critical → email + call #1 · no ack in 2 min → next contact, repeat</span>}>
        <div className="space-y-3">
          {items.map((c) => (
            <Spot key={c.id} k={c.id} className="rounded-xl"><div className="grid gap-2 rounded-xl border border-line bg-white p-3 sm:grid-cols-[auto_1fr_1fr_1fr_1fr_auto_auto_auto] sm:items-end">
              <input type="number" min={1} value={c.escalation_order} onChange={(e) => set(c.id, { escalation_order: Number(e.target.value) })} className="w-14 rounded-lg border border-line px-2 py-2 text-center font-mono text-sm" />
              <Input label="Name" value={c.name} onChange={(e) => set(c.id, { name: e.target.value })} />
              <Input label="Role" value={c.role} onChange={(e) => set(c.id, { role: e.target.value })} />
              <Input label="Phone" value={c.phone} onChange={(e) => set(c.id, { phone: e.target.value })} />
              <Input label="Email" value={c.email} onChange={(e) => set(c.id, { email: e.target.value })} />
              <Input label="Quiet from" type="time" value={c.quiet_start ?? ""} onChange={(e) => set(c.id, { quiet_start: e.target.value })} className="w-28" />
              <Input label="to" type="time" value={c.quiet_end ?? ""} onChange={(e) => set(c.id, { quiet_end: e.target.value })} className="w-28" />
              <div className="flex gap-1"><Button size="sm" variant="secondary" onClick={() => save(c)}><Save size={14} /></Button><Button size="sm" variant="ghost" onClick={() => remove(c.id)}><Trash2 size={14} /></Button></div>
            </div></Spot>
          ))}
        </div>
      </Card></Spot>
      <Card title="Add contact">
        <div className="grid gap-2 sm:grid-cols-5 sm:items-end">
          <Input label="Name" value={draft.name ?? ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <Input label="Role" value={draft.role ?? ""} onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
          <Input label="Phone" value={draft.phone ?? ""} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
          <Input label="Email" value={draft.email ?? ""} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
          <Button onClick={add}><Plus size={14} /> Add</Button>
        </div>
        <p className="mt-2 text-xs text-muted">Quiet hours suppress warning emails; critical and emergency escalations always go through.</p>
      </Card>
    </div>
  );
}
