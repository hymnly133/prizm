/**
 * BG Session — 轻量级 JSON Schema 验证
 *
 * 仅检查顶层结构和 required 字段。
 * 完整验证场景可替换为 ajv 等库。
 */

export function validateJsonSchema(jsonStr: string, schema: Record<string, unknown>): string | null {
  try {
    const data = JSON.parse(jsonStr)
    if (typeof data !== 'object' || data === null) {
      return 'Expected object, got ' + typeof data
    }

    const required = schema.required as string[] | undefined
    if (required?.length) {
      const missing = required.filter((key) => !(key in data))
      if (missing.length > 0) {
        return `Missing required fields: ${missing.join(', ')}`
      }
    }

    const properties = schema.properties as Record<string, { type?: string }> | undefined
    if (properties) {
      for (const [key, prop] of Object.entries(properties)) {
        if (!(key in data)) continue
        if (prop.type && typeof data[key] !== prop.type && data[key] !== null) {
          if (prop.type === 'array' && !Array.isArray(data[key])) {
            return `Field "${key}" expected array, got ${typeof data[key]}`
          }
          if (prop.type !== 'array') {
            return `Field "${key}" expected ${prop.type}, got ${typeof data[key]}`
          }
        }
      }
    }

    return null
  } catch (err) {
    return `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`
  }
}
