"use client";

import React from "react";

interface StatusBadgeProps {
  status: string;
  sBg?: string;
  sFg?: string;
  sBd?: string;
  className?: string;
}

export function StatusBadge({
  status,
  sBg = "var(--card2)",
  sFg = "var(--fg2)",
  sBd = "var(--bd)",
  className = "",
}: StatusBadgeProps) {
  return (
    <span
      className={`font-semibold text-[10.5px] p-[2.5px_8px] rounded-full border whitespace-nowrap inline-block ${className}`}
      style={{
        background: sBg,
        color: sFg,
        borderColor: sBd,
      }}
    >
      {status}
    </span>
  );
}
