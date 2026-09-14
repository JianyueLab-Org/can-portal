/**
 * `toStack` 的翻译规则。
 *
 * 这一层会**静默**出错：一场活动开在一个不存在的呼号上、或者同一个呼号开了两次，
 * 界面上都不会说什么，要到活动当天才发现没人连得上。所以三处判断各钉一条。
 *
 * 造的数据照着线上的形状：RJTT 的塔台三行三个频率是真的，桃园的区调全姓 TPE 也是
 * 真的（can-db 的 `AirportPositions` 文档里有同一批例子）。
 */
import { describe, expect, test } from "bun:test";
import { toStack, type DbAirportPosition } from "@/server/positionStack";

function row(p: Partial<DbAirportPosition>): DbAirportPosition {
  return {
    callsign: "ZBAA_TWR",
    freqMhz: 118.5,
    identifier: null,
    facility: "TWR",
    source: "chain",
    rank: 0,
    primary: false,
    ...p,
  };
}

function stack(positions: DbAirportPosition[], icao = "ZBAA") {
  return toStack({ icao, hasChain: true, hasEnroute: true, positions }, icao);
}

describe("toStack", () => {
  test("DEP 并进进近那一格，呼号原样保留", () => {
    const got = stack([
      row({ callsign: "RJTT_APP", facility: "APP", primary: true }),
      row({ callsign: "RJTT_DEP", facility: "DEP", primary: true }),
    ]);
    expect(got.seats.map((s) => [s.facility, s.callsign])).toEqual([
      [5, "RJTT_APP"],
      [5, "RJTT_DEP"],
    ]);
    // 两个都默认勾上：它们在 can-db 那边是两层，一场有离场席位的活动两个都要开。
    expect(got.seats.every((s) => s.primary)).toBe(true);
  });

  test("同一呼号的多个频率合成一行，第一个是默认", () => {
    const got = stack([
      row({ callsign: "RJTT_TWR", freqMhz: 124.35, primary: true }),
      row({ callsign: "RJTT_TWR", freqMhz: 118.8 }),
      row({ callsign: "RJTT_TWR", freqMhz: 118.1 }),
    ]);
    // 一场活动里一个呼号只能开一次（activityPosition 上的 unique），三行全开会是
    // 一个成功两个 409。
    expect(got.seats).toHaveLength(1);
    expect(got.seats[0].frequencies).toEqual(["124.350", "118.800", "118.100"]);
    expect(got.seats[0].primary).toBe(true);
  });

  test("频率补足三位小数，没有频率是空数组不是 0", () => {
    const got = stack([
      row({ callsign: "ZBAA_TWR", freqMhz: 118.5 }),
      row({ callsign: "ZBAA_W_TWR", freqMhz: null }),
    ]);
    expect(got.seats[0].frequencies).toEqual(["118.500"]);
    // 0 会被当成一个合法频率填进去；空数组在界面上是一个破折号。
    expect(got.seats[1].frequencies).toEqual([]);
  });

  test("呼号不姓这个机场时标出来", () => {
    const got = stack(
      [
        row({ callsign: "RCTP_A_APP", facility: "APP" }),
        row({ callsign: "RCKH_F_APP", facility: "APP" }),
        row({ callsign: "TPE_C_CTR", facility: "CTR" }),
      ],
      "RCTP",
    );
    expect(got.seats.map((s) => [s.callsign, s.own])).toEqual([
      ["RCTP_A_APP", true],
      ["RCKH_F_APP", false],
      ["TPE_C_CTR", false],
    ]);
  });

  test("不认识的 facility 整行丢掉，不兜底成某一层", () => {
    // can-db 今天只返回那六层。多出来一种意味着上游加了新席位类型，那时该有人来决
    // 定它归哪一格 —— 悄悄变成进近是最坏的结果。
    const got = stack([
      row({ callsign: "ZBAA_ATIS", facility: "ATIS" }),
      row({ callsign: "ZBAA_TWR", facility: "TWR" }),
    ]);
    expect(got.seats.map((s) => s.callsign)).toEqual(["ZBAA_TWR"]);
  });

  test("最低等级按席位类型给默认值", () => {
    const got = stack([
      row({ callsign: "ZBAA_DEL", facility: "DEL" }),
      row({ callsign: "ZBAA_TWR", facility: "TWR" }),
      row({ callsign: "ZBAA_CTR", facility: "CTR" }),
    ]);
    expect(got.seats.map((s) => s.minRating)).toEqual([2, 3, 5]);
  });

  test("hasChain / hasEnroute 原样带过来", () => {
    const got = toStack(
      { icao: "RJTT", hasChain: false, hasEnroute: false, positions: [] },
      "RJTT",
    );
    expect(got).toEqual({
      icao: "RJTT",
      hasChain: false,
      hasEnroute: false,
      seats: [],
    });
  });
});
