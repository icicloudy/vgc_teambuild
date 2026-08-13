/** User-facing string helpers. Copy is part of the product, so it gets a home. */

/** `plural(1, 'move')` -> "1 move"; `plural(3, 'move')` -> "3 moves". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Sentence-case list: ["a","b","c"] -> "a, b and c". */
export function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
