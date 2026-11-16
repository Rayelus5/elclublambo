import { z } from 'zod';
import { type ConfigKey, configSchemas } from './registry';

// The shape of each live config key as JSON Schema (polish phase 4): the admin panel draws its forms from it, so a
// field added to a schema appears in its form with its limits, options and default. The checks that span fields (sums,
// order, dates) stay in the schema and arrive as issues (configIssues).

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: JsonSchema | boolean;
  propertyNames?: JsonSchema;
  /** Arrays: the items' shape, or `false` after a tuple's `prefixItems` (nothing else allowed). */
  items?: JsonSchema | false;
  /** A tuple's items, one shape each ([min, max], a pair of elements; the content editor, 2026-11-16). */
  prefixItems?: JsonSchema[];
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
}

const cache = new Map<ConfigKey, JsonSchema>();

/** The input shape of `key` (defaults included), computed once. */
export function configJsonSchema(key: ConfigKey): JsonSchema {
  let found = cache.get(key);
  if (!found) {
    found = z.toJSONSchema(configSchemas[key] as z.ZodType, { io: 'input', unrepresentable: 'any' }) as JsonSchema;
    cache.set(key, found);
  }
  return found;
}
