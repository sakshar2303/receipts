/**
 * Escapes text for HTML. "://" is written as "&#58;//" so a URL quoted from a
 * transcript can never look like, or become, a request the page makes.
 */
export function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/:\/\//g, "&#58;//");
}

/**
 * JSON that is safe inside a <script> element: "<" cannot close the element,
 * and "/" is escaped so no "http://" appears in the page source. Both are
 * valid JSON escapes, so JSON.parse reads the original back.
 */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\//g, "\\/")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
