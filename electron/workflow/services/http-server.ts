/**
 * Global HTTP server — exposes workflows as REST API endpoints.
 *
 * Uses Node's built-in http module (no external dependencies).
 *
 * Endpoints:
 *   POST /api/workflows/:id/run   — execute a workflow with JSON body as input
 *   GET  /api/workflows/:id/schema — get the workflow's input/output schema
 *   GET  /api/health               — health check
 *
 * The server only works with workflows that have an HTTP Trigger node.
 * The trigger's outputFields define the expected request body fields.
 * The HTTP Response node (if present) defines what gets returned.
 */
import * as http from "http";
import { ExecutionEngine } from "../engine/executor";
import { getNodesByWorkflowId } from "../db/node.repo";
import { getEdgesByWorkflowId } from "../db/edge.repo";
import { getWorkflowById } from "../db/workflow.repo";
import { getExecutionById } from "../db/execution.repo";
import { parseOutputFields } from "../nodes/trigger/http";
import { parseResponseFields } from "../nodes/output/http-response";

export interface HttpServerStatus {
  running: boolean;
  port: number | null;
  url: string | null;
}

let server: http.Server | null = null;
let currentPort: number | null = null;
let engine: ExecutionEngine | null = null;
/** The workflow ID that initiated the server (for the simple POST / route). */
let activeWorkflowId: string | null = null;

export function setHttpServerEngine(e: ExecutionEngine): void {
  engine = e;
}

export function getHttpServerStatus(): HttpServerStatus {
  return {
    running: server !== null && server.listening,
    port: currentPort,
    url: currentPort ? `http://localhost:${currentPort}` : null,
  };
}

export async function startHttpServer(
  port = 3100,
  workflowId?: string,
): Promise<HttpServerStatus> {
  if (server?.listening) {
    // Already running — update active workflow and return current status
    if (workflowId) activeWorkflowId = workflowId;
    return getHttpServerStatus();
  }

  if (workflowId) activeWorkflowId = workflowId;

  return new Promise((resolve, reject) => {
    const srv = http.createServer(handleRequest);

    srv.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${port} is already in use`));
      } else {
        reject(err);
      }
    });

    srv.listen(port, () => {
      server = srv;
      currentPort = port;
      console.log(
        `[HTTP Server] Listening on http://localhost:${port} for workflow ${activeWorkflowId}`,
      );
      resolve(getHttpServerStatus());
    });
  });
}

export function stopHttpServer(): HttpServerStatus {
  if (server) {
    server.close();
    server = null;
    currentPort = null;
    activeWorkflowId = null;
    console.log("[HTTP Server] Stopped");
  }
  return getHttpServerStatus();
}

// ── Request handler ──────────────────────────────────────────────────

function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  const url = new URL(req.url ?? "/", `http://localhost`);
  const path = url.pathname;
  const method = req.method?.toUpperCase() ?? "GET";

  console.log(
    `[HTTP Server] ${method} ${path} (activeWorkflowId=${activeWorkflowId})`,
  );

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /api/health
  if (method === "GET" && path === "/api/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  // GET /schema — schema for the active workflow
  if (method === "GET" && path === "/schema") {
    if (!activeWorkflowId) {
      sendJson(res, 400, { error: "No active workflow." });
      return;
    }
    handleGetSchema(activeWorkflowId, res);
    return;
  }

  // Route: /api/workflows/:id/run or /api/workflows/:id/schema
  const runMatch = path.match(/^\/api\/workflows\/([^/]+)\/run$/);
  const schemaMatch = path.match(/^\/api\/workflows\/([^/]+)\/schema$/);

  if (runMatch && method === "POST") {
    const workflowId = decodeURIComponent(runMatch[1]);
    readBody(req)
      .then((body) => {
        handleRunWorkflow(workflowId, body, res);
      })
      .catch((err) => {
        sendJson(res, 400, { error: `Invalid request body: ${err.message}` });
      });
    return;
  }

  if (schemaMatch && method === "GET") {
    const workflowId = decodeURIComponent(schemaMatch[1]);
    handleGetSchema(workflowId, res);
    return;
  }

  // POST to any path — use the active workflow (simple default route)
  if (method === "POST") {
    if (!activeWorkflowId) {
      sendJson(res, 400, {
        error:
          "No active workflow. Start the server from a workflow with an HTTP Trigger.",
      });
      return;
    }
    readBody(req)
      .then((body) => {
        handleRunWorkflow(activeWorkflowId!, body, res);
      })
      .catch((err) => {
        sendJson(res, 400, { error: `Invalid request body: ${err.message}` });
      });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

// ── Route handlers

async function handleRunWorkflow(
  workflowId: string,
  body: Record<string, unknown>,
  res: http.ServerResponse,
): Promise<void> {
  if (!engine) {
    sendJson(res, 500, { error: "Execution engine not initialized" });
    return;
  }

  // Verify workflow exists
  const workflow = getWorkflowById(workflowId);
  if (!workflow) {
    sendJson(res, 404, { error: `Workflow not found: ${workflowId}` });
    return;
  }

  // Verify workflow has an HTTP Trigger
  const nodes = getNodesByWorkflowId(workflowId);
  const httpTrigger = nodes.find((n) => n.nodeType === "trigger/http");
  if (!httpTrigger) {
    sendJson(res, 400, {
      error:
        "This workflow does not have an HTTP Trigger node. Only workflows with HTTP Trigger can be called via API.",
    });
    return;
  }

  try {
    console.log(
      `[HTTP Server] Running workflow ${workflowId} with body:`,
      JSON.stringify(body).slice(0, 200),
    );
    const result = await engine.runAll(workflowId, body);
    console.log(
      `[HTTP Server] runAll result:`,
      JSON.stringify(result)?.slice(0, 500),
    );

    if (result && typeof result === "object") {
      const statusCode = (result.statusCode as number) ?? 200;
      const responseBody = result.body ?? result;
      const bodyObj = responseBody as Record<string, unknown>;

      // If the engine returned an error (e.g. node failure without HTTP Response)
      if (statusCode >= 400) {
        sendJson(res, statusCode, {
          error_msg: String(
            bodyObj.error ?? bodyObj.message ?? "Workflow execution failed",
          ),
        });
        return;
      }

      // Clean response — remove internal keys
      const cleanBody = { ...bodyObj };
      delete cleanBody.statusCode;
      if (Object.keys(cleanBody).length === 0) {
        const fallback = collectLastNodeOutputs(workflowId);
        sendJson(res, 200, fallback);
      } else {
        sendJson(res, 200, cleanBody);
      }
    } else {
      // No HTTP Response node — collect outputs from terminal nodes
      const fallback = collectLastNodeOutputs(workflowId);
      sendJson(res, 200, fallback);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[HTTP Server] Workflow execution failed:`, message);
    sendJson(res, 500, { error_msg: message });
  }
}

function handleGetSchema(workflowId: string, res: http.ServerResponse): void {
  const workflow = getWorkflowById(workflowId);
  if (!workflow) {
    sendJson(res, 404, { error: `Workflow not found: ${workflowId}` });
    return;
  }

  const nodes = getNodesByWorkflowId(workflowId);
  const httpTrigger = nodes.find((n) => n.nodeType === "trigger/http");
  const httpResponse = nodes.find((n) => n.nodeType === "output/http-response");

  if (!httpTrigger) {
    sendJson(res, 400, {
      error: "This workflow does not have an HTTP Trigger node.",
    });
    return;
  }

  const inputFields = parseOutputFields(httpTrigger.params.outputFields);
  const outputFields = httpResponse
    ? parseResponseFields(httpResponse.params.responseFields)
    : [];

  sendJson(res, 200, {
    workflowId,
    name: workflow.name,
    inputs: inputFields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
    })),
    outputs: outputFields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
    })),
  });
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  data: Record<string, unknown>,
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/**
 * Fallback: when no HTTP Response node exists, collect outputs from terminal nodes
 * (nodes with no outgoing edges, excluding trigger nodes).
 */
function collectLastNodeOutputs(workflowId: string): Record<string, unknown> {
  const nodes = getNodesByWorkflowId(workflowId);
  const edges = getEdgesByWorkflowId(workflowId);

  // Find terminal nodes: nodes that are NOT a source of any edge
  const sourceIds = new Set(edges.map((e) => e.sourceNodeId));
  const terminalNodes = nodes.filter(
    (n) => !sourceIds.has(n.id) && !n.nodeType.startsWith("trigger/"),
  );

  const outputs: Record<string, unknown> = {};
  for (const node of terminalNodes) {
    if (!node.currentOutputId) continue;
    const exec = getExecutionById(node.currentOutputId);
    if (!exec || exec.status !== "success") continue;

    const meta = exec.resultMetadata as Record<string, unknown> | null;
    if (!meta) continue;

    // Use resultUrls or resultPath as the output value
    const resultUrls = meta.resultUrls as string[] | undefined;
    const resultUrl = (meta.resultUrl as string) ?? exec.resultPath;
    const value =
      resultUrls && resultUrls.length > 0
        ? resultUrls.length === 1
          ? resultUrls[0]
          : resultUrls
        : (resultUrl ?? meta.output);

    if (value !== undefined && value !== null) {
      // Use node label or type as key
      const label =
        ((node.params?.__meta as Record<string, unknown>)?.label as string) ??
        node.nodeType.split("/").pop() ??
        node.id;
      outputs[label] = value;
    }
  }

  if (Object.keys(outputs).length === 0) {
    return { status: "completed" };
  }

  // If only one terminal node, flatten the output
  const keys = Object.keys(outputs);
  if (keys.length === 1) {
    return { status: "completed", output: outputs[keys[0]] };
  }

  return { status: "completed", outputs };
}
