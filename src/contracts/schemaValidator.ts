export type JsonSchema =
  | {
      type: 'object';
      properties: Record<string, JsonSchema>;
      required?: string[];
      additionalProperties?: boolean;
    }
  | { type: 'string'; enum?: string[]; format?: 'uuid'; minLength?: number }
  | { type: 'number' | 'integer'; minimum?: number; maximum?: number }
  | { type: 'boolean' }
  | { type: 'array'; items: JsonSchema };

export interface ValidationResult<T> {
  success: boolean;
  errors: string[];
  value?: T;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateSchema(
  schema: JsonSchema,
  value: unknown,
  path = '',
  lenient = false,
): ValidationResult<unknown> {
  const errors: string[] = [];
  const fullPath = path || 'root';

  switch (schema.type) {
    case 'string': {
      if (typeof value !== 'string') {
        errors.push(`${fullPath} must be a string`);
        break;
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(`${fullPath} must be at least ${schema.minLength} characters`);
      }
      if (schema.enum && !schema.enum.includes(value)) {
        errors.push(`${fullPath} must be one of ${schema.enum.join(', ')}`);
      }
      if (schema.format === 'uuid') {
        const uuidRe =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRe.test(value)) {
          errors.push(`${fullPath} must be a valid UUID`);
        }
      }
      break;
    }
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push(`${fullPath} must be a finite number`);
        break;
      }
      if (schema.type === 'integer' && !Number.isInteger(value)) {
        errors.push(`${fullPath} must be an integer`);
      }
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push(`${fullPath} must be >= ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push(`${fullPath} must be <= ${schema.maximum}`);
      }
      break;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        errors.push(`${fullPath} must be a boolean`);
      }
      break;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        errors.push(`${fullPath} must be an array`);
        break;
      }
      value.forEach((item, idx) => {
        const child = validateSchema(schema.items, item, `${fullPath}[${idx}]`, lenient);
        errors.push(...child.errors);
      });
      break;
    }
    case 'object': {
      if (!isObject(value)) {
        errors.push(`${fullPath} must be an object`);
        break;
      }
      const required = schema.required ?? [];
      for (const req of required) {
        if (!(req in value)) {
          errors.push(`${fullPath}.${req} is required`);
        }
      }
      for (const [key, childSchema] of Object.entries(schema.properties)) {
        if (key in value) {
          const child = validateSchema(
            childSchema,
            (value as Record<string, unknown>)[key],
            `${fullPath}.${key}`,
            lenient,
          );
          errors.push(...child.errors);
        }
      }
      if (schema.additionalProperties === false && !lenient) {
        for (const key of Object.keys(value)) {
          if (!schema.properties[key]) {
            errors.push(`${fullPath}.${key} is not allowed`);
          }
        }
      }
      break;
    }
    default:
      errors.push(`${fullPath} uses unsupported schema type`);
  }

  return { success: errors.length === 0, errors, value };
}

export function validateWithSchema<T>(
  schema: JsonSchema,
  value: unknown,
  lenient = false,
): ValidationResult<T> {
  const result = validateSchema(schema, value, '', lenient);
  if (result.success) {
    return { success: true, errors: [], value: value as T };
  }
  return { success: false, errors: result.errors };
}
