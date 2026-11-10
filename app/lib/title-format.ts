/**
 * The merchant's title format: a pattern of fixed placeholders and literal
 * separators, e.g. "{Brand} {Product type} – {Key detail}", plus a length limit.
 * The AI fills the pattern from product facts; the merchant reviews the result.
 */

export const TITLE_PLACEHOLDERS = [
  "Brand",
  "Product name",
  "Product type",
  "Key detail",
] as const;
export type TitlePlaceholder = (typeof TITLE_PLACEHOLDERS)[number];

/** What each placeholder means, shown in settings and given to the AI. */
export const PLACEHOLDER_HELP: Record<TitlePlaceholder, string> = {
  Brand: "The product's vendor.",
  "Product name":
    "The product's own name from its current title, without the brand, type, or promotional words.",
  "Product type": "The product type set in Shopify.",
  "Key detail":
    "The most useful distinguishing fact the product data states, such as a material, colour, or size range.",
};

export const DEFAULT_TITLE_TEMPLATE = "{Brand} {Product name} – {Key detail}";
export const DEFAULT_TITLE_MAX_LENGTH = 70;
export const MIN_TITLE_MAX_LENGTH = 20;
/** Shopify's limit for product titles. */
export const SHOPIFY_TITLE_MAX_LENGTH = 255;
export const MAX_TEMPLATE_LENGTH = 150;

export interface TitleFormat {
  template: string;
  maxLength: number;
}

const PLACEHOLDER_PATTERN = /\{([^{}]*)\}/g;

/** Placeholders in the order they appear in the template. */
export function templatePlaceholders(template: string): TitlePlaceholder[] {
  return [...template.matchAll(PLACEHOLDER_PATTERN)]
    .map((match) => canonicalPlaceholder(match[1]))
    .filter((name): name is TitlePlaceholder => name !== null);
}

function canonicalPlaceholder(name: string): TitlePlaceholder | null {
  const wanted = name.trim().toLowerCase().replace(/\s+/g, " ");
  return TITLE_PLACEHOLDERS.find((p) => p.toLowerCase() === wanted) ?? null;
}

export type TitleFormatResult =
  | { ok: true; format: TitleFormat }
  | { ok: false; errors: { template?: string; maxLength?: string } };

/**
 * Validates the settings form. Placeholder names are matched without regard to
 * case or spacing and rewritten in their standard form.
 */
export function parseTitleFormat(
  templateInput: unknown,
  maxLengthInput: unknown,
): TitleFormatResult {
  const errors: { template?: string; maxLength?: string } = {};

  const raw = String(templateInput ?? "").trim();
  let template = raw;
  if (!raw) {
    errors.template = "Enter a title format.";
  } else if (raw.length > MAX_TEMPLATE_LENGTH) {
    errors.template = `Keep the format under ${MAX_TEMPLATE_LENGTH} characters.`;
  } else if (/[\n\r\t<>]/.test(raw)) {
    errors.template = "The format can't contain line breaks or < and > characters.";
  } else if (/[{}]/.test(raw.replace(PLACEHOLDER_PATTERN, ""))) {
    errors.template = "Every { needs a matching }.";
  } else {
    const seen = new Set<TitlePlaceholder>();
    template = raw.replace(PLACEHOLDER_PATTERN, (whole, name: string) => {
      const placeholder = canonicalPlaceholder(name);
      if (!placeholder) {
        errors.template ??= `"${whole}" isn't a placeholder. Use ${TITLE_PLACEHOLDERS.map((p) => `{${p}}`).join(", ")}.`;
        return whole;
      }
      if (seen.has(placeholder)) {
        errors.template ??= `{${placeholder}} appears more than once.`;
      }
      seen.add(placeholder);
      return `{${placeholder}}`;
    });
    if (!errors.template && seen.size === 0) {
      errors.template = "Use at least one placeholder, such as {Product name}.";
    }
  }

  const maxLength = Number(maxLengthInput);
  if (
    !Number.isInteger(maxLength) ||
    maxLength < MIN_TITLE_MAX_LENGTH ||
    maxLength > SHOPIFY_TITLE_MAX_LENGTH
  ) {
    errors.maxLength = `Enter a whole number from ${MIN_TITLE_MAX_LENGTH} to ${SHOPIFY_TITLE_MAX_LENGTH}.`;
  }

  return errors.template || errors.maxLength
    ? { ok: false, errors }
    : { ok: true, format: { template, maxLength } };
}

// Separator characters that are dropped when the placeholder next to them is empty.
const SEPARATOR = "[\\s\\-–—|,:/·]";

/**
 * Fills the template. Placeholders without a value are removed together with
 * the separator that joined them, so "{Brand} – {Key detail}" with no key
 * detail gives "Acme", not "Acme –".
 */
export function fillTitleTemplate(
  template: string,
  values: Partial<Record<TitlePlaceholder, string>>,
): string {
  // Mark empty placeholders, then strip each mark with the separators around it.
  const EMPTY = "\u0000";
  const marked = template.replace(PLACEHOLDER_PATTERN, (whole, name: string) => {
    const placeholder = canonicalPlaceholder(name);
    const value = placeholder ? values[placeholder]?.trim() : undefined;
    return value ? value : EMPTY;
  });
  return marked
    .replace(
      new RegExp(`${SEPARATOR}*${EMPTY}(?:${SEPARATOR}*${EMPTY})*(${SEPARATOR}*)`, "g"),
      (match, following: string, offset: number, whole: string) => {
        const atStart = offset === 0;
        const atEnd = offset + match.length === whole.length;
        // In the middle, keep the separator that led into the next value.
        return atStart || atEnd ? "" : following || " ";
      },
    )
    .replace(/\s+/g, " ")
    .replace(new RegExp(`^${SEPARATOR}+|${SEPARATOR}+$`, "g"), "")
    .trim();
}

/** A sample title for the settings preview. */
export function exampleTitle(template: string): string {
  return fillTitleTemplate(template, {
    Brand: "Acme",
    "Product name": "Summit",
    "Product type": "Heated Jacket",
    "Key detail": "Black, Sizes S–XL",
  });
}

interface TitleFacts {
  vendor: string;
  productType: string;
}

/**
 * Deterministic checks that a suggested title follows the format. They only
 * look for facts the template asks for; they can't judge wording.
 */
export function checkTitleFormat(
  title: string,
  format: TitleFormat,
  facts: TitleFacts,
): string[] {
  const warnings: string[] = [];
  const lower = title.toLowerCase();
  const placeholders = templatePlaceholders(format.template);

  const expected: [TitlePlaceholder, string][] = [
    ["Brand", facts.vendor.trim()],
    ["Product type", facts.productType.trim()],
  ];
  for (const [placeholder, value] of expected) {
    if (placeholders.includes(placeholder) && value && !lower.includes(value.toLowerCase())) {
      warnings.push(
        `The suggested title doesn't include the ${placeholder.toLowerCase()} ("${value}") that your title format asks for.`,
      );
    }
  }

  const letters = title.replace(/[^\p{L}]/gu, "");
  if (letters.length >= 6 && letters === letters.toUpperCase()) {
    warnings.push("The suggested title is in capital letters. Check that this matches your other titles.");
  }
  return warnings;
}
