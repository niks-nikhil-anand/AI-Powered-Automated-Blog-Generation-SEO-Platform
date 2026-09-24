"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";

type Category = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  _count: { blogs: number; blogInputs: number };
};

type FormState = {
  name: string;
  slug: string;
  description: string;
  color: string;
  isActive: boolean;
  sortOrder: number;
};

const emptyForm: FormState = { name: "", slug: "", description: "", color: "#6366f1", isActive: true, sortOrder: 0 };

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editing, setEditing] = useState<Category | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadCategories = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ pageSize: "100" });
      if (search.trim()) params.set("search", search.trim());
      if (active !== "all") params.set("active", active);
      const response = await fetch(`/api/categories?${params.toString()}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load categories");
      setCategories(data.categories ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load categories");
    } finally {
      setLoading(false);
    }
  }, [active, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadCategories(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCategories]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEdit(category: Category) {
    setEditing(category);
    setForm({ name: category.name, slug: category.slug, description: category.description ?? "", color: category.color, isActive: category.isActive, sortOrder: category.sortOrder });
    setFormOpen(true);
  }

  async function saveCategory(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch(editing ? `/api/categories/${editing.id}` : "/api/categories", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save category");
      setForm(emptyForm);
      setEditing(null);
      setFormOpen(false);
      await loadCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save category");
    } finally {
      setSaving(false);
    }
  }

  async function toggleCategory(category: Category) {
    const response = await fetch(`/api/categories/${category.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !category.isActive }) });
    if (!response.ok) { const data = await response.json(); setError(data.error || "Unable to update category"); return; }
    await loadCategories();
  }

  async function deleteCategory(category: Category) {
    if (!window.confirm(`Delete “${category.name}”?`)) return;
    const response = await fetch(`/api/categories/${category.id}`, { method: "DELETE" });
    if (!response.ok) { const data = await response.json(); setError(data.error || "Unable to delete category"); return; }
    await loadCategories();
  }

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex flex-col gap-[12px] sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="margin-0 text-[19px] font-extrabold tracking-tight text-[var(--fg)]">Categories</h1>
          <p className="margin-0 mt-[3px] text-[12px] text-[var(--mut)]">Organize blogs with reusable content categories.</p>
        </div>
        <button onClick={openCreate} className="h-[42px] rounded-[8px] bg-[var(--indigo)] px-[13px] text-[12px] font-semibold text-white hover:bg-[#4f46e5] transition-colors sm:h-[32px]">
          <Plus size={14} className="mr-[6px] inline" /> Add category
        </button>
      </div>

      {error && <div className="rounded-[9px] border border-[rgba(244,63,94,0.3)] bg-[rgba(244,63,94,0.08)] p-[10px_12px] text-[12px] text-[var(--rose)]">{error}</div>}

      <div className="flex flex-col gap-[8px] rounded-[12px] border border-[var(--bd)] bg-[var(--card)] p-[10px] shadow-[var(--shadow)] sm:flex-row">
        <label className="flex h-[42px] flex-1 items-center gap-[8px] rounded-[8px] border border-[var(--bd)] bg-[var(--card2)] px-[10px] text-[var(--mut)] sm:h-[32px]">
          <Search size={14} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search categories" className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--fg)] outline-none placeholder:text-[var(--faint)]" />
        </label>
        <select value={active} onChange={(event) => setActive(event.target.value)} className="h-[42px] rounded-[8px] border border-[var(--bd)] bg-[var(--card2)] px-[9px] text-[12px] text-[var(--fg2)] outline-none sm:h-[32px]">
          <option value="all">All statuses</option><option value="true">Active</option><option value="false">Inactive</option>
        </select>
      </div>

      <section className="overflow-hidden rounded-[12px] border border-[var(--bd)] bg-[var(--card)] shadow-[var(--shadow)]">
        <div className="flex items-center justify-between border-b border-[var(--bd)] p-[12px_14px]"><span className="text-[13px] font-bold text-[var(--fg)]">Category directory</span><span className="text-[11px] text-[var(--mut)]">{categories.length} categories</span></div>
        {loading ? <div className="p-[28px] text-center text-[12px] text-[var(--mut)]">Loading categories…</div> : categories.length === 0 ? <div className="p-[36px_14px] text-center text-[12px] text-[var(--mut)]">No categories found. Add your first category to get started.</div> : (
          <>
            <div className="hidden overflow-x-auto md:block"><table className="w-full border-collapse text-[12px]"><thead><tr className="bg-[var(--card2)] text-[var(--mut)]"><th className="p-[9px_14px] text-left text-[10px] uppercase tracking-wider">Category</th><th className="p-[9px_8px] text-left text-[10px] uppercase tracking-wider">Slug</th><th className="p-[9px_8px] text-left text-[10px] uppercase tracking-wider">Description</th><th className="p-[9px_8px] text-right text-[10px] uppercase tracking-wider">Blogs</th><th className="p-[9px_8px] text-left text-[10px] uppercase tracking-wider">Status</th><th className="p-[9px_14px] text-right text-[10px] uppercase tracking-wider">Actions</th></tr></thead><tbody>{categories.map((category) => <tr key={category.id} className="border-t border-[var(--bd)]"><td className="p-[10px_14px]"><span className="mr-[8px] inline-block h-[8px] w-[8px] rounded-full" style={{ background: category.color }} /><span className="font-semibold text-[var(--fg)]">{category.name}</span></td><td className="p-[10px_8px] font-mono text-[10.5px] text-[var(--mut)]">{category.slug}</td><td className="max-w-[300px] truncate p-[10px_8px] text-[11px] text-[var(--mut)]">{category.description || "—"}</td><td className="p-[10px_8px] text-right font-mono text-[11px] text-[var(--fg2)]">{category._count.blogs}</td><td className="p-[10px_8px]"><button onClick={() => void toggleCategory(category)} className="rounded-full border px-[8px] py-[2px] text-[10px] font-semibold" style={{ color: category.isActive ? "var(--emerald)" : "var(--mut)", borderColor: category.isActive ? "rgba(16,185,129,.3)" : "var(--bd)" }}>{category.isActive ? "Active" : "Inactive"}</button></td><td className="p-[10px_14px] text-right"><button onClick={() => openEdit(category)} className="mr-[5px] inline-flex h-[28px] w-[28px] items-center justify-center rounded-[6px] border border-[var(--bd)] text-[var(--mut)] hover:text-[var(--indigo)]"><Pencil size={13} /></button><button onClick={() => void deleteCategory(category)} className="inline-flex h-[28px] w-[28px] items-center justify-center rounded-[6px] border border-[var(--bd)] text-[var(--mut)] hover:text-[var(--rose)]"><Trash2 size={13} /></button></td></tr>)}</tbody></table></div>
            <div className="grid gap-[8px] p-[8px] md:hidden">{categories.map((category) => <div key={category.id} className="rounded-[9px] border border-[var(--bd)] bg-[var(--card2)] p-[11px]"><div className="flex items-start gap-[8px]"><span className="mt-[4px] h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: category.color }} /><div className="min-w-0 flex-1"><div className="font-semibold text-[12px] text-[var(--fg)]">{category.name}</div><div className="font-mono text-[10px] text-[var(--mut)]">{category.slug}</div></div><button onClick={() => void toggleCategory(category)} className="text-[10px] font-semibold" style={{ color: category.isActive ? "var(--emerald)" : "var(--mut)" }}>{category.isActive ? "Active" : "Inactive"}</button></div><p className="mt-[7px] text-[11px] text-[var(--mut)]">{category.description || "No description"}</p><div className="mt-[8px] flex items-center justify-between text-[10px] text-[var(--faint)]"><span>{category._count.blogs} blogs</span><span><button onClick={() => openEdit(category)} className="mr-[10px] text-[var(--indigo)]">Edit</button><button onClick={() => void deleteCategory(category)} className="text-[var(--rose)]">Delete</button></span></div></div>)}</div>
          </>
        )}
      </section>

      {formOpen && <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-4"><div className="w-full max-w-[520px] rounded-t-[14px] border border-[var(--bd)] bg-[var(--card)] p-[16px] shadow-2xl sm:rounded-[14px]"><div className="mb-[14px] flex items-center justify-between"><h2 className="text-[15px] font-bold text-[var(--fg)]">{editing ? "Edit category" : "Add category"}</h2><button onClick={() => { setEditing(null); setForm(emptyForm); setFormOpen(false); }} className="text-[11px] text-[var(--mut)]">Cancel</button></div><form onSubmit={saveCategory} className="grid gap-[11px]"><label className="grid gap-[5px] text-[11px] font-semibold text-[var(--mut)]">Name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value, slug: editing ? form.slug : slugify(event.target.value) })} className="h-[42px] rounded-[8px] border border-[var(--bd)] bg-[var(--card2)] px-[10px] text-[12px] text-[var(--fg)] outline-none" /></label><label className="grid gap-[5px] text-[11px] font-semibold text-[var(--mut)]">Slug<input value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} className="h-[42px] rounded-[8px] border border-[var(--bd)] bg-[var(--card2)] px-[10px] font-mono text-[12px] text-[var(--fg)] outline-none" /></label><label className="grid gap-[5px] text-[11px] font-semibold text-[var(--mut)]">Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} className="rounded-[8px] border border-[var(--bd)] bg-[var(--card2)] p-[9px] text-[12px] text-[var(--fg)] outline-none" /></label><div className="grid grid-cols-2 gap-[9px]"><label className="grid gap-[5px] text-[11px] font-semibold text-[var(--mut)]">Color<input type="color" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} className="h-[42px] w-full rounded-[8px] border border-[var(--bd)] bg-[var(--card2)] p-[4px]" /></label><label className="grid gap-[5px] text-[11px] font-semibold text-[var(--mut)]">Sort order<input type="number" min={0} value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) })} className="h-[42px] rounded-[8px] border border-[var(--bd)] bg-[var(--card2)] px-[10px] text-[12px] text-[var(--fg)]" /></label></div><label className="flex min-h-[42px] items-center gap-[8px] text-[12px] text-[var(--fg2)]"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} /> Active category</label><button disabled={saving} className="h-[42px] rounded-[8px] bg-[var(--indigo)] text-[12px] font-semibold text-white disabled:opacity-60">{saving ? "Saving…" : editing ? "Save changes" : "Create category"}</button></form></div></div>}
    </div>
  );
}
