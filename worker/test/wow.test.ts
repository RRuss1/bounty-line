import { describe, expect, it } from "vitest";
import { className, level, raceName, zoneName } from "../src/wow";

describe("game names", () => {
  it("knows Forever's Skyborne races, one per faction", () => {
    expect(raceName(95)).toBe("High Order Skyborne");
    expect(raceName(96)).toBe("Windshaper Skyborne");
  });
  it("falls back to the number for anything unknown", () => {
    expect(raceName(999)).toBe("Race #999");
    expect(className(99)).toBe("Class #99");
    expect(zoneName(99999)).toBeNull();
  });
  it("names zones and ?? levels", () => {
    expect(zoneName(1437)).toBe("Wetlands");
    expect(level(0)).toBe("??");
    expect(level(42)).toBe("42");
  });
});
