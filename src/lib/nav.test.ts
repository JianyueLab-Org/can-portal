import { describe, expect, test } from "bun:test";
import { buildNavigation } from "./nav";

const t = (key: string) => key;
const groups = (rating?: number) =>
  buildNavigation(t, rating).map((item) => item.name);
const leaves = (rating?: number) =>
  buildNavigation(t, rating).flatMap(
    (item) => item.children?.map((child) => child.href) ?? [],
  );

describe("buildNavigation", () => {
  test("no rating, nothing", () => {
    expect(buildNavigation(t)).toEqual([]);
  });

  test("instructor sees the instructor group only", () => {
    expect(groups(8)).toEqual(["instructors.title"]);
    expect(leaves(8)).toEqual([
      "/instr/roster",
      "/instr/promote",
      "/instr/sweatbox",
    ]);
  });

  test("SUP adds the SUP group in spec order", () => {
    expect(groups(11)).toEqual(["instructors.title", "sup.title"]);
    expect(leaves(11).slice(3)).toEqual([
      "/super/activities",
      "/super/prizes",
      "/super/lottery",
      "/super/points",
      "/super/feedback",
      "/super/servers",
      "/super/promotions",
    ]);
  });

  test("ADM adds database and developer access", () => {
    expect(groups(12)).toEqual([
      "instructors.title",
      "sup.title",
      "admin.title",
    ]);
    expect(leaves(12).slice(-2)).toEqual([
      "/super/aip-access",
      "/super/developers",
    ]);
  });

  test("every item is a group with no href", () => {
    for (const item of buildNavigation(t, 12)) {
      expect(item.href).toBeUndefined();
      expect(item.children?.length).toBeGreaterThan(0);
    }
  });
});
