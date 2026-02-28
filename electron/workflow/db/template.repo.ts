/**
 * Template repository — CRUD operations for templates table.
 */
import { v4 as uuid } from "uuid";
import { getDatabase, persistDatabase } from "./connection";
import type {
  Template,
  TemplateFilter,
  CreateTemplateInput,
} from "../../../src/types/template";

export function createTemplate(input: CreateTemplateInput): Template {
  const db = getDatabase();
  const id = uuid();
  const now = new Date().toISOString();

  const tags = input.tags ? JSON.stringify(input.tags) : null;
  const playgroundData =
    input.templateType === "playground" && input.playgroundData
      ? JSON.stringify(input.playgroundData)
      : null;
  const workflowData =
    input.templateType === "workflow" && input.workflowData
      ? JSON.stringify(input.workflowData)
      : null;

  db.run(
    `INSERT INTO templates (
      id, name, description, tags, type, template_type, is_favorite,
      created_at, updated_at, author, use_count, thumbnail,
      playground_data, workflow_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.description || null,
      tags,
      input.type,
      input.templateType,
      0,
      now,
      now,
      input.author || null,
      0,
      input.thumbnail || null,
      playgroundData,
      workflowData,
    ],
  );

  persistDatabase();
  return getTemplateById(id)!;
}

export function getTemplateById(id: string): Template | null {
  const db = getDatabase();
  const result = db.exec(
    `SELECT id, name, description, tags, type, template_type, is_favorite,
            created_at, updated_at, author, use_count, thumbnail,
            playground_data, workflow_data
     FROM templates WHERE id = ?`,
    [id],
  );

  if (!result.length || !result[0].values.length) return null;
  return rowToTemplate(result[0].values[0]);
}

export function queryTemplates(filter?: TemplateFilter): Template[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: any[] = [];

  if (filter?.templateType) {
    conditions.push("template_type = ?");
    params.push(filter.templateType);
  }

  if (filter?.type) {
    conditions.push("type = ?");
    params.push(filter.type);
  }

  if (filter?.isFavorite !== undefined) {
    conditions.push("is_favorite = ?");
    params.push(filter.isFavorite ? 1 : 0);
  }

  if (filter?.category && filter.templateType === "workflow") {
    conditions.push("json_extract(workflow_data, '$.category') = ?");
    params.push(filter.category);
  }

  if (filter?.search) {
    const searchPattern = `%${filter.search}%`;
    conditions.push("(name LIKE ? OR description LIKE ? OR tags LIKE ?)");
    params.push(searchPattern, searchPattern, searchPattern);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderBy =
    filter?.sortBy === "useCount"
      ? "ORDER BY use_count DESC, updated_at DESC"
      : "ORDER BY updated_at DESC";

  const query = `SELECT id, name, description, tags, type, template_type, is_favorite,
                        created_at, updated_at, author, use_count, thumbnail,
                        playground_data, workflow_data
                 FROM templates ${whereClause} ${orderBy}`;
  const result = db.exec(query, params);

  if (!result.length) return [];
  return result[0].values.map(rowToTemplate);
}

export function updateTemplate(id: string, updates: Partial<Template>): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  const setClauses: string[] = ["updated_at = ?"];
  const params: any[] = [now];

  if (updates.name !== undefined) {
    setClauses.push("name = ?");
    params.push(updates.name);
  }

  if (updates.description !== undefined) {
    setClauses.push("description = ?");
    params.push(updates.description);
  }

  if (updates.tags !== undefined) {
    setClauses.push("tags = ?");
    params.push(JSON.stringify(updates.tags));
  }

  if (updates.thumbnail !== undefined) {
    setClauses.push("thumbnail = ?");
    params.push(updates.thumbnail);
  }

  if (updates.playgroundData !== undefined) {
    setClauses.push("playground_data = ?");
    params.push(JSON.stringify(updates.playgroundData));
  }

  if (updates.workflowData !== undefined) {
    setClauses.push("workflow_data = ?");
    params.push(JSON.stringify(updates.workflowData));
  }

  params.push(id);
  db.run(`UPDATE templates SET ${setClauses.join(", ")} WHERE id = ?`, params);
  persistDatabase();
}

export function toggleFavorite(id: string): boolean {
  const db = getDatabase();
  const template = getTemplateById(id);
  if (!template) throw new Error(`Template ${id} not found`);

  const newValue = template.isFavorite ? 0 : 1;
  db.run("UPDATE templates SET is_favorite = ?, updated_at = ? WHERE id = ?", [
    newValue,
    new Date().toISOString(),
    id,
  ]);
  persistDatabase();
  return newValue === 1;
}

export function incrementUseCount(id: string): void {
  const db = getDatabase();
  db.run(
    "UPDATE templates SET use_count = use_count + 1, updated_at = ? WHERE id = ?",
    [new Date().toISOString(), id],
  );
  persistDatabase();
}

export function deleteTemplate(id: string): void {
  const db = getDatabase();
  db.run("DELETE FROM templates WHERE id = ?", [id]);
  persistDatabase();
}

export function deleteTemplates(ids: string[]): void {
  const db = getDatabase();
  const placeholders = ids.map(() => "?").join(",");
  db.run(`DELETE FROM templates WHERE id IN (${placeholders})`, ids);
  persistDatabase();
}

function rowToTemplate(row: any[]): Template {
  const tags = row[3] ? JSON.parse(row[3] as string) : [];
  const playgroundData = row[12] ? JSON.parse(row[12] as string) : null;
  const workflowData = row[13] ? JSON.parse(row[13] as string) : null;

  return {
    id: row[0] as string,
    name: row[1] as string,
    description: row[2] as string | null,
    tags,
    type: row[4] as "public" | "custom",
    templateType: row[5] as "playground" | "workflow",
    isFavorite: row[6] === 1,
    createdAt: row[7] as string,
    updatedAt: row[8] as string,
    author: row[9] as string | null,
    useCount: row[10] as number,
    thumbnail: row[11] as string | null,
    playgroundData,
    workflowData,
  };
}
