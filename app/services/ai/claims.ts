import type { ProductFacts } from "./types";

/**
 * Claim words that shoppers rely on and that models tend to add on their own.
 * A heuristic, not a fact checker: it only catches these specific words, and
 * only when the product facts don't contain them.
 */
const CLAIM_TERMS: { label: string; pattern: RegExp }[] = [
  {
    label: "waterproof",
    pattern: /\bwater[- ]?(proof|resistant|repellent)\b/i,
  },
  {
    label: "durable",
    pattern: /\b(durable|durability|sturdy|long[- ]lasting|built to last)\b/i,
  },
  {
    label: "high quality",
    pattern: /\b(high[- ]quality|premium|top[- ]quality)\b/i,
  },
  {
    label: "warranty or guarantee",
    pattern: /\b(warrant(y|ies|ied)|guarantee[ds]?|lifetime)\b/i,
  },
  {
    label: "certified",
    pattern: /\b(certified|certification|approved by|fda)\b/i,
  },
  {
    label: "organic or eco-friendly",
    pattern:
      /\b(organic|eco[- ]friendly|sustainabl[ey]|biodegradable|recycled)\b/i,
  },
  {
    label: "health or safety",
    pattern:
      /\b(hypoallergenic|non[- ]toxic|bpa[- ]free|clinically|dermatologist|safe for)\b/i,
  },
  {
    label: "dietary",
    pattern: /\b(vegan|gluten[- ]free|dairy[- ]free|sugar[- ]free|keto)\b/i,
  },
  { label: "handmade", pattern: /\b(hand[- ]?made|handcrafted)\b/i },
  {
    label: "all-season",
    pattern: /\b(all[- ]season|any season|year[- ]round|all[- ]weather)\b/i,
  },
  {
    label: "suitability",
    pattern:
      /\b(suitable for|ideal for|great for|designed for|everyday (use|wear)|casual wear)\b/i,
  },
  {
    label: "superlative",
    pattern: /\b(best|perfect|ultimate|world[- ]class|unbeatable)\b/i,
  },
];

function factsText(facts: ProductFacts): string {
  return [
    facts.title,
    facts.currentDescription,
    facts.productType,
    facts.vendor,
    ...facts.tags,
    ...facts.options.flatMap((option) => [option.name, ...option.values]),
  ].join("\n");
}

/** Claim labels that appear in the text but nowhere in the facts. */
export function findUnsupportedClaims(
  text: string,
  facts: ProductFacts,
): string[] {
  const source = factsText(facts);
  return CLAIM_TERMS.filter(
    ({ pattern }) => pattern.test(text) && !pattern.test(source),
  ).map(({ label }) => label);
}
