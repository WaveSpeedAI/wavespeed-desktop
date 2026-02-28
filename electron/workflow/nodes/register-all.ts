import { nodeRegistry } from "./registry";
import { mediaUploadDef, MediaUploadHandler } from "./input/media-upload";
import { textInputDef, TextInputHandler } from "./input/text-input";
import { aiTaskDef, AITaskHandler } from "./ai-task/run";
import { fileExportDef, FileExportHandler } from "./output/file";
import { previewDisplayDef, PreviewDisplayHandler } from "./output/preview";
import { registerFreeToolNodes } from "./free-tool/register";
import { concatDef, ConcatHandler } from "./processing/concat";
import { selectDef, SelectHandler } from "./processing/select";

export function registerAllNodes(): void {
  nodeRegistry.register(mediaUploadDef, new MediaUploadHandler());
  nodeRegistry.register(textInputDef, new TextInputHandler());
  nodeRegistry.register(aiTaskDef, new AITaskHandler());
  nodeRegistry.register(fileExportDef, new FileExportHandler());
  nodeRegistry.register(previewDisplayDef, new PreviewDisplayHandler());
  registerFreeToolNodes();
  nodeRegistry.register(concatDef, new ConcatHandler());
  nodeRegistry.register(selectDef, new SelectHandler());
  console.log(
    `[Registry] Registered ${nodeRegistry.getAll().length} node types`,
  );
}
