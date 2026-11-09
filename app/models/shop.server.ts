import db from "../db.server";
import type { TitleFormat } from "../lib/title-format";

/**
 * Returns the Shop row for an authenticated shop domain, creating it on first use.
 *
 * Always pass `session.shop` from `authenticate.admin(request)` — never a value
 * from the request body or URL — so a merchant can only ever resolve their own shop.
 * Reaching this code means the app is installed, so any uninstall marker is cleared.
 */
export async function getOrCreateShop(domain: string) {
  return db.shop.upsert({
    where: { domain },
    create: { domain },
    update: { uninstalledAt: null },
  });
}

/** The shop's title format, or null when title suggestions are off. */
export function titleFormatOf(shop: {
  titleTemplate: string | null;
  titleMaxLength: number;
}): TitleFormat | null {
  return shop.titleTemplate
    ? { template: shop.titleTemplate, maxLength: shop.titleMaxLength }
    : null;
}

/** Saves a validated title format; null turns title suggestions off. */
export async function saveTitleFormat(shopId: string, format: TitleFormat | null) {
  return db.shop.update({
    where: { id: shopId },
    data: format
      ? { titleTemplate: format.template, titleMaxLength: format.maxLength }
      : { titleTemplate: null },
  });
}
