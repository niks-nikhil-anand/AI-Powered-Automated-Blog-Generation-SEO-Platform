import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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
