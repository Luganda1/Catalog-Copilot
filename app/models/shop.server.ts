import db from "../db.server";

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
