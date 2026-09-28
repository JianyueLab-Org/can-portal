/**
 * `procedureTrack`：一条程序的点列是几组转换首尾相接，这里拼回一条跑道的一条航迹。
 *
 * 造的数据照着 can-db `procedure_transition_test.go` 里的形状 —— ZGGG AGVIL7 那种一行
 * 四组、跑道转换排在公共段前面的 SID，和带航路转换的 STAR。
 */
import { describe, expect, test } from "bun:test";
import { procedureTrack } from "@/server/sweatboxData";

const leg = (ident: string, transition: string | null) => ({
  ident,
  transition,
});

describe("procedureTrack", () => {
  test("a SID keeps only its own runway's transition and the common route", () => {
    const path = [
      leg("RW01R", "RW19L"),
      leg("GG571", "RW19L"),
      leg("AGVIL", "RW19L"),
      leg("RW01L", "RW19R"),
      leg("GG572", "RW19R"),
      leg("RW03", "RW21"),
      leg("GG584", "RW21"),
      leg("GG585", "ALL"),
      leg("AGVIL", "ALL"),
    ];
    const points = path.map((p) => p.ident);
    expect(procedureTrack("sid", "21", points, path)).toEqual({
      points: ["RW03", "GG584", "GG585", "AGVIL"],
      gate: "AGVIL",
    });
  });

  test("a STAR enters on its transition's first point, not points[0]", () => {
    const path = [
      leg("PIMOL", "PIMOL"),
      leg("NOBEM", "PIMOL"),
      leg("NOBEM", "ALL"),
      leg("GG201", "ALL"),
      leg("GG201", "RW02"),
      leg("RW02", "RW02"),
      leg("GG301", "RW20"),
      leg("RW20", "RW20"),
    ];
    const points = path.map((p) => p.ident);
    expect(procedureTrack("star", "02", points, path)).toEqual({
      points: ["PIMOL", "NOBEM", "GG201", "RW02"],
      gate: "PIMOL",
    });
  });

  test("a procedure without transitions is left as it was", () => {
    const points = ["RW02", "GG301", "ELKAL"];
    expect(procedureTrack("sid", "02", points)).toEqual({
      points,
      gate: "ELKAL",
    });
    expect(procedureTrack("star", "02", points)).toEqual({
      points,
      gate: "RW02",
    });
  });
});
