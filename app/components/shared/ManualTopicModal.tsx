"use client";

import React, { useState } from "react";

interface ManualTopicModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit?: (topic: { title: string; category: string; source: string; score: number }) => void;
}

export function ManualTopicModal({ isOpen, onClose, onSubmit }: ManualTopicModalProps) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Frameworks");
  const [source, setSource] = useState("Manual Entry");

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    if (onSubmit) {
      onSubmit({
        title,
        category,
        source,
        score: 95,
      });
    }
    setTitle("");
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[rgba(2,6,23,0.6)] backdrop-blur-sm flex items-center justify-center p-[16px] animate-dkfade"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[480px] bg-[var(--card)] border border-[var(--bd)] rounded-[14px] shadow-[var(--shadow)] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-[16px] h-[48px] border-b border-[var(--bd)] bg-[var(--card2)]">
          <span className="text-[13px] font-bold text-[var(--fg)]">+ Add Manual Topic to Pipeline</span>
          <button
            onClick={onClose}
            className="w-[26px] h-[26px] rounded-[6px] border border-[var(--bd)] bg-[var(--card)] text-[var(--mut)] hover:text-[var(--fg)] flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-[16px] flex flex-col gap-[14px]">
          <div>
            <label className="block text-[11.5px] font-semibold text-[var(--fg2)] mb-[5px]">
              Topic Title / Keyword
            </label>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter a topic title"
              className="w-full h-[34px] px-[10px] rounded-[8px] border border-[var(--bd)] bg-[var(--card2)] text-[12px] text-[var(--fg)] outline-none focus:border-[var(--indigo)]"
            />
          </div>

          <div className="grid grid-cols-2 gap-[12px]">
            <div>
              <label className="block text-[11.5px] font-semibold text-[var(--fg2)] mb-[5px]">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full h-[34px] px-[8px] rounded-[8px] border border-[var(--bd)] bg-[var(--card2)] text-[12px] font-semibold text-[var(--fg)] outline-none"
              >
                <option>Frameworks</option>
                <option>Runtime</option>
                <option>DevOps</option>
                <option>AI Tooling</option>
                <option>TypeScript</option>
              </select>
            </div>
            <div>
              <label className="block text-[11.5px] font-semibold text-[var(--fg2)] mb-[5px]">
                Source Label
              </label>
              <input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="Manual"
                className="w-full h-[34px] px-[10px] rounded-[8px] border border-[var(--bd)] bg-[var(--card2)] text-[12px] text-[var(--fg)] outline-none"
              />
            </div>
          </div>

          <div className="flex gap-[8px] justify-end mt-[6px]">
            <button
              type="button"
              onClick={onClose}
              className="h-[32px] px-[14px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[12px] font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="h-[32px] px-[16px] rounded-[8px] border border-transparent bg-[var(--indigo)] text-white text-[12px] font-bold hover:bg-[#4f46e5]"
            >
              Add to Pipeline
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
