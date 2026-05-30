export const IMAGE_COLORIZER_MODEL_URL =
  "https://huggingface.co/Faridzar/ddcolor-mirror/resolve/main/ddcolor-fp16.onnx";
export const IMAGE_COLORIZER_MODEL_SIZE = 113225654;
export const IMAGE_COLORIZER_CACHE_NAME = "ddcolor-fp16-colorizer-cache";

export interface FreeToolModelDownload {
  id: string;
  labelKey: string;
  url: string;
  cacheName: string;
  size: number;
}

export const FREE_TOOL_MODEL_DOWNLOADS: FreeToolModelDownload[] = [
  {
    id: "imageColorizer",
    labelKey: "settings.cache.models.imageColorizer",
    url: IMAGE_COLORIZER_MODEL_URL,
    cacheName: IMAGE_COLORIZER_CACHE_NAME,
    size: IMAGE_COLORIZER_MODEL_SIZE,
  },
];
