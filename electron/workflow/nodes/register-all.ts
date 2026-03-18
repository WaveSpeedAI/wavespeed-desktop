import { nodeRegistry } from "./registry";
import { mediaUploadDef, MediaUploadHandler } from "./input/media-upload";
import { textInputDef, TextInputHandler } from "./input/text-input";
import {
  directoryImportDef,
  DirectoryImportHandler,
} from "./input/directory-import";
import { aiTaskDef, AITaskHandler } from "./ai-task/run";
import { fileExportDef, FileExportHandler } from "./output/file";
import { previewDisplayDef, PreviewDisplayHandler } from "./output/preview";
import { registerFreeToolNodes } from "./free-tool/register";
import { concatDef, ConcatHandler } from "./processing/concat";
import { selectDef, SelectHandler } from "./processing/select";
import { subgraphDef, SubgraphNodeHandler } from "./control/subgraph";
// Trigger nodes
import {
  directoryTriggerDef,
  DirectoryTriggerHandler,
} from "./trigger/directory";
import { httpTriggerDef, HttpTriggerHandler } from "./trigger/http";
import { httpResponseDef, HttpResponseHandler } from "./output/http-response";

export function registerAllNodes(): void {
  // Trigger nodes
  nodeRegistry.register(directoryTriggerDef, new DirectoryTriggerHandler());
  nodeRegistry.register(httpTriggerDef, new HttpTriggerHandler());

  // Input nodes
  nodeRegistry.register(mediaUploadDef, new MediaUploadHandler());
  nodeRegistry.register(textInputDef, new TextInputHandler());
  nodeRegistry.register(directoryImportDef, new DirectoryImportHandler());

  // AI task
  nodeRegistry.register(aiTaskDef, new AITaskHandler());

  // Output
  nodeRegistry.register(fileExportDef, new FileExportHandler());
  nodeRegistry.register(previewDisplayDef, new PreviewDisplayHandler());
  nodeRegistry.register(httpResponseDef, new HttpResponseHandler());

  // Free tools
  registerFreeToolNodes();

  // Processing
  nodeRegistry.register(concatDef, new ConcatHandler());
  nodeRegistry.register(selectDef, new SelectHandler());

  // Control (Iterator simplified to Group — no iteration, just sub-workflow container)
  nodeRegistry.register(subgraphDef, new SubgraphNodeHandler(nodeRegistry));

  console.log(
    `[Registry] Registered ${nodeRegistry.getAll().length} node types`,
  );
}
