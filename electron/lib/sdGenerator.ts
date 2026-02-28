/**
 * Stable Diffusion image generator
 *
 * Features:
 * - Execute SD binary via spawn
 * - Parse progress from stdout/stderr
 * - Support cancellation
 * - Log streaming
 */

import { spawn, ChildProcess } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";

export interface GenerationOptions {
  binaryPath: string;
  modelPath: string;
  llmPath?: string;
  vaePath?: string;
  clipOnCpu?: boolean;
  vaeTiling?: boolean;
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  steps: number;
  cfgScale: number;
  seed?: number;
  samplingMethod?: string;
  scheduler?: string;
  outputPath: string;
  onProgress?: (progress: GenerationProgress) => void;
  onLog?: (log: LogMessage) => void;
}

export interface GenerationProgress {
  phase: "generate";
  progress: number; // 0-100
  detail?: {
    current: number;
    total: number;
    unit: "steps";
  };
}

export interface LogMessage {
  type: "stdout" | "stderr";
  message: string;
}

export interface GenerationResult {
  success: boolean;
  outputPath?: string;
  error?: string;
}

export class SDGenerator {
  private activeProcess: ChildProcess | null = null;
  private isCancelling = false;

  /**
   * Generate an image using stable-diffusion.cpp binary
   */
  async generate(options: GenerationOptions): Promise<GenerationResult> {
    const {
      binaryPath,
      modelPath,
      llmPath,
      vaePath,
      prompt,
      negativePrompt,
      width,
      height,
      steps,
      cfgScale,
      seed,
      samplingMethod,
      scheduler,
      outputPath,
      clipOnCpu,
      vaeTiling,
      onProgress,
      onLog,
    } = options;

    // Validate binary exists
    if (!existsSync(binaryPath)) {
      return {
        success: false,
        error: `Binary not found at: ${binaryPath}`,
      };
    }

    // Sanitize prompt (escape dangerous characters)
    const sanitizePrompt = (text: string) =>
      text.replace(/["`$\\]/g, "\\$&").trim();
    const safePrompt = sanitizePrompt(prompt);
    const safeNegPrompt = negativePrompt ? sanitizePrompt(negativePrompt) : "";

    // Ensure output directory exists
    const outputDir = dirname(outputPath);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    // Build command arguments
    const args = [
      "--diffusion-model",
      modelPath,
      "-p",
      safePrompt,
      "-W",
      width.toString(),
      "-H",
      height.toString(),
      "--steps",
      steps.toString(),
      "--cfg-scale",
      cfgScale.toString(),
      "-o",
      outputPath,
      "-v", // Verbose
      "--offload-to-cpu", // Offload to CPU when needed
      "--diffusion-fa", // Use Flash Attention
    ];

    if (clipOnCpu) {
      args.push("--clip-on-cpu");
    }

    if (vaeTiling) {
      args.push("--vae-tiling");
    }

    // Add LLM (text encoder) if provided
    if (llmPath && existsSync(llmPath)) {
      args.push("--llm", llmPath);
    }

    // Add VAE if provided
    if (vaePath && existsSync(vaePath)) {
      args.push("--vae", vaePath);
    }

    if (safeNegPrompt) {
      args.push("-n", safeNegPrompt);
    }

    if (seed !== undefined) {
      args.push("--seed", seed.toString());
    }

    if (samplingMethod) {
      args.push("--sampling-method", samplingMethod);
    }

    if (scheduler) {
      args.push("--scheduler", scheduler);
    }

    console.log("[SDGenerator] Spawning SD process:", binaryPath);
    console.log("[SDGenerator] Arguments:", JSON.stringify(args));

    const binaryDir = dirname(binaryPath);
    const ldLibraryPath = process.env.LD_LIBRARY_PATH
      ? `${binaryDir}:${process.env.LD_LIBRARY_PATH}`
      : binaryDir;

    // Spawn child process
    const childProcess = spawn(binaryPath, args, {
      cwd: outputDir,
      env: { ...process.env, LD_LIBRARY_PATH: ldLibraryPath },
    });

    // Track active process for cancellation
    this.activeProcess = childProcess;

    let stderrData = "";
    let stdoutData = "";

    // Listen to stdout and send logs + parse progress
    childProcess.stdout.on("data", (data) => {
      const log = data.toString();
      stdoutData += log;

      // Send log to caller
      if (onLog) {
        onLog({
          type: "stdout",
          message: log,
        });
      }

      // Parse progress from stdout (some SD versions output here)
      const progressInfo = this.parseProgress(log);
      if (progressInfo && onProgress) {
        const scaledProgress = 10 + Math.min(progressInfo.progress, 100) * 0.9;
        onProgress({
          phase: "generate",
          progress: Math.min(scaledProgress, 99),
          detail: {
            current: progressInfo.current,
            total: progressInfo.total,
            unit: "steps",
          },
        });
      }
    });

    // Listen to stderr and send logs + parse progress
    childProcess.stderr.on("data", (data) => {
      const log = data.toString();
      stderrData += log;

      // Send log to caller
      if (onLog) {
        onLog({
          type: "stderr",
          message: log,
        });
      }

      // Parse progress from stderr
      const progressInfo = this.parseProgress(log);
      if (progressInfo && onProgress) {
        const scaledProgress = 10 + Math.min(progressInfo.progress, 100) * 0.9;
        onProgress({
          phase: "generate",
          progress: Math.min(scaledProgress, 99),
          detail: {
            current: progressInfo.current,
            total: progressInfo.total,
            unit: "steps",
          },
        });
      }
    });

    // Wait for process to end
    return new Promise((resolve) => {
      childProcess.on("close", (code, signal) => {
        this.activeProcess = null;
        const wasCancelled =
          this.isCancelling || signal === "SIGTERM" || signal === "SIGINT";
        this.isCancelling = false;

        if (wasCancelled) {
          resolve({
            success: false,
            error: "Cancelled",
          });
          return;
        }

        if (code === 0 && existsSync(outputPath)) {
          console.log("[SDGenerator] Generation successful");
          if (onProgress) {
            onProgress({
              phase: "generate",
              progress: 100,
            });
          }
          resolve({
            success: true,
            outputPath: outputPath,
          });
        } else {
          // Extract error information
          const errorLines = stderrData
            .split("\n")
            .filter((line) => line.trim());
          const errorMsg =
            errorLines.length > 0
              ? errorLines[errorLines.length - 1]
              : `Process exited with code ${code ?? "unknown"}`;

          console.error("[SDGenerator] Generation failed:", errorMsg);
          resolve({
            success: false,
            error: errorMsg,
          });
        }
      });

      childProcess.on("error", (err) => {
        this.activeProcess = null;
        console.error("[SDGenerator] Process error:", err.message);
        resolve({
          success: false,
          error: err.message,
        });
      });
    });
  }

  /**
   * Parse progress from SD stderr/stdout output
   *
   * Example patterns:
   * - "step: 12/20"
   * - "sampling: 18/20"
   * - "|==================================================| 12/12 - 7.28s/it"
   */
  private parseProgress(log: string): {
    current: number;
    total: number;
    progress: number;
  } | null {
    // Strip ANSI escape codes and scan the most recent lines for progress
    const cleaned = log.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
    const lines = cleaned
      .split(/[\r\n]+/)
      .filter(Boolean)
      .reverse();

    for (const line of lines) {
      // Match "step: X/Y" or "sampling: X/Y"
      let stepMatch = line.match(/(?:step|sampling):\s*(\d+)\/(\d+)/);

      if (!stepMatch) {
        // Match progress bar format: |===...===| 12/20 - time
        // Must have dash or space after the numbers to avoid matching resolution
        stepMatch = line.match(/\|[=\s>-]+\|\s*(\d+)\/(\d+)\s*[-\s]/);
      }

      if (!stepMatch) {
        // Match tqdm-style output: "  3/20 [00:00<00:01, 3.45it/s]"
        stepMatch = line.match(/\b(\d+)\s*\/\s*(\d+)\b.*(?:it\/s|s\/it|\])/);
      }

      if (stepMatch) {
        const current = parseInt(stepMatch[1], 10);
        const total = parseInt(stepMatch[2], 10);

        // Validate: reasonable step range and current > 0 and current <= total
        if (total >= 1 && total <= 512 && current > 0 && current <= total) {
          const progress = Math.round((current / total) * 100);
          return { current, total, progress };
        }
      }
    }

    return null;
  }

  /**
   * Cancel the active generation process
   */
  cancel(): boolean {
    if (this.activeProcess) {
      console.log("[SDGenerator] Cancelling generation");
      this.isCancelling = true;
      this.activeProcess.kill("SIGTERM");
      this.activeProcess = null;
      return true;
    }
    return false;
  }
}
