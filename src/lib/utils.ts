/**
 * Generic utility functions (cross-module reusable).
 */

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Tailwind CSS class name merger
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Re-export formatting utilities from progress.ts to avoid duplication
export { formatBytes, formatTime } from "@/types/progress";

/**
 * Check if a string is a valid URL
 */
export function isValidUrl(urlString: string): boolean {
  try {
    new URL(urlString);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitize filename - remove invalid characters
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*]/g, "-") // Replace invalid Windows chars
    .replace(/\s+/g, "-") // Replace spaces with dashes
    .replace(/-+/g, "-") // Replace multiple dashes with single dash
    .replace(/^-+|-+$/g, ""); // Trim dashes from start/end
}

/**
 * Parse dimension string like "512x768" to {width, height}
 */
export function parseDimensions(dimensionStr: string): {
  width: number;
  height: number;
} | null {
  const match = dimensionStr.match(/^(\d+)x(\d+)$/);
  if (!match) return null;

  const width = parseInt(match[1], 10);
  const height = parseInt(match[2], 10);

  if (isNaN(width) || isNaN(height)) return null;
  if (width <= 0 || height <= 0) return null;

  return { width, height };
}
