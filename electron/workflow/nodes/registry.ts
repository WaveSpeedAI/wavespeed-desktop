/**
 * Node type registry — register and lookup node handlers.
 */
import type {
  NodeTypeDefinition,
  NodeCategory,
} from "../../../src/workflow/types/node-defs";
import type { NodeHandler } from "./base";

export class NodeRegistry {
  private handlers = new Map<string, NodeHandler>();
  private definitions = new Map<string, NodeTypeDefinition>();

  register(definition: NodeTypeDefinition, handler: NodeHandler): void {
    this.definitions.set(definition.type, definition);
    this.handlers.set(definition.type, handler);
  }

  getHandler(type: string): NodeHandler | undefined {
    return this.handlers.get(type);
  }

  getDefinition(type: string): NodeTypeDefinition | undefined {
    return this.definitions.get(type);
  }

  getAll(): NodeTypeDefinition[] {
    return Array.from(this.definitions.values());
  }

  getByCategory(category: NodeCategory): NodeTypeDefinition[] {
    return this.getAll().filter((d) => d.category === category);
  }

  getAllTypes(): string[] {
    return Array.from(this.definitions.keys());
  }
}

export const nodeRegistry = new NodeRegistry();
