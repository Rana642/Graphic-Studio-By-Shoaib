/** Escapes text for safe interpolation into SVG `<text>` content/attributes —
 *  field values are user input, not trusted markup. */
export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
