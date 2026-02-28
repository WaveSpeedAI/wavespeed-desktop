/**
 * Storage IPC handlers — file storage and workflow snapshot management.
 */
import { ipcMain, dialog, shell } from "electron";
import { getFileStorageInstance } from "../utils/file-storage";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { v4 as uuid } from "uuid";
import { createWorkflow, updateWorkflow } from "../db/workflow.repo";
import { getModelById } from "../services/model-list";

function getStorage() {
  return getFileStorageInstance();
}

export function registerStorageIpc(): void {
  ipcMain.handle(
    "storage:get-workflow-snapshot",
    async (_event, args: { workflowId: string }) => {
      return getStorage().loadWorkflowSnapshot(args.workflowId);
    },
  );

  ipcMain.handle(
    "storage:get-execution-cache",
    async (
      _event,
      args: { workflowId: string; nodeId: string; executionId: string },
    ) => {
      return null; // simplified — execution cache not used in new structure
    },
  );

  ipcMain.handle(
    "storage:list-node-executions",
    async (_event, args: { workflowId: string; nodeId: string }) => {
      return getStorage().listNodeExecutions(args.workflowId, args.nodeId);
    },
  );

  ipcMain.handle(
    "storage:list-uploaded-files",
    async (_event, args: { workflowId: string; nodeId: string }) => {
      return getStorage().listUploadedFiles(args.workflowId, args.nodeId);
    },
  );

  ipcMain.handle(
    "storage:save-uploaded-file",
    async (
      _event,
      args: {
        workflowId: string;
        nodeId: string;
        filename: string;
        data: Buffer;
      },
    ) => {
      return getStorage().saveUploadedFile(
        args.workflowId,
        args.nodeId,
        args.filename,
        Buffer.from(args.data),
      );
    },
  );

  ipcMain.handle(
    "storage:save-node-output",
    async (
      _event,
      args: {
        workflowId: string;
        nodeId: string;
        prefix: string;
        ext: string;
        data: Buffer;
      },
    ) => {
      return getStorage().saveNodeOutput(
        args.workflowId,
        args.nodeId,
        args.prefix,
        args.ext,
        Buffer.from(args.data),
      );
    },
  );

  ipcMain.handle(
    "storage:copy-uploaded-file",
    async (
      _event,
      args: { workflowId: string; nodeId: string; sourcePath: string },
    ) => {
      return getStorage().copyUploadedFile(
        args.workflowId,
        args.nodeId,
        args.sourcePath,
      );
    },
  );

  ipcMain.handle(
    "storage:get-workflow-disk-usage",
    async (_event, args: { workflowId: string }) => {
      return getStorage().getWorkflowDiskUsage(args.workflowId);
    },
  );

  ipcMain.handle(
    "storage:delete-workflow-files",
    async (_event, args: { workflowId: string }) => {
      getStorage().deleteWorkflowFiles(args.workflowId);
    },
  );

  ipcMain.handle(
    "storage:artifact-exists",
    async (_event, args: { artifactPath: string }) => {
      return getStorage().artifactExists(args.artifactPath);
    },
  );

  ipcMain.handle(
    "storage:export-workflow-json",
    async (
      _event,
      args: {
        workflowId: string;
        workflowName: string;
        graphDefinition: unknown;
      },
    ) => {
      const result = await dialog.showSaveDialog({
        title: "Save Workflow",
        defaultPath: `${args.workflowName}.json`,
        filters: [
          { name: "JSON", extensions: ["json"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (result.canceled || !result.filePath) return null;
      const data = {
        version: "1.0",
        id: args.workflowId,
        name: args.workflowName,
        exportedAt: new Date().toISOString(),
        graphDefinition: args.graphDefinition,
      };
      writeFileSync(result.filePath, JSON.stringify(data, null, 2), "utf-8");
      return result.filePath;
    },
  );

  ipcMain.handle("storage:open-artifacts-folder", async () => {
    const rootPath = getStorage().getRootPath();
    if (!existsSync(rootPath)) mkdirSync(rootPath, { recursive: true });
    shell.openPath(rootPath);
  });

  ipcMain.handle(
    "storage:open-workflow-folder",
    async (_event, args: { workflowId: string }) => {
      const workflowPath = getStorage().getWorkflowDir(args.workflowId);
      if (!existsSync(workflowPath))
        mkdirSync(workflowPath, { recursive: true });
      shell.openPath(workflowPath);
    },
  );

  ipcMain.handle("storage:import-workflow-json", async () => {
    const result = await dialog.showOpenDialog({
      title: "Import Workflow",
      filters: [
        { name: "JSON", extensions: ["json"] },
        { name: "All Files", extensions: ["*"] },
      ],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    try {
      const raw = readFileSync(result.filePaths[0], "utf-8");
      const data = JSON.parse(raw);
      // Support both formats: { graphDefinition: {nodes, edges} } or { nodes, edges }
      const rawGraphDef =
        data.graphDefinition ??
        (data.nodes ? { nodes: data.nodes, edges: data.edges ?? [] } : null);
      const name = data.name ?? "Imported Workflow";
      if (!rawGraphDef || !Array.isArray(rawGraphDef.nodes))
        throw new Error("Invalid workflow file");

      // createWorkflow now auto-deduplicates names, so no need for manual conflict check
      const importName = name + " (imported)";
      const wf = createWorkflow(importName);
      const idMap = new Map<string, string>(); // old ID → new UUID
      for (const n of rawGraphDef.nodes) {
        idMap.set(String((n as Record<string, unknown>).id), uuid());
      }

      const enrichedNodes = rawGraphDef.nodes.map(
        (n: Record<string, unknown>) => {
          const oldId = String(n.id);
          const newId = idMap.get(oldId)!;
          const params = (n.params ?? {}) as Record<string, unknown>;
          const nodeType = String(n.nodeType ?? "ai-task/run");
          const position = (n.position as { x: number; y: number }) ?? {
            x: 200,
            y: 200,
          };

          let label = nodeType;
          let modelInputSchema: unknown[] = [];
          if (nodeType === "ai-task/run" && params.modelId) {
            const model = getModelById(String(params.modelId));
            if (model) {
              label = `🤖 ${model.displayName}`;
              modelInputSchema = model.inputSchema;
            } else {
              label = `🤖 ${String(params.modelId)}`;
            }
          } else if (nodeType === "input/media-upload") {
            label = "📁 Upload";
          } else if (nodeType === "input/text-input") {
            label = "✏️ Text";
          }

          return {
            id: newId,
            workflowId: wf.id,
            nodeType,
            position,
            params: { ...params, __meta: { label, modelInputSchema } },
            currentOutputId: null,
          };
        },
      );

      const enrichedEdges = (rawGraphDef.edges ?? []).map(
        (e: Record<string, unknown>) => ({
          id: uuid(),
          workflowId: wf.id,
          sourceNodeId:
            idMap.get(String(e.sourceNodeId)) ?? String(e.sourceNodeId),
          sourceOutputKey: String(e.sourceOutputKey ?? "output"),
          targetNodeId:
            idMap.get(String(e.targetNodeId)) ?? String(e.targetNodeId),
          targetInputKey: String(e.targetInputKey ?? "input"),
        }),
      );

      const graphDef = { nodes: enrichedNodes, edges: enrichedEdges };
      updateWorkflow(wf.id, wf.name, graphDef);
      getStorage().saveWorkflowSnapshot(wf.id, wf.name, graphDef);
      return { id: wf.id, name: wf.name };
    } catch (err) {
      console.error("[Storage] Import failed:", err);
      return { error: err instanceof Error ? err.message : "Import failed" };
    }
  });

  ipcMain.handle(
    "storage:delete-node-outputs",
    async (_event, args: { workflowId: string; nodeId: string }) => {
      getStorage().deleteNodeOutputs(args.workflowId, args.nodeId);
    },
  );

  ipcMain.handle(
    "storage:clean-workflow-outputs",
    async (_event, args: { workflowId: string }) => {
      const mediaDir = getStorage().getMediaOutputDir(args.workflowId);
      if (existsSync(mediaDir)) {
        require("fs").rmSync(mediaDir, { recursive: true, force: true });
      }
    },
  );
}
