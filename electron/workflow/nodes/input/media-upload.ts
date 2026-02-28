/**
 * Media Upload node — uploads local media file to WaveSpeed CDN.
 * The output is a URL that can be connected to AI Task nodes.
 *
 * In the workflow canvas, this node renders as a drag-and-drop zone.
 * The actual upload happens in the renderer (CustomNode) and the
 * resulting URL is stored in params.uploadedUrl.
 *
 * When executed:
 * - If a CDN URL is already available (manual upload), pass it through.
 * - If input is a local-asset:// path (from upstream free-tool), read the
 *   file from disk and upload it to CDN first.
 */
import {
  BaseNodeHandler,
  type NodeExecutionContext,
  type NodeExecutionResult,
} from "../base";
import type { NodeTypeDefinition } from "../../../../src/workflow/types/node-defs";
import { getWaveSpeedClient } from "../../services/service-locator";
import { existsSync, readFileSync } from "fs";
import { basename } from "path";

export const mediaUploadDef: NodeTypeDefinition = {
  type: "input/media-upload",
  category: "input",
  label: "Upload",
  inputs: [{ key: "media", label: "Media", dataType: "url", required: false }],
  outputs: [{ key: "output", label: "URL", dataType: "url", required: true }],
  params: [
    // uploadedUrl is set by the renderer after file upload completes
    {
      key: "uploadedUrl",
      label: "URL",
      type: "string",
      dataType: "url",
      connectable: false,
      default: "",
    },
    {
      key: "mediaType",
      label: "Type",
      type: "string",
      dataType: "text",
      connectable: false,
      default: "",
    },
    {
      key: "fileName",
      label: "File",
      type: "string",
      dataType: "text",
      connectable: false,
      default: "",
    },
  ],
};

export class MediaUploadHandler extends BaseNodeHandler {
  constructor() {
    super(mediaUploadDef);
  }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    // Prefer connected input over manually uploaded URL
    let url = String(ctx.inputs.media ?? ctx.params.uploadedUrl ?? "");

    if (!url) {
      return {
        status: "error",
        outputs: {},
        durationMs: Date.now() - start,
        cost: 0,
        error:
          "No file uploaded or connected. Please upload a file or connect a media source.",
      };
    }

    // If the URL is a local-asset:// path (from upstream free-tool nodes),
    // read the file from disk and upload it to CDN so downstream API nodes
    // receive a proper HTTP URL.
    if (/^local-asset:\/\//i.test(url)) {
      try {
        ctx.onProgress(10, "Uploading local file to CDN...");
        const localPath = decodeURIComponent(
          url.replace(/^local-asset:\/\//i, ""),
        );
        if (!existsSync(localPath)) {
          return {
            status: "error",
            outputs: {},
            durationMs: Date.now() - start,
            cost: 0,
            error: `Local file not found: ${localPath}`,
          };
        }
        const buffer = readFileSync(localPath);
        const filename = basename(localPath);
        const blob = new Blob([buffer]);
        const file = new File([blob], filename);
        const client = getWaveSpeedClient();
        url = await client.uploadFile(file, filename);
        ctx.onProgress(90, "Upload complete");
      } catch (error) {
        return {
          status: "error",
          outputs: {},
          durationMs: Date.now() - start,
          cost: 0,
          error: `Failed to upload local file: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    return {
      status: "success",
      outputs: { output: url },
      resultPath: url,
      resultMetadata: {
        output: url,
        resultUrl: url,
        resultUrls: [url],
        mediaType: ctx.params.mediaType ?? "image",
        fileName: ctx.params.fileName ?? "",
      },
      durationMs: Date.now() - start,
      cost: 0,
    };
  }
}
