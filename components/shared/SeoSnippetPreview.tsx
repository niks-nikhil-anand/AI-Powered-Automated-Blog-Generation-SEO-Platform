"use client";

import React from "react";

interface SeoSnippetPreviewProps {
  title: string;
  slug: string;
  description: string;
  siteUrl?: string;
}

/**
 * Rough approximation of how the article would render as a Google search
 * result. Not pixel-accurate to Google's actual SERP - the point is giving
 * a felt sense of truncation at realistic character budgets, which a raw
 * "metaTitle: 74 chars" number doesn't convey.
 */
export function SeoSnippetPreview({ title, slug, description, siteUrl = "yourdomain.com" }: SeoSnippetPreviewProps) {
  // Fixed light background on purpose: a real Google result renders on a
  // white SERP regardless of the app's own theme, so this preview
  // shouldn't flip with dark mode - that would make it a less faithful
  // preview, not a more consistent one.
  return (
    <div
      className="border border-[var(--bd)] rounded-[10px] p-[12px_14px]"
      style={{ background: "#fff" }}
    >
      <div className="flex items-center gap-[8px]">
        <div className="w-[22px] h-[22px] rounded-full flex-none" style={{ background: "#e8eaed" }} />
        <div className="min-w-0">
          <div className="text-[12.5px] leading-tight truncate" style={{ color: "#202124" }}>
            {siteUrl}
          </div>
          <div className="text-[10.5px] leading-tight truncate font-mono" style={{ color: "#5f6368" }}>
            {siteUrl}/blog/{slug}
          </div>
        </div>
      </div>
      <div
        className="mt-[6px] text-[16px] leading-snug overflow-hidden text-ellipsis whitespace-nowrap"
        style={{ color: "#1a0dab" }}
        title={title}
      >
        {title || "Untitled article"}
      </div>
      <div
        className="mt-[2px] text-[12.5px] leading-snug overflow-hidden"
        style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", color: "#4d5156" }}
      >
        {description || "No meta description generated yet."}
      </div>
    </div>
  );
}
