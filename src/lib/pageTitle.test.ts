import { expect, test } from "bun:test";
import { pageTitle } from "./pageTitle";

test("page · site, localised", () => {
  expect(pageTitle("Roster", "en-us")).toBe("Roster · Staff Portal");
  expect(pageTitle("花名册", "zh-cn")).toBe("花名册 · 教员与管理门户");
  expect(pageTitle("花名冊", "zh-tw")).toBe("花名冊 · 教員與管理入口");
});

test("no page, site alone", () => {
  expect(pageTitle(undefined, "ja-jp")).toBe("教官・管理ポータル");
});
