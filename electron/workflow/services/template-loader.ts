/**
 * Template loader — loads workflow templates from data/templates directory
 */
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import type { CreateTemplateInput } from "../../../src/types/template";
import type { GraphDefinition } from "../../../src/workflow/types/workflow";

interface TemplateFileData {
  // Standard template format
  name?: string;
  i18nKey?: string;
  description?: string;
  tags?: string[];
  category?: string;
  author?: string;
  thumbnail?: string;
  graphDefinition: GraphDefinition;

  // Exported workflow format (alternative)
  version?: string;
  id?: string;
  exportedAt?: string;
}

// Category mapping from directory name to category identifier used in UI filters
const CATEGORY_MAP: Record<string, string> = {
  "image-processing": "image-processing",
  "video-processing": "video-editing",
  "audio-processing": "audio-conversion",
  "face-processing": "image-processing",
  "media-processing": "video-editing",
  "ai-generation": "ai-generation",
};

// Cache: i18nKey → all translated names/descriptions concatenated for search
let i18nSearchMap: Record<string, string> = {};

/**
 * Load all locale files and build a search text map for preset templates.
 * Maps i18nKey → concatenated translated names + descriptions from all locales.
 */
function loadI18nSearchMap(): Record<string, string> {
  const map: Record<string, string> = {};
  const localesDir = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar", "out", "renderer", "locales")
    : path.join(process.cwd(), "src", "i18n", "locales");

  try {
    if (!fs.existsSync(localesDir)) {
      console.warn("[TemplateLoader] Locales directory not found:", localesDir);
      return map;
    }
    const localeFiles = fs
      .readdirSync(localesDir)
      .filter((f) => f.endsWith(".json"));
    for (const file of localeFiles) {
      try {
        const content = fs.readFileSync(path.join(localesDir, file), "utf-8");
        const locale = JSON.parse(content);
        const presets = locale?.presetTemplates;
        if (!presets) continue;
        for (const [key, val] of Object.entries(presets) as [string, any][]) {
          const text = [val.name || "", val.description || ""].join(" ");
          map[key] = map[key] ? `${map[key]} ${text}` : text;
        }
      } catch {
        /* skip broken locale files */
      }
    }
    console.log(
      `[TemplateLoader] Built i18n search index for ${Object.keys(map).length} preset keys from ${localeFiles.length} locales`,
    );
  } catch (error) {
    console.error("[TemplateLoader] Failed to load i18n search map:", error);
  }
  return map;
}

/**
 * Get the templates directory path
 */
function getTemplatesDir(): string {
  // In development, use the project root
  if (!app.isPackaged) {
    return path.join(process.cwd(), "data", "templates");
  }
  // In production, use the resources directory
  return path.join(process.resourcesPath, "data", "templates");
}

/**
 * Load all workflow templates from the data/templates directory
 */
export function loadTemplatesFromFiles(): CreateTemplateInput[] {
  const templates: CreateTemplateInput[] = [];
  const templatesDir = getTemplatesDir();

  if (!fs.existsSync(templatesDir)) {
    console.warn(
      "[TemplateLoader] Templates directory not found:",
      templatesDir,
    );
    return templates;
  }
  console.log("[TemplateLoader] Reading templates from:", templatesDir);

  // Build i18n search index once
  i18nSearchMap = loadI18nSearchMap();

  try {
    // Read all category directories
    const categories = fs
      .readdirSync(templatesDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    for (const categoryDir of categories) {
      const categoryPath = path.join(templatesDir, categoryDir);
      const category = CATEGORY_MAP[categoryDir] || categoryDir;

      // Read all JSON files in the category directory
      const files = fs
        .readdirSync(categoryPath)
        .filter((file) => file.endsWith(".json"));

      for (const file of files) {
        try {
          const filePath = path.join(categoryPath, file);
          const content = fs.readFileSync(filePath, "utf-8");
          const data: TemplateFileData = JSON.parse(content);

          // Determine template name (from name field or filename)
          const templateName = data.name || path.basename(file, ".json");

          // Clean up graphDefinition - ensure workflowId is empty string
          const cleanedNodes = data.graphDefinition.nodes.map((node) => ({
            ...node,
            workflowId: "",
            currentOutputId: node.currentOutputId || null,
          }));

          const cleanedEdges = data.graphDefinition.edges.map((edge) => ({
            ...edge,
            workflowId: "",
          }));

          const cleanedGraphDefinition: GraphDefinition = {
            nodes: cleanedNodes,
            edges: cleanedEdges,
          };

          // Count nodes and extract node types
          const nodeCount = cleanedNodes.length;
          const nodeTypes = [...new Set(cleanedNodes.map((n) => n.nodeType))];

          // Extract use cases from tags or generate from category
          const useCases = data.tags || [category.replace("-", " ")];

          // Resolve thumbnail: use explicit field, or auto-extract from first image upload node
          let thumbnail = data.thumbnail || null;
          if (!thumbnail) {
            const imageUploadNode = cleanedNodes.find(
              (n: any) =>
                n.nodeType === "input/media-upload" &&
                n.params?.mediaType === "image" &&
                n.params?.uploadedUrl,
            );
            if (imageUploadNode) {
              thumbnail = (imageUploadNode as any).params.uploadedUrl;
            }
          }

          const template: CreateTemplateInput = {
            name: templateName,
            i18nKey: data.i18nKey || undefined,
            _searchText: data.i18nKey ? i18nSearchMap[data.i18nKey] || "" : "",
            description: data.description || null,
            tags: data.tags || [],
            type: "public",
            templateType: "workflow",
            author: data.author || "WaveSpeed",
            thumbnail,
            workflowData: {
              category: data.category || category,
              graphDefinition: cleanedGraphDefinition,
              nodeTypes,
              nodeCount,
              useCases,
            },
          };

          templates.push(template);
          console.log(
            `[TemplateLoader] Loaded template: ${templateName} from ${categoryDir}/${file}`,
          );
        } catch (error) {
          console.error(
            `[TemplateLoader] Failed to load template from ${categoryDir}/${file}:`,
            error,
          );
        }
      }
    }

    console.log(
      `[TemplateLoader] Successfully loaded ${templates.length} templates from files`,
    );
  } catch (error) {
    console.error("[TemplateLoader] Failed to load templates:", error);
  }

  return templates;
}
