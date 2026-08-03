import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Parses a 5-field "M H * * *" cron pattern into a 24h hour/minute pair. Returns null for anything else (multi-value fields, non-daily patterns) since this app only ever writes plain daily times. */
export function parseDailyCron(pattern: string | null | undefined): { hour: number; minute: number } | null {
  if (!pattern) return null
  const parts = pattern.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const minute = Number(parts[0])
  const hour = Number(parts[1])
  if (!Number.isInteger(minute) || !Number.isInteger(hour)) return null
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null
  return { hour, minute }
}

export function formatHourMinute(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

/** "in 2h 14m" / "in 45m" / "due now" - shared by the schedule timeline/cards. */
export function formatCountdown(targetMs: number, fromMs: number): string {
  const diff = targetMs - fromMs
  if (diff <= 0) return "due now"
  const totalMinutes = Math.floor(diff / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    return `in ${days}d ${hours % 24}h`
  }
  if (hours === 0) return `in ${minutes}m`
  return `in ${hours}h ${minutes}m`
}

/**
 * Builds a compact page-number list with "ellipsis" markers for a
 * Pagination control, e.g. [1, "ellipsis", 4, 5, 6, "ellipsis", 12].
 */
export function getPaginationRange(
  current: number,
  total: number,
  siblings = 1
): (number | "ellipsis")[] {
  if (total <= 1) return total === 1 ? [1] : []

  const range: (number | "ellipsis")[] = []
  const left = Math.max(2, current - siblings)
  const right = Math.min(total - 1, current + siblings)

  range.push(1)
  if (left > 2) range.push("ellipsis")
  for (let i = left; i <= right; i++) range.push(i)
  if (right < total - 1) range.push("ellipsis")
  if (total > 1) range.push(total)

  return range
}
