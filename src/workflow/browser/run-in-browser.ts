/**
 * Run workflow in the browser (no Electron).
 * Uses workflowClient for AI tasks and free-tool-runner for free-tool nodes.
 */
import { workflowClient } from "@/api/client";
import { topologicalLevels, type SimpleEdge } from "@/workflow/lib/topological";
import {
  runImageEnhancer,
  runBackgroundRemover,
  runFaceEnhancer,
  runVideoEnhancer,
  runFaceSwapper,
  runImageEraser,
  runSegmentAnything,
} from "@/workflow/lib/free-tool-runner";
import { normalizePayloadArrays } from "@/lib/schemaToForm";
import { BROWSER_NODE_DEFINITIONS } from "./node-definitions";
import { ffmpegMerge, ffmpegTrim, ffmpegConvert } from "./ffmpeg-helpers";
import type { ModelParamSchema } from "@/workflow/types/node-defs";
import { useModelsStore } from "@/stores/modelsStore";

const SKIP_KEYS = new Set([
  "modelId",
  "__meta",
  "__locks",
  "__nodeWidth",
  "__nodeHeight",
]);

const nodeDefMap = new Map(BROWSER_NODE_DEFINITIONS.map((d) => [d.type, d]));

export interface BrowserNode {
  id: string;
  parentNode?: string;
  data: { nodeType: string; params?: Record<string, unknown> };
}

export interface BrowserEdge {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface RunInBrowserCallbacks {
  onNodeStatus: (
    nodeId: string,
    status: "running" | "confirmed" | "error",
    errorMessage?: string,
  ) => void;
  onProgress: (nodeId: string, progress: number, message?: string) => void;
  onNodeComplete: (
    nodeId: string,
    result: { urls: string[]; cost: number; durationMs?: number },
  ) => void;
}

interface NodeResult {
  outputUrl: string;
  resultMetadata: Record<string, unknown>;
}

function buildApiParams(
  params: Record<string, unknown>,
  inputs: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const meta = params.__meta as Record<string, unknown> | undefined;
  const schema = (meta?.modelInputSchema ?? []) as Array<{
    name: string;
    default?: unknown;
    enum?: string[];
  }>;
  for (const s of schema) {
    if (SKIP_KEYS.has(s.name) || s.name.startsWith("__")) continue;
    if (s.default !== undefined && s.default !== null && s.default !== "")
      out[s.name] = s.default;
    else if (s.enum?.length) out[s.name] = s.enum[0];
  }
  for (const [key, value] of Object.entries(params)) {
    if (SKIP_KEYS.has(key) || key.startsWith("__")) continue;
    if (value !== undefined && value !== null && value !== "") out[key] = value;
  }
  for (const [key, value] of Object.entries(inputs)) {
    if (key.startsWith("__arrayInput_")) {
      const paramName = key.slice("__arrayInput_".length);
      const indexMap = value as Record<number, string>;
      const existing = Array.isArray(out[paramName])
        ? [...(out[paramName] as unknown[])]
        : [];
      for (const [idx, val] of Object.entries(indexMap))
        existing[Number(idx)] = val;
      out[paramName] = existing.filter(
        (v) => v !== undefined && v !== null && v !== "",
      );
    } else if (value !== undefined && value !== null && value !== "") {
      out[key] = Array.isArray(value) ? value : String(value);
    }
  }
  if (typeof out.seed === "number" && (out.seed as number) < 0) delete out.seed;

  // Coerce integer schema fields to whole numbers before sending to API
  for (const s of schema) {
    if (
      (s as Record<string, unknown>).type === "integer" &&
      out[s.name] !== undefined &&
      out[s.name] !== null
    ) {
      const n = Number(out[s.name]);
      if (!Number.isNaN(n)) out[s.name] = Math.round(n);
    }
  }

  return normalizePayloadArrays(out, []);
}

function resolveInputs(
  nodeId: string,
  _nodeMap: Map<string, BrowserNode>,
  edges: {
    source: string;
    target: string;
    sourceHandle: string;
    targetHandle: string;
  }[],
  results: Map<string, NodeResult>,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  const incoming = edges.filter((e) => e.target === nodeId);
  for (const e of incoming) {
    const res = results.get(e.source);
    if (!res) continue;
    let outputValue: unknown =
      res.resultMetadata[e.sourceHandle] ??
      res.resultMetadata.output ??
      res.resultMetadata.resultUrl ??
      res.outputUrl;
    if (outputValue === undefined) outputValue = res.outputUrl;

    const targetKey = e.targetHandle;
    const arrayMatch = /^(.+)\[(\d+)\]$/.exec(targetKey);
    if (arrayMatch) {
      const paramName = arrayMatch[1];
      const index = parseInt(arrayMatch[2], 10);
      const mapKey = `__arrayInput_${paramName}`;
      if (!inputs[mapKey])
        (inputs as Record<string, unknown>)[mapKey] = {} as Record<
          number,
          string
        >;
      ((inputs as Record<string, unknown>)[mapKey] as Record<number, string>)[
        index
      ] = String(outputValue);
    } else if (targetKey.startsWith("param-")) {
      inputs[targetKey.slice(6)] = Array.isArray(outputValue)
        ? outputValue
        : String(outputValue);
    } else if (targetKey.startsWith("input-")) {
      inputs[targetKey.slice(6)] = Array.isArray(outputValue)
        ? outputValue
        : String(outputValue);
    } else {
      inputs[targetKey] = outputValue;
    }
  }
  return inputs;
}

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

/**
 * Validate that all required fields are present before running a node.
 * Returns a list of missing field labels (empty = valid).
 */
function validateNodeInputs(
  nodeType: string,
  params: Record<string, unknown>,
  inputs: Record<string, unknown>,
): string[] {
  const missing: string[] = [];

  if (nodeType === "ai-task/run") {
    const meta = params.__meta as Record<string, unknown> | undefined;
    const schema = (meta?.modelInputSchema ?? []) as ModelParamSchema[];
    for (const field of schema) {
      if (!field.required) continue;
      const val = inputs[field.name] ?? params[field.name];
      if (isEmpty(val) && isEmpty(field.default)) {
        missing.push(field.label || field.name);
      }
    }
    return missing;
  }

  const def = nodeDefMap.get(nodeType);
  if (def) {
    for (const inp of def.inputs) {
      if (!inp.required) continue;
      const val =
        inputs[inp.key] ?? inputs[`input-${inp.key}`] ?? params[inp.key];
      if (isEmpty(val)) {
        missing.push(inp.label || inp.key);
      }
    }
  }
  return missing;
}

function base64ToDataUrl(base64: string, mime = "image/png"): string {
  if (base64.startsWith("data:")) return base64;
  return `data:${mime};base64,${base64}`;
}

/** Collect nodeId and all nodes that feed into it (upstream subgraph). */
function upstreamNodeIds(
  nodeId: string,
  simpleEdges: SimpleEdge[],
): Set<string> {
  const out = new Set<string>([nodeId]);
  const reverse = new Map<string, string[]>();
  for (const e of simpleEdges) {
    const list = reverse.get(e.targetNodeId) ?? [];
    list.push(e.sourceNodeId);
    reverse.set(e.targetNodeId, list);
  }
  let queue = [nodeId];
  while (queue.length > 0) {
    const next: string[] = [];
    for (const id of queue) {
      for (const src of reverse.get(id) ?? []) {
        if (!out.has(src)) {
          out.add(src);
          next.push(src);
        }
      }
    }
    queue = next;
  }
  return out;
}

/** Collect a node and all its downstream (forward) dependents. */
function downstreamNodeIds(
  nodeId: string,
  simpleEdges: SimpleEdge[],
): Set<string> {
  const out = new Set<string>([nodeId]);
  const forward = new Map<string, string[]>();
  for (const e of simpleEdges) {
    const list = forward.get(e.sourceNodeId) ?? [];
    list.push(e.targetNodeId);
    forward.set(e.sourceNodeId, list);
  }
  let queue = [nodeId];
  while (queue.length > 0) {
    const next: string[] = [];
    for (const id of queue) {
      for (const tgt of forward.get(id) ?? []) {
        if (!out.has(tgt)) {
          out.add(tgt);
          next.push(tgt);
        }
      }
    }
    queue = next;
  }
  return out;
}

/** Cache blob→CDN URL mappings so the same blob is only uploaded once across runs */
const blobToCdnCache = new Map<string, string>();

/** Returns true if the URL is a local/blob reference that needs CDN upload before API use */
function needsCdnUpload(url: string): boolean {
  return url.startsWith("blob:") || /^local-asset:\/\//i.test(url);
}

/**
 * Upload a single local-asset:// or blob: URL to CDN, returning the CDN URL.
 * Results are cached so the same source is only uploaded once.
 */
async function ensureCdnUrl(
  url: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!needsCdnUpload(url)) return url;
  const cached = blobToCdnCache.get(url);
  if (cached) return cached;
  const resp = await fetch(url);
  const blob = await resp.blob();
  // Try to extract a filename from the URL
  const decoded = /^local-asset:\/\//i.test(url)
    ? decodeURIComponent(url.replace(/^local-asset:\/\//i, ""))
    : url;
  const name = decoded.split(/[/\\]/).pop() || "upload";
  const file = new File([blob], name, { type: blob.type });
  const cdnUrl = await workflowClient.uploadFile(file, signal);
  blobToCdnCache.set(url, cdnUrl);
  return cdnUrl;
}

/**
 * Walk all values in API params and upload any local-asset:// or blob: URLs to CDN.
 * This ensures the API always receives valid HTTP URLs.
 */
async function uploadLocalUrls(
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const out = { ...params };
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === "string" && needsCdnUpload(value)) {
      out[key] = await ensureCdnUrl(value, signal);
    } else if (Array.isArray(value)) {
      const arr = await Promise.all(
        value.map((v) =>
          typeof v === "string" && needsCdnUpload(v)
            ? ensureCdnUrl(v, signal)
            : v,
        ),
      );
      out[key] = arr;
    }
  }
  return out;
}

export async function executeWorkflowInBrowser(
  nodes: BrowserNode[],
  edges: BrowserEdge[],
  callbacks: RunInBrowserCallbacks,
  options?: {
    runOnlyNodeId?: string;
    continueFromNodeId?: string;
    existingResults?: Map<string, string[]>;
    signal?: AbortSignal;
  },
): Promise<void> {
  const signal = options?.signal;
  const throwIfAborted = (): void => {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  };

  // ── Batch trigger detection: if a trigger/directory node exists, run the
  //    entire downstream workflow once per file (matching Electron backend behavior) ──
  if (!options?.runOnlyNodeId && !options?.continueFromNodeId) {
    const batchTriggerNode = nodes.find(
      (n) =>
        n.data.nodeType === "trigger/directory" &&
        !n.data.params?.__triggerValue,
    );
    if (batchTriggerNode) {
      const params = batchTriggerNode.data.params ?? {};
      const dirPath = String(params.directoryPath ?? "").trim();
      if (!dirPath) {
        callbacks.onNodeStatus(
          batchTriggerNode.id,
          "error",
          "No directory selected.",
        );
        return;
      }
      const mediaType = String(params.mediaType ?? "image");
      const BATCH_MEDIA_EXTS: Record<string, string[]> = {
        image: [
          ".jpg",
          ".jpeg",
          ".png",
          ".webp",
          ".gif",
          ".bmp",
          ".tiff",
          ".tif",
          ".svg",
          ".avif",
        ],
        video: [
          ".mp4",
          ".webm",
          ".mov",
          ".avi",
          ".mkv",
          ".flv",
          ".wmv",
          ".m4v",
        ],
        audio: [".mp3", ".wav", ".flac", ".m4a", ".ogg", ".aac", ".wma"],
        all: [],
      };
      BATCH_MEDIA_EXTS.all = [
        ...BATCH_MEDIA_EXTS.image,
        ...BATCH_MEDIA_EXTS.video,
        ...BATCH_MEDIA_EXTS.audio,
      ];

      let urls: string[] = [];
      try {
        const api = (window as unknown as Record<string, unknown>)
          .electronAPI as
          | {
              scanDirectory?: (
                path: string,
                exts: string[],
              ) => Promise<string[]>;
            }
          | undefined;
        if (api?.scanDirectory) {
          const files = await api.scanDirectory(
            dirPath,
            BATCH_MEDIA_EXTS[mediaType] ?? BATCH_MEDIA_EXTS.all,
          );
          urls = files
            .sort()
            .map((f) => `local-asset://${encodeURIComponent(f)}`);
        } else {
          callbacks.onNodeStatus(
            batchTriggerNode.id,
            "error",
            "Directory scanning requires the desktop app.",
          );
          return;
        }
      } catch (err) {
        callbacks.onNodeStatus(
          batchTriggerNode.id,
          "error",
          `Failed to scan directory: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }

      if (urls.length === 0) {
        callbacks.onNodeStatus(
          batchTriggerNode.id,
          "error",
          "No matching files found in directory.",
        );
        return;
      }

      // Run the workflow once per file, injecting __triggerValue into the trigger node
      for (let i = 0; i < urls.length; i++) {
        throwIfAborted();
        const fileUrl = urls[i];
        const fileName =
          decodeURIComponent(fileUrl.replace(/^local-asset:\/\//i, ""))
            .split(/[/\\]/)
            .pop() || `file ${i + 1}`;
        callbacks.onProgress(
          batchTriggerNode.id,
          ((i + 1) / urls.length) * 100,
          `Processing ${fileName} (${i + 1}/${urls.length})`,
        );

        // Temporarily inject __triggerValue so the trigger handler outputs this specific file
        const originalParams = { ...batchTriggerNode.data.params };
        batchTriggerNode.data.params = {
          ...originalParams,
          __triggerValue: fileUrl,
        };

        try {
          await executeWorkflowInBrowser(nodes, edges, callbacks, {
            ...options,
            // Use a sentinel to prevent infinite recursion — the recursive call
            // will see __triggerValue and the trigger handler will use it directly
            runOnlyNodeId: undefined,
            continueFromNodeId: undefined,
          });
        } finally {
          batchTriggerNode.data.params = originalParams;
        }
      }
      return;
    }
  }

  const simpleEdges: SimpleEdge[] = edges.map((e) => ({
    sourceNodeId: e.source,
    targetNodeId: e.target,
  }));
  const allNodeIds = nodes.map((n) => n.id);
  let nodeIds: string[];
  let filteredNodes: BrowserNode[];
  let filteredEdges: BrowserEdge[];
  /** Nodes whose results should be reused (not re-executed) in continueFrom mode */
  let skipNodeIds: Set<string> | null = null;
  if (
    options?.continueFromNodeId &&
    allNodeIds.includes(options.continueFromNodeId)
  ) {
    // If the target node is a child of a group, redirect to the parent group
    let effectiveContinueId = options.continueFromNodeId;
    const continueTarget = nodes.find((n) => n.id === effectiveContinueId);
    if (continueTarget?.parentNode) {
      effectiveContinueId = continueTarget.parentNode;
    }

    // Run the target node + all downstream; include upstream in the graph but skip executing them
    const downstream = downstreamNodeIds(
      effectiveContinueId,
      simpleEdges,
    );
    const upstream = upstreamNodeIds(effectiveContinueId, simpleEdges);
    // The subgraph is upstream ∪ downstream so edges resolve correctly
    const subset = new Set([...upstream, ...downstream]);
    nodeIds = allNodeIds.filter((id) => subset.has(id));
    filteredNodes = nodes.filter((n) => subset.has(n.id));
    filteredEdges = edges.filter(
      (e) => subset.has(e.source) && subset.has(e.target),
    );
    // Skip upstream nodes (except the target node itself) — they keep their previous results
    skipNodeIds = new Set([...upstream].filter((id) => !downstream.has(id)));
  } else if (
    options?.runOnlyNodeId &&
    allNodeIds.includes(options.runOnlyNodeId)
  ) {
    // If the target node is a child of a group, redirect execution to the
    // parent group node so the group handler runs all child nodes properly.
    let effectiveRunNodeId = options.runOnlyNodeId;
    const targetNode = nodes.find((n) => n.id === effectiveRunNodeId);
    if (targetNode?.parentNode) {
      effectiveRunNodeId = targetNode.parentNode;
    }

    const subset = upstreamNodeIds(effectiveRunNodeId, simpleEdges);
    nodeIds = allNodeIds.filter((id) => subset.has(id));
    filteredNodes = nodes.filter((n) => subset.has(n.id));
    filteredEdges = edges.filter(
      (e) => subset.has(e.source) && subset.has(e.target),
    );
    // Only execute the target node itself; upstream nodes reuse existing results
    skipNodeIds = new Set(
      [...subset].filter((id) => id !== effectiveRunNodeId),
    );
  } else {
    nodeIds = allNodeIds;
    filteredNodes = nodes;
    filteredEdges = edges;
  }

  // Ensure child nodes of any iterator in the graph are always included
  const iteratorIds = new Set(
    filteredNodes
      .filter((n) => n.data.nodeType === "control/iterator")
      .map((n) => n.id),
  );
  if (iteratorIds.size > 0) {
    const filteredIdSet = new Set(filteredNodes.map((n) => n.id));
    for (const n of nodes) {
      if (
        n.parentNode &&
        iteratorIds.has(n.parentNode) &&
        !filteredIdSet.has(n.id)
      ) {
        filteredNodes.push(n);
        nodeIds.push(n.id);
        filteredIdSet.add(n.id);
      }
    }
    // Include internal edges between child nodes
    const allFilteredIds = new Set(filteredNodes.map((n) => n.id));
    for (const e of edges) {
      if (allFilteredIds.has(e.source) && allFilteredIds.has(e.target)) {
        if (
          !filteredEdges.some(
            (fe) =>
              fe.source === e.source &&
              fe.target === e.target &&
              fe.sourceHandle === e.sourceHandle &&
              fe.targetHandle === e.targetHandle,
          )
        ) {
          filteredEdges.push(e);
        }
      }
    }
  }

  const nodeMap = new Map(filteredNodes.map((n) => [n.id, n]));

  // Filter out child nodes (nodes with parentNode) from top-level execution.
  // They are only executed inside their parent iterator's handler.
  const childNodeIds = new Set(
    filteredNodes.filter((n) => n.parentNode).map((n) => n.id),
  );
  const topLevelNodeIds = nodeIds.filter((id) => !childNodeIds.has(id));

  const edgesWithHandles = filteredEdges.map((e) => ({
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? "output",
    targetHandle: e.targetHandle ?? "input",
  }));

  // Top-level simple edges: exclude edges involving child nodes (internal to iterators)
  // Critical: edges FROM child nodes to iterator (exposed output auto-edges) would
  // incorrectly increment the iterator's in-degree in topological sort, preventing it
  // from ever executing. We must exclude any edge where source OR target is a child node.
  const simpleEdgesSubgraph: SimpleEdge[] = edgesWithHandles
    .filter((e) => !childNodeIds.has(e.source) && !childNodeIds.has(e.target))
    .map((e) => ({
      sourceNodeId: e.source,
      targetNodeId: e.target,
    }));
  const results = new Map<string, NodeResult>();
  const failedNodes = new Set<string>();
  const levels = topologicalLevels(topLevelNodeIds, simpleEdgesSubgraph);
  const upstreamMap = new Map<string, string[]>();
  for (const e of simpleEdgesSubgraph) {
    const deps = upstreamMap.get(e.targetNodeId) ?? [];
    deps.push(e.sourceNodeId);
    upstreamMap.set(e.targetNodeId, deps);
  }

  for (const level of levels) {
    throwIfAborted();
    // Stop the entire workflow if any node has failed
    if (failedNodes.size > 0) break;
    // Yield to the event loop between levels so React can flush UI updates
    await new Promise<void>((r) => setTimeout(r, 0));
    await Promise.all(
      level.map(async (nodeId) => {
        throwIfAborted();
        // If another node in this batch failed, skip remaining
        if (failedNodes.size > 0) return;
        const upstreams = upstreamMap.get(nodeId) ?? [];
        if (upstreams.some((uid) => failedNodes.has(uid))) {
          failedNodes.add(nodeId);
          callbacks.onNodeStatus(
            nodeId,
            "error",
            "Skipped: upstream node failed",
          );
          return;
        }

        const node = nodeMap.get(nodeId);
        if (!node) return;
        const nodeType = node.data.nodeType;
        const params = node.data.params ?? {};

        // continueFrom: skip upstream nodes — use existing results so downstream can resolve inputs
        if (skipNodeIds?.has(nodeId)) {
          const existingUrls = options?.existingResults?.get(nodeId);
          if (existingUrls && existingUrls.length > 0) {
            // Preserve full array for multi-output nodes (e.g. concat)
            const outputValue =
              existingUrls.length === 1 ? existingUrls[0] : existingUrls;
            results.set(nodeId, {
              outputUrl: existingUrls[0],
              resultMetadata: {
                output: outputValue,
                resultUrl: existingUrls[0],
                resultUrls: existingUrls,
              },
            });
          } else {
            const existingOutput = String(
              params.uploadedUrl ??
                params.text ??
                params.prompt ??
                params.output ??
                "",
            );
            if (existingOutput) {
              results.set(nodeId, {
                outputUrl: existingOutput,
                resultMetadata: {
                  output: existingOutput,
                  resultUrl: existingOutput,
                },
              });
            }
          }
          return;
        }

        const inputs = resolveInputs(
          nodeId,
          nodeMap,
          edgesWithHandles,
          results,
        );

        // Validate required fields before running
        const missingFields = validateNodeInputs(nodeType, params, inputs);
        if (missingFields.length > 0) {
          failedNodes.add(nodeId);
          callbacks.onNodeStatus(
            nodeId,
            "error",
            `Missing required fields: ${missingFields.join(", ")}`,
          );
          return;
        }

        callbacks.onNodeStatus(nodeId, "running");
        const start = Date.now();
        const onProgress = (p: number, msg?: string) =>
          callbacks.onProgress(nodeId, p, msg);

        try {
          if (nodeType === "ai-task/run") {
            const modelId = String(params.modelId ?? "");
            if (!modelId) {
              throw new Error("No model selected.");
            }
            const apiParams = buildApiParams(params, inputs);
            // Ensure all URLs are valid HTTP URLs (upload local-asset:// / blob: to CDN)
            const resolvedParams = await uploadLocalUrls(apiParams, signal);
            callbacks.onProgress(nodeId, 5, `Running ${modelId}...`);
            const result = await workflowClient.run(modelId, resolvedParams, {
              signal,
            });
            const outputUrl =
              Array.isArray(result.outputs) && result.outputs.length > 0
                ? String(result.outputs[0])
                : "";
            const durationMs = Date.now() - start;
            const model = useModelsStore.getState().getModelById(modelId);
            const cost = model?.base_price ?? 0;
            results.set(nodeId, {
              outputUrl,
              resultMetadata: {
                output: outputUrl,
                resultUrl: outputUrl,
                resultUrls: Array.isArray(result.outputs)
                  ? result.outputs.map(String)
                  : [outputUrl],
                modelId,
                raw: result,
              },
            });
            callbacks.onNodeStatus(nodeId, "confirmed");
            callbacks.onNodeComplete(nodeId, {
              urls: Array.isArray(result.outputs)
                ? result.outputs.map(String)
                : [outputUrl],
              cost,
              durationMs,
            });
            return;
          }

          if (nodeType === "input/media-upload") {
            let url = String(inputs.media ?? params.uploadedUrl ?? "");
            if (!url) throw new Error("No file uploaded or connected.");

            // Upload blob: or local-asset:// URLs to CDN before passing downstream
            if (needsCdnUpload(url)) {
              callbacks.onProgress(nodeId, 10, "Uploading file to CDN...");
              url = await ensureCdnUrl(url, signal);
            }

            results.set(nodeId, {
              outputUrl: url,
              resultMetadata: { output: url, resultUrl: url },
            });
            callbacks.onNodeStatus(nodeId, "confirmed");
            callbacks.onNodeComplete(nodeId, {
              urls: [url],
              cost: 0,
              durationMs: Date.now() - start,
            });
            return;
          }

          if (nodeType === "input/text-input") {
            const text = String(params.text ?? params.prompt ?? "");
            results.set(nodeId, {
              outputUrl: text,
              resultMetadata: { output: text, text },
            });
            callbacks.onNodeStatus(nodeId, "confirmed");
            callbacks.onNodeComplete(nodeId, {
              urls: [text],
              cost: 0,
              durationMs: Date.now() - start,
            });
            return;
          }

          if (nodeType === "trigger/directory") {
            // In batch mode, __triggerValue is injected by the outer batch loop
            const triggerValue = params.__triggerValue as string | undefined;
            if (triggerValue) {
              results.set(nodeId, {
                outputUrl: triggerValue,
                resultMetadata: {
                  output: triggerValue,
                  resultUrl: triggerValue,
                  resultUrls: [triggerValue],
                },
              });
              callbacks.onNodeStatus(nodeId, "confirmed");
              callbacks.onNodeComplete(nodeId, {
                urls: [triggerValue],
                cost: 0,
                durationMs: Date.now() - start,
              });
              return;
            }

            // Non-batch fallback (e.g. runOnlyNodeId targeting this trigger)
            const dirPath = String(params.directoryPath ?? "").trim();
            if (!dirPath)
              throw new Error(
                "No directory selected. Please choose a directory.",
              );

            const mediaType = String(params.mediaType ?? "image");

            const TRIGGER_MEDIA_EXTS: Record<string, string[]> = {
              image: [
                ".jpg",
                ".jpeg",
                ".png",
                ".webp",
                ".gif",
                ".bmp",
                ".tiff",
                ".tif",
                ".svg",
                ".avif",
              ],
              video: [
                ".mp4",
                ".webm",
                ".mov",
                ".avi",
                ".mkv",
                ".flv",
                ".wmv",
                ".m4v",
              ],
              audio: [".mp3", ".wav", ".flac", ".m4a", ".ogg", ".aac", ".wma"],
              all: [],
            };
            TRIGGER_MEDIA_EXTS.all = [
              ...TRIGGER_MEDIA_EXTS.image,
              ...TRIGGER_MEDIA_EXTS.video,
              ...TRIGGER_MEDIA_EXTS.audio,
            ];

            let urls: string[] = [];
            try {
              const api = (window as unknown as Record<string, unknown>)
                .electronAPI as
                | {
                    scanDirectory?: (
                      path: string,
                      exts: string[],
                    ) => Promise<string[]>;
                  }
                | undefined;
              if (api?.scanDirectory) {
                const files = await api.scanDirectory(
                  dirPath,
                  TRIGGER_MEDIA_EXTS[mediaType] ?? TRIGGER_MEDIA_EXTS.all,
                );
                urls = files
                  .sort()
                  .map((f) => `local-asset://${encodeURIComponent(f)}`);
              } else {
                throw new Error("Directory scanning requires the desktop app.");
              }
            } catch (err) {
              throw new Error(
                `Failed to scan directory: ${err instanceof Error ? err.message : String(err)}`,
              );
            }

            if (urls.length === 0)
              throw new Error("No matching files found in directory.");

            // Single-node run: output first file only
            results.set(nodeId, {
              outputUrl: urls[0],
              resultMetadata: {
                output: urls[0],
                resultUrl: urls[0],
                resultUrls: urls,
                fileCount: urls.length,
              },
            });
            callbacks.onNodeStatus(nodeId, "confirmed");
            callbacks.onNodeComplete(nodeId, {
              urls: [urls[0]],
              cost: 0,
              durationMs: Date.now() - start,
            });
            return;
          }

          if (nodeType === "trigger/http") {
            // HTTP trigger in browser mode: pass through the injected trigger value
            const triggerValue = params.__triggerValue as
              | Record<string, unknown>
              | undefined;
            const outputMeta: Record<string, unknown> = {};
            if (triggerValue) {
              for (const [k, v] of Object.entries(triggerValue)) {
                outputMeta[k] = typeof v === "string" ? v : JSON.stringify(v);
              }
            }
            results.set(nodeId, {
              outputUrl: "",
              resultMetadata: outputMeta,
            });
            callbacks.onNodeStatus(nodeId, "confirmed");
            callbacks.onNodeComplete(nodeId, {
              urls: [""],
              cost: 0,
              durationMs: Date.now() - start,
            });
            return;
          }

          if (nodeType === "output/preview") {
            const url = String(inputs.input ?? "");
            if (!url) throw new Error("No URL provided for preview.");
            results.set(nodeId, {
              outputUrl: url,
              resultMetadata: { previewUrl: url },
            });
            callbacks.onNodeStatus(nodeId, "confirmed");
            callbacks.onNodeComplete(nodeId, {
              urls: [url],
              cost: 0,
              durationMs: Date.now() - start,
            });
            return;
          }

          if (nodeType === "output/file") {
            const rawUrl = inputs.url ?? inputs.input ?? "";
            // Handle array inputs (e.g. from iterator output) — save all files
            const urlList: string[] = Array.isArray(rawUrl)
              ? rawUrl.map(String).filter(Boolean)
              : [String(rawUrl)].filter(Boolean);
            if (urlList.length === 0)
              throw new Error("No URL provided for export.");

            const filenamePrefix =
              String(params.filename ?? "output").replace(
                /[<>:"/\\|?*]/g,
                "_",
              ) || "output";
            const format = String(params.format ?? "auto");
            const isElectron =
              typeof window !== "undefined" &&
              !!window.electronAPI?.saveFileSilent;
            const savedFiles: string[] = [];

            for (let fi = 0; fi < urlList.length; fi++) {
              const url = urlList[fi];
              const ext =
                format === "auto"
                  ? guessExtFromUrl(url)
                  : format.replace(/^\./, "").toLowerCase();
              const suffix = urlList.length > 1 ? `_${fi + 1}` : "";
              const fileName = `${filenamePrefix}${suffix}_${Date.now()}.${ext || "png"}`;

              if (isElectron) {
                const outputDir = String(params.outputDir || "");
                const result = await window.electronAPI!.saveFileSilent(
                  url,
                  outputDir,
                  fileName,
                );
                if (!result.success)
                  throw new Error(
                    result.error || `Save failed for file ${fi + 1}`,
                  );
              } else {
                try {
                  const resp = await fetch(url);
                  if (!resp.ok)
                    throw new Error(`Download failed: HTTP ${resp.status}`);
                  const blob = await resp.blob();
                  const blobUrl = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = blobUrl;
                  a.download = fileName;
                  a.style.display = "none";
                  document.body.appendChild(a);
                  a.click();
                  setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(blobUrl);
                  }, 100);
                } catch {
                  window.open(url, "_blank");
                }
              }
              savedFiles.push(url);
              onProgress(
                ((fi + 1) / urlList.length) * 100,
                `Saved ${fi + 1}/${urlList.length}`,
              );
            }

            results.set(nodeId, {
              outputUrl: savedFiles[0] ?? "",
              resultMetadata: {
                output: savedFiles,
                exportedFileCount: savedFiles.length,
              },
            });
            callbacks.onNodeStatus(nodeId, "confirmed");
            callbacks.onNodeComplete(nodeId, {
              urls: savedFiles.length > 0 ? savedFiles : [""],
              cost: 0,
              durationMs: Date.now() - start,
            });
            return;
          }

          // Free-tool nodes
          if (nodeType === "free-tool/image-enhancer") {
            const inputUrl = String(inputs.input ?? params.input ?? "");
            if (!inputUrl) throw new Error("Missing input");
            const base64 = await runImageEnhancer(
              inputUrl,
              params as { model?: string; scale?: string },
              onProgress,
            );
            const dataUrl = base64ToDataUrl(base64);
            results.set(nodeId, {
              outputUrl: dataUrl,
              resultMetadata: { output: dataUrl, resultUrl: dataUrl },
            });
            callbacks.onNodeStatus(nodeId, "confirmed");
            callbacks.onNodeComplete(nodeId, {
              urls: [dataUrl],
              cost: 0,
              durationMs: Date.now() - start,
            });
            return;
          }
          if (nodeType === "free-tool/background-remover") {
            const inputUrl = String(inputs.input ?? params.input ?? "");
            if (!inputUrl) throw new Error("Missing input");
            const base64 = await runBackgroundRemover(
              inputUrl,
              params as { model?: string },
              onProgress,
            );
            const dataUrl = base64ToDataUrl(base64);
            results.set(nodeId, {
              outputUrl: dataUrl,
              resultMetadata: { output: dataUrl, resultUrl: dataUrl },
            });
            callbacks.onNodeStatus(nodeId, "confirmed");
            callbacks.onNodeComplete(nodeId, {
              urls: [dataUrl],
              cost: 0,
              durationMs: Date.now() - start,
            });
            return;
          }
          if (nodeType === "free-tool/face-enhancer") {
            const inputUrl = String(inputs.input ?? params.input ?? "");
            if (!inputUrl) throw new Error("Missing input");
            const base64 = await runFaceEnhancer(inputUrl, params, onProgress);
            const dataUrl = base64ToDataUrl(base64);
            results.set(nodeId, {
              outputUrl: dataUrl,
              resultMetadata: { output: dataUrl, resultUrl: dataUrl },
            });
            callbacks.onNodeStatus(nodeId, "confirmed");
            callbacks.onNodeComplete(nodeId, {
              urls: [dataUrl],
              cost: 0,
              durationMs: Date.now() - start,
            });
            return;
          }
          if (nodeType === "free-tool/video-enhancer") {
            const inputUrl = String(inputs.input ?? params.input ?? "");
            if (!inputUrl) throw new Error("Missing input");
            const base64 = await runVideoEnhancer(
              inputUrl,
              params as { model?: string; scale?: string },
              onProgress,
            );
            const dataUrl = base64ToDataUrl(base64, "video/webm");
            results.set(nodeId, {
              outputUrl: dataUrl,
              resultMetadata: { output: dataUrl, resultUrl: dataUrl },
            });
            callbacks.onNodeStatus(nodeId, "confirmed");
            callbacks.onNodeComplete(nodeId, {
              urls: [dataUrl],
              cost: 0,
              durationMs: Date.now() - start,
            });
            return;
          }
          if (nodeType === "free-tool/face-swapper") {
            const sourceUrl = String(inputs.source ?? params.source ?? "");
            const targetUrl = String(inputs.target ?? params.target ?? "");
            if (!sourceUrl || !targetUrl)
              throw new Error("Missing source or target image");
            const base64 = await runFaceSwapper(
              sourceUrl,
              targetUrl,
              params,
              onProgress,
            );
            const dataUrl = base64ToDataUrl(base64);
            results.set(nodeId, {
              outputUrl: dataUrl,
              resultMetadata: { output: dataUrl, resultUrl: dataUrl },
            });
            callbacks.onNodeStatus(nodeId, "confirmed");
            callbacks.onNodeComplete(nodeId, {
              urls: [dataUrl],
              cost: 0,
              durationMs: Date.now() - start,
            });
            return;
          }
          if (nodeType === "free-tool/image-eraser") {
            const imageUrl = String(inputs.input ?? params.input ?? "");
            const maskUrl = String(
              inputs.mask_image ?? params.mask_image ?? "",
            );
            if (!imageUrl || !maskUrl) throw new Error("Missing image or mask");
            const base64 = await runImageEraser(
              imageUrl,
              maskUrl,
              params,
              onProgress,
            );
            const dataUrl = base64ToDataUrl(base64);
            results.set(nodeId, {
              outputUrl: dataUrl,
              resultMetadata: { output: dataUrl, resultUrl: dataUrl },
            });
            callbacks.onNodeStatus(nodeId, "confirmed");
            callbacks.onNodeComplete(nodeId, {
              urls: [dataUrl],
              cost: 0,
              durationMs: Date.now() - start,
            });
            return;
          }
          if (nodeType === "free-tool/segment-anything") {
            const inputUrl = String(inputs.input ?? params.input ?? "");
            if (!inputUrl) throw new Error("Missing input");
            const base64 = await runSegmentAnything(
              inputUrl,
              params as {
                pointX?: number;
                pointY?: number;
                __segmentPoints?: string;
                __previewMask?: string;
                invertMask?: boolean;
              },
              onProgress,
            );
            const dataUrl = base64ToDataUrl(base64);
            results.set(nodeId, {
              outputUrl: dataUrl,
              resultMetadata: { output: dataUrl, resultUrl: dataUrl },
            });
            callbacks.onNodeStatus(nodeId, "confirmed");
            callbacks.onNodeComplete(nodeId, {
              urls: [dataUrl],
              cost: 0,
              durationMs: Date.now() - start,
            });
            return;
          }

          // FFmpeg-based free-tool nodes (converter / merger / trimmer)
          if (nodeType === "free-tool/media-merger") {
            const inputKeys = [
              "input1",
              "input2",
              "input3",
              "input4",
              "input5",
            ];
            const inputUrls: string[] = [];
            for (const key of inputKeys) {
              const val = String(inputs[key] ?? params[key] ?? "");
              if (val) inputUrls.push(val);
            }
            if (inputUrls.length < 2)
              throw new Error("Media merger requires at least two inputs.");
            const format = String(params.format ?? "mp4").toLowerCase();
            onProgress(10, "Merging media...");
            const blobUrl = await ffmpegMerge(inputUrls, format);
            onProgress(100, "Merge completed.");
            results.set(nodeId, {
              outputUrl: blobUrl,
              resultMetadata: {
                output: blobUrl,
                resultUrl: blobUrl,
                resultUrls: [blobUrl],
              },
            });
            callbacks.onNodeStatus(nodeId, "confirmed");
            callbacks.onNodeComplete(nodeId, {
              urls: [blobUrl],
              cost: 0,
              durationMs: Date.now() - start,
            });
            return;
          }
          if (nodeType === "free-tool/media-trimmer") {
            const inputUrl = String(inputs.input ?? params.input ?? "");
            if (!inputUrl) throw new Error("Missing input");
            const startTime = Number(params.startTime ?? 0);
            const endTime = Number(params.endTime ?? 10);
            if (
              !Number.isFinite(startTime) ||
              !Number.isFinite(endTime) ||
              endTime <= startTime
            ) {
              throw new Error(
                "Invalid trim range: endTime must be greater than startTime.",
              );
            }
            const format = String(params.format ?? "mp4").toLowerCase();
            onProgress(10, "Trimming media...");
            const blobUrl = await ffmpegTrim(
              inputUrl,
              startTime,
              endTime,
              format,
            );
            onProgress(100, "Trim completed.");
            results.set(nodeId, {
              outputUrl: blobUrl,
              resultMetadata: {
                output: blobUrl,
                resultUrl: blobUrl,
                resultUrls: [blobUrl],
              },
            });
            callbacks.onNodeStatus(nodeId, "confirmed");
            callbacks.onNodeComplete(nodeId, {
              urls: [blobUrl],
              cost: 0,
              durationMs: Date.now() - start,
            });
            return;
          }
          if (nodeType === "free-tool/video-converter") {
            const inputUrl = String(inputs.input ?? params.input ?? "");
            if (!inputUrl) throw new Error("Missing input");
            const formatId = String(params.format ?? "mp4-h264");
            const qualityId = String(params.quality ?? "medium");
            const resolution = String(params.resolution ?? "original");
            const FORMAT_MAP: Record<
              string,
              { ext: string; videoCodec: string; audioCodec: string }
            > = {
              "mp4-h264": {
                ext: "mp4",
                videoCodec: "libx264",
                audioCodec: "aac",
              },
              "mp4-h265": {
                ext: "mp4",
                videoCodec: "libx265",
                audioCodec: "aac",
              },
              "webm-vp9": {
                ext: "webm",
                videoCodec: "libvpx-vp9",
                audioCodec: "libopus",
              },
              "webm-vp8": {
                ext: "webm",
                videoCodec: "libvpx",
                audioCodec: "libvorbis",
              },
              mov: { ext: "mov", videoCodec: "libx264", audioCodec: "aac" },
              avi: { ext: "avi", videoCodec: "libx264", audioCodec: "aac" },
              mkv: { ext: "mkv", videoCodec: "libx264", audioCodec: "aac" },
              mp4: { ext: "mp4", videoCodec: "libx264", audioCodec: "aac" },
              webm: {
                ext: "webm",
                videoCodec: "libvpx-vp9",
                audioCodec: "libopus",
              },
            };
            const BITRATE_MAP: Record<
              string,
              { video: string; audio: string }
            > = {
              low: { video: "1M", audio: "96k" },
              medium: { video: "5M", audio: "128k" },
              high: { video: "10M", audio: "192k" },
              ultra: { video: "20M", audio: "320k" },
            };
            const fmtCfg = FORMAT_MAP[formatId] ?? FORMAT_MAP["mp4-h264"];
            const bitrate = BITRATE_MAP[qualityId] ?? BITRATE_MAP.medium;
            onProgress(10, "Converting video...");
            const blobUrl = await ffmpegConvert(
              inputUrl,
              formatId,
              fmtCfg.ext,
              {
                videoCodec: fmtCfg.videoCodec,
                videoBitrate: bitrate.video,
                audioCodec: fmtCfg.audioCodec,
                audioBitrate: bitrate.audio,
                resolution: resolution !== "original" ? resolution : undefined,
              },
            );
            onProgress(100, "Video conversion completed.");
            results.set(nodeId, {
              outputUrl: blobUrl,
              resultMetadata: {
                output: blobUrl,
                resultUrl: blobUrl,
                resultUrls: [blobUrl],
              },
            });
            callbacks.onNodeStatus(nodeId, "confirmed");
            callbacks.onNodeComplete(nodeId, {
              urls: [blobUrl],
              cost: 0,
              durationMs: Date.now() - start,
            });
            return;
          }
          if (nodeType === "free-tool/audio-converter") {
            const inputUrl = String(inputs.input ?? params.input ?? "");
            if (!inputUrl) throw new Error("Missing input");
            const format = String(params.format ?? "mp3").toLowerCase();
            onProgress(10, "Converting audio...");
            const blobUrl = await ffmpegConvert(inputUrl, format, format);
            onProgress(100, "Audio conversion completed.");
            results.set(nodeId, {
              outputUrl: blobUrl,
              resultMetadata: {
                output: blobUrl,
                resultUrl: blobUrl,
                resultUrls: [blobUrl],
              },
            });
            callbacks.onNodeStatus(nodeId, "confirmed");
            callbacks.onNodeComplete(nodeId, {
              urls: [blobUrl],
              cost: 0,
              durationMs: Date.now() - start,
            });
            return;
          }
          if (nodeType === "free-tool/image-converter") {
            const inputUrl = String(inputs.input ?? params.input ?? "");
            if (!inputUrl) throw new Error("Missing input");
            const format = String(params.format ?? "png").toLowerCase();
            onProgress(10, "Converting image...");
            const blobUrl = await ffmpegConvert(inputUrl, format, format);
            onProgress(100, "Image conversion completed.");
            results.set(nodeId, {
              outputUrl: blobUrl,
              resultMetadata: {
                output: blobUrl,
                resultUrl: blobUrl,
                resultUrls: [blobUrl],
              },
            });
            callbacks.onNodeStatus(nodeId, "confirmed");
            callbacks.onNodeComplete(nodeId, {
              urls: [blobUrl],
              cost: 0,
              durationMs: Date.now() - start,
            });
            return;
          }

          // Helper / processing nodes
          if (nodeType === "processing/concat") {
            const VALUE_KEYS = [
              "value1",
              "value2",
              "value3",
              "value4",
              "value5",
            ];
            const arr: string[] = [];
            for (const key of VALUE_KEYS) {
              const v = inputs[key] ?? params[key];
              if (v === undefined || v === null) continue;
              if (Array.isArray(v)) {
                for (const item of v) {
                  if (item !== undefined && item !== null && item !== "")
                    arr.push(String(item));
                }
              } else {
                const s = String(v).trim();
                if (s) arr.push(s);
              }
            }
            if (arr.length === 0)
              throw new Error("Concat requires at least one non-empty value.");
            results.set(nodeId, {
              outputUrl: arr[0],
              resultMetadata: {
                output: arr,
                resultUrl: arr[0],
                resultUrls: arr,
              },
            });
            callbacks.onNodeStatus(nodeId, "confirmed");
            callbacks.onNodeComplete(nodeId, {
              urls: arr,
              cost: 0,
              durationMs: Date.now() - start,
            });
            return;
          }
          if (nodeType === "processing/select") {
            const raw = inputs.input ?? params.input;
            let arr: string[];
            if (Array.isArray(raw)) {
              arr = raw
                .filter((x): x is string => x !== undefined && x !== null)
                .map(String);
            } else if (raw !== undefined && raw !== null && raw !== "") {
              const s = String(raw).trim();
              arr = s.includes(",")
                ? s
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean)
                : [s];
            } else {
              arr = [];
            }
            const index = Math.floor(Number(params.index ?? 0));
            if (index < 0 || index >= arr.length) {
              throw new Error(
                `Index ${index} out of range (array length ${arr.length}).`,
              );
            }
            const value = arr[index];
            results.set(nodeId, {
              outputUrl: value,
              resultMetadata: {
                output: value,
                resultUrl: value,
                resultUrls: [value],
              },
            });
            callbacks.onNodeStatus(nodeId, "confirmed");
            callbacks.onNodeComplete(nodeId, {
              urls: [value],
              cost: 0,
              durationMs: Date.now() - start,
            });
            return;
          }

          // ── Group (formerly Iterator): execute child nodes as a sub-workflow ONCE ──
          if (nodeType === "control/iterator") {
            // Parse exposed params
            const parseExposed = (
              v: unknown,
            ): Array<{
              subNodeId: string;
              subNodeLabel: string;
              paramKey: string;
              namespacedKey: string;
              direction: string;
              dataType: string;
            }> => {
              if (typeof v === "string") {
                try {
                  return JSON.parse(v);
                } catch {
                  return [];
                }
              }
              return Array.isArray(v) ? v : [];
            };
            const exposedInputs = parseExposed(params.exposedInputs);
            const exposedOutputs = parseExposed(params.exposedOutputs);

            // Collect child nodes and internal edges
            const allNodes = Array.from(nodeMap.values());
            const childNodes = allNodes.filter((n) => n.parentNode === nodeId);
            const childIdSet = new Set(childNodes.map((n) => n.id));
            const internalEdges = edgesWithHandles.filter(
              (e) => childIdSet.has(e.source) && childIdSet.has(e.target),
            );

            if (childNodes.length === 0) {
              results.set(nodeId, { outputUrl: "", resultMetadata: {} });
              callbacks.onNodeStatus(nodeId, "confirmed");
              callbacks.onNodeComplete(nodeId, {
                urls: [],
                cost: 0,
                durationMs: Date.now() - start,
              });
              return;
            }

            // Topological sort of child nodes
            const childSimpleEdges = internalEdges.map((e) => ({
              sourceNodeId: e.source,
              targetNodeId: e.target,
            }));
            const childLevels = topologicalLevels(
              Array.from(childIdSet),
              childSimpleEdges,
            );

            // Build input routing from exposed inputs
            const inputRouting = new Map<string, Map<string, unknown>>();
            for (const ep of exposedInputs) {
              const externalValue =
                inputs[ep.namespacedKey] ?? inputs[`input-${ep.namespacedKey}`];
              if (externalValue !== undefined) {
                if (!inputRouting.has(ep.subNodeId))
                  inputRouting.set(ep.subNodeId, new Map());
                inputRouting.get(ep.subNodeId)!.set(ep.paramKey, externalValue);
              }
            }

            // Execute child nodes — single pass, no iteration
            const subResults = new Map<string, NodeResult>();
            let totalCost = 0;

            for (const level of childLevels) {
              for (const childId of level) {
                throwIfAborted();

                const childNode = nodeMap.get(childId);
                if (!childNode) continue;

                const childType = childNode.data.nodeType;
                const childParams = { ...(childNode.data.params ?? {}) };

                // Inject external inputs
                const extInputs = inputRouting.get(childId);
                if (extInputs) {
                  for (const [pk, val] of extInputs) {
                    childParams[pk] = val;
                  }
                }

                // Resolve internal edges from upstream child outputs
                const childInputs = resolveInputs(
                  childId,
                  nodeMap,
                  internalEdges,
                  subResults,
                );

                callbacks.onNodeStatus(childId, "running");
                const childStart = Date.now();
                try {
                  if (childType === "ai-task/run") {
                    const modelId = String(childParams.modelId ?? "");
                    if (!modelId)
                      throw new Error("No model selected in child node.");
                    const apiParams = buildApiParams(childParams, childInputs);
                    const resolvedParams = await uploadLocalUrls(
                      apiParams,
                      signal,
                    );
                    callbacks.onProgress(childId, 10, `Running ${modelId}...`);
                    const result = await workflowClient.run(
                      modelId,
                      resolvedParams,
                      { signal },
                    );
                    const outputUrl =
                      Array.isArray(result.outputs) && result.outputs.length > 0
                        ? String(result.outputs[0])
                        : "";
                    const model = useModelsStore
                      .getState()
                      .getModelById(modelId);
                    const cost = model?.base_price ?? 0;
                    totalCost += cost;
                    subResults.set(childId, {
                      outputUrl,
                      resultMetadata: {
                        output: outputUrl,
                        resultUrl: outputUrl,
                        resultUrls: Array.isArray(result.outputs)
                          ? result.outputs
                          : [outputUrl],
                      },
                    });
                    callbacks.onNodeStatus(childId, "confirmed");
                    callbacks.onNodeComplete(childId, {
                      urls: Array.isArray(result.outputs)
                        ? result.outputs.map(String)
                        : [outputUrl],
                      cost,
                      durationMs: Date.now() - childStart,
                    });
                  } else if (childType === "input/text-input") {
                    const text = String(
                      childParams.text ?? childInputs.text ?? "",
                    );
                    subResults.set(childId, {
                      outputUrl: text,
                      resultMetadata: { output: text },
                    });
                    callbacks.onNodeStatus(childId, "confirmed");
                    callbacks.onNodeComplete(childId, {
                      urls: [text],
                      cost: 0,
                      durationMs: Date.now() - childStart,
                    });
                  } else if (childType === "input/media-upload") {
                    const url = String(
                      childParams.uploadedUrl ?? childInputs.input ?? "",
                    );
                    subResults.set(childId, {
                      outputUrl: url,
                      resultMetadata: { output: url },
                    });
                    callbacks.onNodeStatus(childId, "confirmed");
                    callbacks.onNodeComplete(childId, {
                      urls: [url],
                      cost: 0,
                      durationMs: Date.now() - childStart,
                    });
                  } else if (childType === "processing/concat") {
                    const arr: string[] = [];
                    for (let ci = 1; ci <= 5; ci++) {
                      const v =
                        childInputs[`input${ci}`] ?? childParams[`input${ci}`];
                      if (v)
                        arr.push(
                          ...(Array.isArray(v) ? v.map(String) : [String(v)]),
                        );
                    }
                    subResults.set(childId, {
                      outputUrl: arr[0] ?? "",
                      resultMetadata: {
                        output: arr,
                        resultUrl: arr[0],
                        resultUrls: arr,
                      },
                    });
                    callbacks.onNodeStatus(childId, "confirmed");
                    callbacks.onNodeComplete(childId, {
                      urls: arr,
                      cost: 0,
                      durationMs: Date.now() - childStart,
                    });
                  } else if (childType === "processing/select") {
                    const raw = childInputs.input ?? childParams.input;
                    const arr = Array.isArray(raw)
                      ? raw.map(String)
                      : raw
                        ? [String(raw)]
                        : [];
                    const idx = Math.floor(Number(childParams.index ?? 0));
                    const value = arr[idx] ?? "";
                    subResults.set(childId, {
                      outputUrl: value,
                      resultMetadata: { output: value },
                    });
                    callbacks.onNodeStatus(childId, "confirmed");
                    callbacks.onNodeComplete(childId, {
                      urls: [value],
                      cost: 0,
                      durationMs: Date.now() - childStart,
                    });
                  } else {
                    const inputUrl = String(
                      childInputs.input ??
                        childInputs.media ??
                        childParams.uploadedUrl ??
                        "",
                    );
                    if (inputUrl) {
                      subResults.set(childId, {
                        outputUrl: inputUrl,
                        resultMetadata: { output: inputUrl },
                      });
                      callbacks.onNodeStatus(childId, "confirmed");
                      callbacks.onNodeComplete(childId, {
                        urls: [inputUrl],
                        cost: 0,
                        durationMs: Date.now() - childStart,
                      });
                    } else {
                      throw new Error(
                        `Unsupported child node type: ${childType}`,
                      );
                    }
                  }
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  callbacks.onNodeStatus(childId, "error", msg);
                  failedNodes.add(nodeId);
                  callbacks.onNodeStatus(
                    nodeId,
                    "error",
                    `Child node failed: ${msg}`,
                  );
                  return;
                }
              }
            }

            // Collect exposed outputs — single values, no array aggregation
            const groupOutputs: Record<string, unknown> = {};
            const allUrls: string[] = [];
            for (const ep of exposedOutputs) {
              const nodeOut = subResults.get(ep.subNodeId);
              if (nodeOut) {
                const val =
                  nodeOut.resultMetadata[ep.paramKey] ?? nodeOut.outputUrl;
                groupOutputs[`output-${ep.namespacedKey}`] = val;
                if (typeof val === "string" && val) allUrls.push(val);
              }
            }

            results.set(nodeId, {
              outputUrl: allUrls[0] ?? "",
              resultMetadata: {
                ...groupOutputs,
                output: allUrls[0] ?? "",
                resultUrl: allUrls[0] ?? "",
                resultUrls: allUrls,
              },
            });
            callbacks.onNodeStatus(nodeId, "confirmed");
            callbacks.onNodeComplete(nodeId, {
              urls: allUrls,
              cost: totalCost,
              durationMs: Date.now() - start,
            });
            return;
          }

          // Unsupported node type — treat as pass-through if it has a single input
          const inputUrl = String(
            inputs.input ?? inputs.media ?? params.uploadedUrl ?? "",
          );
          if (inputUrl) {
            results.set(nodeId, {
              outputUrl: inputUrl,
              resultMetadata: { output: inputUrl },
            });
            callbacks.onNodeStatus(nodeId, "confirmed");
            callbacks.onNodeComplete(nodeId, {
              urls: [inputUrl],
              cost: 0,
              durationMs: Date.now() - start,
            });
          } else {
            throw new Error(`Unsupported node type in browser: ${nodeType}`);
          }
        } catch (err) {
          failedNodes.add(nodeId);
          const msg = err instanceof Error ? err.message : String(err);
          callbacks.onNodeStatus(nodeId, "error", msg);
        }
      }),
    );
  }
}

function guessExtFromUrl(url: string): string {
  const p = url.toLowerCase().split("?")[0];
  const m = p.match(/\.(\w{2,4})$/);
  if (m) return m[1];
  if (p.includes("video") || p.includes("mp4")) return "mp4";
  if (p.includes("audio") || p.includes("mp3")) return "mp3";
  return "png";
}
