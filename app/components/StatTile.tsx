type Tone = "critical" | "warning" | "success" | "neutral";
type Icon =
  | "alert-circle"
  | "hashtag"
  | "check-circle"
  | "product"
  | "x-circle"
  | "clock";

// Fixed size so the tiles stay square and line up in a row.
const TILE_SIZE = "128px";

/**
 * A square tile with an icon, a number, and a label. Used for summary rows on
 * the dashboard and history pages. With onClick it acts as a filter button.
 */
export function StatTile({
  label,
  value,
  tone,
  icon,
  selected = false,
  onClick,
}: {
  label: string;
  value: string;
  tone: Tone;
  icon: Icon;
  selected?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <s-stack
      direction="block"
      justifyContent="space-between"
      blockSize="100%"
      gap="small-300"
    >
      <s-icon type={icon} tone={tone === "neutral" ? "auto" : tone} />
      <s-stack direction="block" gap="small-500">
        <s-heading>{value}</s-heading>
        <s-text color="subdued">{label}</s-text>
      </s-stack>
    </s-stack>
  );

  const box = {
    inlineSize: TILE_SIZE,
    blockSize: TILE_SIZE,
    padding: "base",
    borderRadius: "large",
    background: selected ? "subdued" : "base",
    border: selected ? "large strong" : "base",
  } as const;

  return onClick ? (
    <s-clickable
      {...box}
      onClick={onClick}
      accessibilityLabel={`${label}: ${value}. Show these products.`}
    >
      {content}
    </s-clickable>
  ) : (
    <s-box {...box}>{content}</s-box>
  );
}
