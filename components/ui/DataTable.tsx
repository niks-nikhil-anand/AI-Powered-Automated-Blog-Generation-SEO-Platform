"use client";

import React from "react";

interface Column {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  render?: (row: any) => React.ReactNode;
}

interface DataTableProps {
  columns: Column[];
  data: any[];
  onRowClick?: (row: any) => void;
  minWidth?: string;
}

export function DataTable({ columns, data, onRowClick, minWidth = "100%" }: DataTableProps) {
  return (
    <div className="overflow-x-auto w-full">
      <table className="w-full border-collapse text-[12px]" style={{ minWidth }}>
        <thead>
          <tr className="bg-[var(--card2)] border-b border-[var(--bd)]">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`p-[8px_12px] text-[10px] font-bold tracking-wider uppercase text-[var(--mut)] ${
                  col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"
                }`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, rIdx) => (
            <tr
              key={row.id || rIdx}
              onClick={() => onRowClick && onRowClick(row)}
              className="border-b border-[var(--bd)] hover:bg-[var(--card2)] transition-colors cursor-pointer"
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`p-[9px_12px] ${
                    col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"
                  }`}
                >
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
