"use client";

import React, { useCallback, useEffect, useState } from "react";

type Topic = {
  id: string;
  title: string;
  description: string | null;
  keywords: string[];
  category: string | null;
  priority: string;
  status: string;
  createdAt: string;
  usedAt: string | null;
  lastResearchedAt: string | null;
};

const priorities = ["LOW", "NORMAL", "HIGH", "URGENT"];
const statuses = ["PENDING", "RESEARCHING", "QUALIFIED", "SELECTED", "USED", "REJECTED", "ARCHIVED"];

export default function TopicsPoolPage() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [stats, setStats] = useState({ pending: 0, highPriority: 0, used: 0, archived: 0 });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("PENDING");
  const [form, setForm] = useState({ title: "", description: "", keywords: "", category: "", priority: "NORMAL", notes: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (status !== "ALL") params.set("status", status);
    fetch(`/api/topics-pool?${params}`)
      .then((res) => res.json())
      .then((data) => { setTopics(data.topics ?? []); setStats(data.stats ?? { pending: 0, highPriority: 0, used: 0, archived: 0 }); })
      .catch(() => setMessage("Failed to load topics"))
      .finally(() => setLoading(false));
  }, [q, status]);

  // Initial data loading is the external synchronization this effect exists for.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const addTopic = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true); setMessage("");
    try {
      const res = await fetch("/api/topics-pool", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add topic");
      setForm({ title: "", description: "", keywords: "", category: "", priority: "NORMAL", notes: "" });
      setMessage("Topic added to the pool");
      load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Failed to add topic"); }
    finally { setSaving(false); }
  };

  const update = async (id: string, data: Record<string, string>) => {
    await fetch(`/api/topics-pool/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    load();
  };

  const research = async (id: string) => {
    const res = await fetch(`/api/topics-pool/${id}/research`, { method: "POST" });
    setMessage(res.ok ? "Topic research queued" : "Failed to queue topic research");
  };

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex items-start justify-between gap-[12px]">
        <div><h1 className="text-[22px] font-bold">Topics Pool</h1><p className="text-[12px] text-[var(--mut)] mt-[4px]">Curated topics used only when automated research cannot fill the target.</p></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[10px]">
        {[['Pending', stats.pending], ['High Priority', stats.highPriority], ['Used', stats.used], ['Archived', stats.archived]].map(([label, value]) => <div key={String(label)} className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] p-[13px]"><div className="text-[10px] uppercase tracking-wider text-[var(--mut)]">{label}</div><div className="text-[22px] font-bold mt-[4px]">{value}</div></div>)}
      </div>
      <div className="grid lg:grid-cols-[minmax(280px,360px)_1fr] gap-[16px] items-start">
        <form onSubmit={addTopic} className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] p-[14px] flex flex-col gap-[10px]">
          <div className="font-bold">Add topic</div>
          <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Topic title" className="h-[36px] px-[10px] rounded-[8px] border border-[var(--bd)] bg-[var(--card2)]" />
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description (optional)" className="min-h-[70px] p-[10px] rounded-[8px] border border-[var(--bd)] bg-[var(--card2)]" />
          <input value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} placeholder="Keywords, comma separated" className="h-[36px] px-[10px] rounded-[8px] border border-[var(--bd)] bg-[var(--card2)]" />
          <div className="grid grid-cols-2 gap-[8px]"><input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Category" className="h-[36px] px-[10px] rounded-[8px] border border-[var(--bd)] bg-[var(--card2)]" /><select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="h-[36px] px-[8px] rounded-[8px] border border-[var(--bd)] bg-[var(--card2)]">{priorities.map((item) => <option key={item}>{item}</option>)}</select></div>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Internal notes (optional)" className="min-h-[55px] p-[10px] rounded-[8px] border border-[var(--bd)] bg-[var(--card2)]" />
          <button disabled={saving} className="h-[36px] rounded-[8px] bg-[var(--indigo)] text-white font-bold disabled:opacity-50">{saving ? "Adding..." : "Add to pool"}</button>
          {message && <div className="text-[11px] text-[var(--mut)]">{message}</div>}
        </form>
        <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] overflow-hidden">
          <div className="p-[12px] border-b border-[var(--bd)] flex flex-wrap gap-[8px]"><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="Search topics" className="h-[34px] flex-1 min-w-[180px] px-[10px] rounded-[8px] border border-[var(--bd)] bg-[var(--card2)]" /><select value={status} onChange={(e) => setStatus(e.target.value)} className="h-[34px] px-[8px] rounded-[8px] border border-[var(--bd)] bg-[var(--card2)]"><option>ALL</option>{statuses.map((item) => <option key={item}>{item}</option>)}</select><button onClick={load} className="h-[34px] px-[12px] rounded-[8px] border border-[var(--bd)] font-semibold">Refresh</button></div>
          {loading ? <div className="p-[24px] text-[var(--mut)]">Loading topics...</div> : topics.length === 0 ? <div className="p-[32px] text-center text-[var(--mut)]">No topics in this view.</div> : <div className="overflow-x-auto"><table className="w-full text-[11px]"><thead><tr className="border-b border-[var(--bd)] text-left text-[9px] uppercase tracking-wider text-[var(--mut)]"><th className="p-[10px]">Topic</th><th className="p-[10px]">Category</th><th className="p-[10px]">Priority</th><th className="p-[10px]">Status</th><th className="p-[10px]">Actions</th></tr></thead><tbody>{topics.map((topic) => <tr key={topic.id} className="border-b border-[var(--bd)] last:border-0"><td className="p-[10px] min-w-[220px]"><div className="font-bold">{topic.title}</div><div className="text-[10px] text-[var(--mut)]">{topic.keywords.join(", ")}</div></td><td className="p-[10px]">{topic.category || "—"}</td><td className="p-[10px]"><select value={topic.priority} onChange={(e) => update(topic.id, { priority: e.target.value })} className="bg-transparent font-semibold">{priorities.map((item) => <option key={item}>{item}</option>)}</select></td><td className="p-[10px]">{topic.status}</td><td className="p-[10px] whitespace-nowrap"><button onClick={() => research(topic.id)} className="text-[var(--indigo)] font-bold mr-[10px]">Research</button><button onClick={() => update(topic.id, { status: "ARCHIVED" })} className="text-[var(--rose)] font-bold">Archive</button></td></tr>)}</tbody></table></div>}
        </div>
      </div>
    </div>
  );
}
