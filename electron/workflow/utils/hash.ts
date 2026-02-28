/**
 * Hash utilities — SHA-256 of JSON-stable-stringify.
 */
import { createHash } from "crypto";
import stringify from "json-stable-stringify";

export function computeInputHash(inputs: Record<string, unknown>): string {
  return createHash("sha256")
    .update(stringify(inputs) || "{}")
    .digest("hex");
}

export function computeParamsHash(params: Record<string, unknown>): string {
  return createHash("sha256")
    .update(stringify(params) || "{}")
    .digest("hex");
}
