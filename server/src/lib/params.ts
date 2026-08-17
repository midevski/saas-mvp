// Express types route params as `string | string[]` (repeated param edge case);
// our routes only ever declare single simple params, so this just narrows that back down.
export function paramAsString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}
