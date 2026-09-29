import {
  createSiteI18n,
  createTranslator,
  type Locale,
  type Translator,
} from "@jianyuelab-org/can-ui/i18n";
import enUs from "../../language/en-us.json";
import jaJp from "../../language/ja-jp.json";
import zhCn from "../../language/zh-cn.json";
import zhTw from "../../language/zh-tw.json";

export { createTranslator, type Locale, type Translator };
export const {
  LOCALES,
  DEFAULT_LOCALE,
  resolveLocale,
  getLocale,
  useTranslations,
  getMessages,
} = createSiteI18n({
  "zh-cn": zhCn,
  "zh-tw": zhTw,
  "en-us": enUs,
  "ja-jp": jaJp,
});
