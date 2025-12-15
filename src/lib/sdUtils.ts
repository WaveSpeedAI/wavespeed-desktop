// Stable Diffusion utility functions

import type { ValidationResult } from '@/types/stable-diffusion'

/**
 * Validate generation parameters
 */
export function validateGenerationParams(params: {
  prompt: string
  negativePrompt?: string
  width: number
  height: number
  steps: number
  cfgScale: number
  seed?: number
}): ValidationResult {
  // Validate prompt (only length and dangerous characters, not required since we have default)
  if (params.prompt && params.prompt.length > 1000) {
    return { valid: false, error: 'Prompt too long (max 1000 characters)' }
  }

  // Prevent command injection - check dangerous characters
  const dangerousChars = /[;&|`$()]/
  if (params.prompt && dangerousChars.test(params.prompt)) {
    return { valid: false, error: 'Prompt contains invalid characters' }
  }

  if (params.negativePrompt && dangerousChars.test(params.negativePrompt)) {
    return { valid: false, error: 'Negative prompt contains invalid characters' }
  }

  // Validate image dimensions
  if (params.width % 64 !== 0 || params.height % 64 !== 0) {
    return { valid: false, error: 'Width and height must be multiples of 64' }
  }

  if (params.width < 256 || params.width > 1024) {
    return { valid: false, error: 'Width must be between 256-1024' }
  }

  if (params.height < 256 || params.height > 1024) {
    return { valid: false, error: 'Height must be between 256-1024' }
  }

  // Validate sampling steps
  if (params.steps < 10 || params.steps > 50) {
    return { valid: false, error: 'Sampling steps must be between 10-50' }
  }

  if (!Number.isInteger(params.steps)) {
    return { valid: false, error: 'Sampling steps must be an integer' }
  }

  // Validate CFG Scale
  if (params.cfgScale < 1 || params.cfgScale > 20) {
    return { valid: false, error: 'CFG Scale must be between 1-20' }
  }

  // Validate seed (if provided)
  if (params.seed !== undefined) {
    if (!Number.isInteger(params.seed) || params.seed < 0) {
      return { valid: false, error: 'Seed must be a non-negative integer' }
    }

    if (params.seed > 2147483647) {
      return { valid: false, error: 'Seed value too large (max 2147483647)' }
    }
  }

  return { valid: true }
}

/**
 * Sanitize prompt - escape shell special characters
 */
export function sanitizePrompt(prompt: string): string {
  if (!prompt) return ''

  return (
    prompt
      // Escape backslash, double quote, backtick, dollar sign
      .replace(/["`$\\]/g, '\\$&')
      // Trim whitespace
      .trim()
  )
}

/**
 * Generate random seed
 */
export function generateRandomSeed(): number {
  return Math.floor(Math.random() * 2147483647)
}

/**
 * Format file size
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`
}

/**
 * Format time (seconds -> readable format)
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`
  }

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)

  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60

  return `${hours}h ${remainingMinutes}m`
}

/**
 * Parse stable-diffusion.cpp stderr output to extract progress
 *
 * Example output format:
 * "step: 12/20" or "sampling: 18/20"
 */
export function parseProgress(stderrLine: string): {
  current: number
  total: number
} | null {
  // Match "step: X/Y" or "sampling: X/Y"
  const match = stderrLine.match(/(?:step|sampling):\s*(\d+)\/(\d+)/)

  if (!match) {
    return null
  }

  const current = parseInt(match[1], 10)
  const total = parseInt(match[2], 10)

  if (isNaN(current) || isNaN(total) || total === 0) {
    return null
  }

  return { current, total }
}

/**
 * Calculate progress percentage
 */
export function calculateProgress(current: number, total: number): number {
  if (total === 0) return 0
  return Math.min(100, Math.max(0, Math.round((current / total) * 100)))
}

/**
 * Validate model path - ensure it's within allowed directory and is a .gguf file
 */
export function isValidModelPath(
  modelPath: string,
  allowedDir: string
): boolean {
  // Normalize paths
  const normalizedPath = modelPath.replace(/\\/g, '/')
  const normalizedAllowedDir = allowedDir.replace(/\\/g, '/')

  // Check if starts with allowed directory
  if (!normalizedPath.startsWith(normalizedAllowedDir)) {
    return false
  }

  // Check for path traversal patterns
  const pathTraversalPattern = /\.\.[/\\]/
  if (pathTraversalPattern.test(modelPath)) {
    return false
  }

  // Check if it's a .gguf file
  if (!modelPath.toLowerCase().endsWith('.gguf')) {
    return false
  }

  return true
}

/**
 * Generate output filename based on parameters
 */
export function generateOutputFilename(params: {
  modelName?: string
  prompt?: string
  seed?: number
  timestamp?: Date
}): string {
  const parts: string[] = []

  // Add model name (sanitized)
  if (params.modelName) {
    const sanitized = params.modelName
      .replace(/\.gguf$/i, '')
      .replace(/[^a-zA-Z0-9-]/g, '-')
      .toLowerCase()
    parts.push(sanitized)
  }

  // Add timestamp
  const timestamp = params.timestamp || new Date()
  const dateStr = timestamp.toISOString().split('T')[0] // YYYY-MM-DD
  const timeStr = timestamp.toTimeString().split(' ')[0].replace(/:/g, '-') // HH-MM-SS
  parts.push(`${dateStr}_${timeStr}`)

  // Add seed if provided
  if (params.seed !== undefined) {
    parts.push(`seed-${params.seed}`)
  }

  // Add random suffix to avoid collisions
  const randomSuffix = Math.random().toString(36).substring(2, 8)
  parts.push(randomSuffix)

  return `${parts.join('_')}.png`
}

/**
 * Estimate generation time based on parameters
 */
export function estimateGenerationTime(params: {
  width: number
  height: number
  steps: number
  hasGPU: boolean
}): number {
  const { width, height, steps, hasGPU } = params

  // Baseline: 512x512, 20 steps
  const basePixels = 512 * 512
  const baseSteps = 20
  const baseTime = hasGPU ? 20 : 120 // seconds (GPU: 20s, CPU: 120s)

  // Calculate relative complexity
  const pixels = width * height
  const pixelFactor = pixels / basePixels
  const stepFactor = steps / baseSteps

  // Estimate time (product of pixel count and steps)
  const estimatedTime = baseTime * pixelFactor * stepFactor

  return Math.round(estimatedTime)
}

/**
 * Extract error message from stderr
 */
export function extractErrorFromStderr(stderr: string): string {
  if (!stderr) return 'Unknown error'

  // Look for common error patterns
  const errorPatterns = [
    /error:\s*(.+)/i,
    /failed:\s*(.+)/i,
    /exception:\s*(.+)/i,
    /fatal:\s*(.+)/i
  ]

  for (const pattern of errorPatterns) {
    const match = stderr.match(pattern)
    if (match) {
      return match[1].trim()
    }
  }

  // If no specific pattern matched, return last non-empty line
  const lines = stderr.split('\n').filter((line) => line.trim())
  if (lines.length > 0) {
    return lines[lines.length - 1]
  }

  return stderr.slice(0, 200) // Return first 200 characters
}

/**
 * Check if a string is a valid URL
 */
export function isValidUrl(urlString: string): boolean {
  try {
    new URL(urlString)
    return true
  } catch {
    return false
  }
}

/**
 * Sanitize filename - remove invalid characters
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*]/g, '-') // Replace invalid Windows chars
    .replace(/\s+/g, '-') // Replace spaces with dashes
    .replace(/-+/g, '-') // Replace multiple dashes with single dash
    .replace(/^-+|-+$/g, '') // Trim dashes from start/end
}

/**
 * Parse dimension string like "512x768" to {width, height}
 */
export function parseDimensions(dimensionStr: string): {
  width: number
  height: number
} | null {
  const match = dimensionStr.match(/^(\d+)x(\d+)$/)
  if (!match) return null

  const width = parseInt(match[1], 10)
  const height = parseInt(match[2], 10)

  if (isNaN(width) || isNaN(height)) return null
  if (width <= 0 || height <= 0) return null

  return { width, height }
}
