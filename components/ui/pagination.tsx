"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react"

import { cn } from "@/lib/utils"

function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      data-slot="pagination"
      className={cn("flex w-full items-center justify-center gap-[6px]", className)}
      {...props}
    />
  )
}

function PaginationContent({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex flex-row items-center gap-[4px]", className)}
      {...props}
    />
  )
}

function PaginationItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li data-slot="pagination-item" className={cn(className)} {...props} />
  )
}

type PaginationLinkProps = React.ComponentProps<"button"> & {
  isActive?: boolean
  size?: "default" | "icon"
}

function PaginationLink({
  className,
  isActive,
  size = "icon",
  disabled,
  ...props
}: PaginationLinkProps) {
  return (
    <button
      type="button"
      aria-current={isActive ? "page" : undefined}
      data-active={isActive}
      data-slot="pagination-link"
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-[7px] border font-mono text-[11px] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40",
        size === "icon" ? "h-[26px] w-[26px]" : "h-[26px] gap-[4px] px-[10px]",
        isActive
          ? "border-[rgba(99,102,241,0.3)] bg-[var(--tint)] text-[var(--indigo)]"
          : "border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] hover:border-[var(--bd2)] hover:text-[var(--fg)]",
        className
      )}
      {...props}
    />
  )
}

function PaginationPrevious({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>) {
  return (
    <PaginationLink
      aria-label="Go to previous page"
      size="default"
      className={cn("font-sans", className)}
      {...props}
    >
      <ChevronLeft className="size-[13px]" />
      <span>Prev</span>
    </PaginationLink>
  )
}

function PaginationNext({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>) {
  return (
    <PaginationLink
      aria-label="Go to next page"
      size="default"
      className={cn("font-sans", className)}
      {...props}
    >
      <span>Next</span>
      <ChevronRight className="size-[13px]" />
    </PaginationLink>
  )
}

function PaginationEllipsis({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      data-slot="pagination-ellipsis"
      className={cn(
        "flex h-[26px] w-[26px] items-center justify-center text-[var(--faint)]",
        className
      )}
      {...props}
    >
      <MoreHorizontal className="size-[14px]" />
      <span className="sr-only">More pages</span>
    </span>
  )
}

export {
  Pagination,
  PaginationContent,
  PaginationLink,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
}
