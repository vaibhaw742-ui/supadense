// Converts BrainTools definitions → MCP JSON Schema tool list
// Mirrors gbrain's buildToolDefs(ops) in src/mcp/tool-defs.ts

import { BrainTools } from "../plugin/tools"
import type { ZodTypeAny } from "zod"

export interface McpToolDef {
  name:        string
  description: string
  inputSchema: {
    type:       "object"
    properties: Record<string, unknown>
    required:   string[]
  }
}

/** Convert a Zod schema to JSON Schema (subset used by BrainTools) */
function zodToJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const def = (schema as any)._def

  if (!def) return { type: "string" }

  switch (def.typeName) {
    case "ZodString":   return { type: "string", ...(def.description ? { description: def.description } : {}) }
    case "ZodNumber":   return { type: "number" }
    case "ZodBoolean":  return { type: "boolean" }
    case "ZodOptional": return zodToJsonSchema(def.innerType)
    case "ZodDefault":  return { ...zodToJsonSchema(def.innerType), default: def.defaultValue() }
    case "ZodArray":    return { type: "array", items: zodToJsonSchema(def.type) }
    case "ZodEnum":     return { type: "string", enum: def.values }
    case "ZodUnion":    return { oneOf: def.options.map(zodToJsonSchema) }
    case "ZodObject": {
      const props: Record<string, unknown> = {}
      const required: string[] = []
      for (const [k, v] of Object.entries(def.shape())) {
        const inner = v as ZodTypeAny
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const innerDef = (inner as any)._def
        props[k] = zodToJsonSchema(inner)
        if (innerDef?.typeName !== "ZodOptional" && innerDef?.typeName !== "ZodDefault") {
          required.push(k)
        }
        // Carry description from .describe()
        if (innerDef?.description) (props[k] as Record<string, unknown>).description = innerDef.description
      }
      return { type: "object", properties: props, ...(required.length ? { required } : {}) }
    }
    default: return { type: "string" }
  }
}

export function buildMcpToolDefs(): McpToolDef[] {
  return Object.entries(BrainTools).map(([name, tool]) => {
    const schema = zodToJsonSchema(tool.parameters) as {
      type: "object"; properties: Record<string, unknown>; required?: string[]
    }
    return {
      name,
      description: tool.description,
      inputSchema: {
        type:       "object",
        properties: schema.properties ?? {},
        required:   schema.required   ?? [],
      },
    }
  })
}

// Cached at module level — tool defs don't change at runtime
let _cached: McpToolDef[] | null = null
export function getMcpToolDefs(): McpToolDef[] {
  if (!_cached) _cached = buildMcpToolDefs()
  return _cached
}
