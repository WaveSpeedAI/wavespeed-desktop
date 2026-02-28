/**
 * Icon mapping for workflow node types.
 * Uses the same lucide-react icons as the Free Tools page for consistency.
 */
import {
  Video,
  ImageUp,
  Sparkles,
  ArrowLeftRight,
  Eraser,
  Wand2,
  MousePointer2,
  FileVideo,
  FileAudio,
  FileImage,
  Scissors,
  Combine,
  Upload,
  Type,
  Cpu,
  Eye,
  Download,
  GitMerge,
  ListFilter,
  type LucideIcon,
} from "lucide-react";

const NODE_ICON_MAP: Record<string, LucideIcon> = {
  // Free tools — same icons as FreeToolsPage
  "free-tool/video-enhancer": Video,
  "free-tool/image-enhancer": ImageUp,
  "free-tool/face-enhancer": Sparkles,
  "free-tool/face-swapper": ArrowLeftRight,
  "free-tool/background-remover": Eraser,
  "free-tool/image-eraser": Wand2,
  "free-tool/segment-anything": MousePointer2,
  "free-tool/video-converter": FileVideo,
  "free-tool/audio-converter": FileAudio,
  "free-tool/image-converter": FileImage,
  "free-tool/media-trimmer": Scissors,
  "free-tool/media-merger": Combine,
  // Input
  "input/media-upload": Upload,
  "input/text-input": Type,
  // AI Task
  "ai-task/run": Cpu,
  // Output
  "output/preview": Eye,
  "output/file": Download,
  // Processing
  "processing/concat": GitMerge,
  "processing/select": ListFilter,
};

export function getNodeIcon(nodeType: string): LucideIcon | null {
  return NODE_ICON_MAP[nodeType] ?? null;
}
