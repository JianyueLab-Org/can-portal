import { useTranslations, type Locale } from "@/lib/i18n";

/**
 * can-ui 的 `Dialog`（右上角 ×）和可关闭的 `AlertBox` 自己画按钮，按钮的无障碍名称从
 * 它们的 `messages` prop 里读 `close` / `dismiss`，读不到就是英文的 "Close" /
 * "Dismiss"。岛屿拿到的是本页的命名空间，没有这两条。
 *
 * 只从 `frame` 切这两条传进去，不把整本外壳词典再序列化进每个岛屿。
 */
export function chromeMessages(locale: Locale): Record<string, string> {
  const tf = useTranslations(locale, "frame");
  return { close: tf("close"), dismiss: tf("dismiss") };
}
