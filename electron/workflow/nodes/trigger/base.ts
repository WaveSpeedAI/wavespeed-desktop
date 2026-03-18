/**
 * Trigger node base — defines the interface for trigger nodes that drive workflow execution.
 *
 * Trigger nodes are special input nodes that determine:
 * - What data enters the workflow
 * - How many times the workflow executes (single vs batch)
 *
 * A workflow has at most one trigger node. If the trigger is a batch type,
 * the engine calls getItems() and executes the full workflow once per item.
 */
import type { NodeHandler } from "../base";

export type TriggerMode = "single" | "batch";

export interface BatchItem {
  /** Unique ID for dedup and progress tracking */
  id: string;
  /** The value passed to downstream nodes for this item */
  value: unknown;
  /** Display label for UI (e.g. filename, message ID) */
  label?: string;
}

export interface TriggerHandler extends NodeHandler {
  /** Whether this trigger produces a single value or a batch of items */
  readonly triggerMode: TriggerMode;

  /**
   * For batch triggers: return all items to iterate over.
   * The engine will execute the workflow once per item.
   * For single triggers: this is not called.
   */
  getItems?(params: Record<string, unknown>): Promise<BatchItem[]>;
}

/**
 * Type guard to check if a NodeHandler is a TriggerHandler.
 */
export function isTriggerHandler(
  handler: NodeHandler,
): handler is TriggerHandler {
  return "triggerMode" in handler;
}
