/**
 * The AI returns plain text. We turn it into minimal, fully escaped HTML
 * (<p> paragraphs only) so it can be stored as Shopify `descriptionHtml`
 * without any risk of injecting markup.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

function unescapeHtml(html: string): string {
  return html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Splits on blank lines into paragraphs; single newlines become <br>. */
export function textToSafeHtml(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * Inverse of textToSafeHtml, for putting a stored suggestion back into an
 * editable text area. Only intended for HTML produced by textToSafeHtml.
 */
export function safeHtmlToText(html: string): string {
  return html
    .split(/<\/p>\s*/)
    .map((part) => part.replace(/^<p>/, ""))
    .filter(Boolean)
    .map((part) => unescapeHtml(part.replace(/<br>/g, "\n")))
    .join("\n\n");
}
