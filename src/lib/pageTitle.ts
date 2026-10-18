/**
 * 页面标题：`<页面> · <站名>`。站名是 can-ui 的 `siteLabel`。首页只有站名。
 */
import { siteLabel } from "@jianyuelab-org/can-ui/sites";

export function pageTitle(page: string | undefined, locale: string): string {
  const site = siteLabel(locale, "portal").name;
  return page ? `${page} · ${site}` : site;
}
