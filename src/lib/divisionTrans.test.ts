import { describe, expect, test } from "bun:test";
import { divisionTrans } from "./tools";

describe("divisionTrans", () => {
  test("region 4 is HKG", () => {
    expect(divisionTrans(4)).toBe("HKG");
    expect(divisionTrans("4", "zh-cn")).toBe("HKG");
  });

  test("region 5 is TWN under zh-cn and ROC elsewhere", () => {
    expect(divisionTrans(5, "zh-cn")).toBe("TWN");
    for (const locale of ["zh-tw", "en-us", "ja-jp"]) {
      expect(divisionTrans(5, locale)).toBe("ROC");
    }
    expect(divisionTrans("5")).toBe("ROC");
  });

  test("unknown region", () => {
    expect(divisionTrans(9, "zh-cn")).toBe("Unknown");
  });
});
