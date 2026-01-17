/**
 * Function definition formatting for token counting.
 *
 * Formats function definitions as TypeScript namespace strings for tokenization.
 */

import type {
  FunctionDefinition,
  FunctionParameters,
  FunctionParameterProperty,
} from './types.js';

/**
 * Format a parameter type for TypeScript.
 */
export function formatFunctionType(
  param: FunctionParameterProperty,
  indent: number
): string {
  switch (param.type) {
    case 'string':
      return (
        param.enum?.map((value) => JSON.stringify(value)).join(' | ') ??
        'string'
      );
    case 'integer':
    case 'number':
      return param.enum?.map((value) => `${value}`).join(' | ') ?? 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array':
      return param.items
        ? `${formatFunctionType(param.items, indent)}[]`
        : 'any[]';
    case 'object': {
      const inner = formatObjectProperties(
        param as FunctionParameters,
        indent + 2,
        formatFunctionType
      );
      const closingIndent = ' '.repeat(indent);
      return `{\n${inner}\n${closingIndent}}`;
    }
    default:
      return 'any';
  }
}

/**
 * Format object properties for TypeScript type definition.
 */
export function formatObjectProperties(
  obj: FunctionParameters,
  indent: number,
  formatType: (param: FunctionParameterProperty, indent: number) => string
): string {
  if (!obj.properties) {
    return '';
  }

  const lines: string[] = [];
  const requiredParams = new Set(obj.required ?? []);
  const indentString = ' '.repeat(indent);

  for (const [name, param] of Object.entries(obj.properties)) {
    if (param.description && indent < 2) {
      lines.push(`${indentString}// ${param.description}`);
    }
    const isRequired = requiredParams.has(name);
    const formattedType = formatType(param, indent);
    lines.push(
      `${indentString}${name}${isRequired ? '' : '?'}: ${formattedType},`
    );
  }

  return lines.join('\n');
}

/**
 * Format function definitions as TypeScript namespace.
 */
export function formatFunctionDefinitions(
  functions: FunctionDefinition[]
): string {
  const lines: string[] = ['namespace functions {', ''];

  for (const fn of functions) {
    if (fn.description) {
      lines.push(`// ${fn.description}`);
    }

    const parameters = fn.parameters;
    const properties = parameters?.properties;

    if (!parameters || !properties || Object.keys(properties).length === 0) {
      lines.push(`type ${fn.name} = () => any;`);
    } else {
      lines.push(`type ${fn.name} = (_: {`);
      const formattedProperties = formatObjectProperties(
        parameters,
        0,
        formatFunctionType
      );
      if (formattedProperties.length > 0) {
        lines.push(formattedProperties);
      }
      lines.push('}) => any;');
    }
    lines.push('');
  }

  lines.push('} // namespace functions');
  return lines.join('\n');
}
