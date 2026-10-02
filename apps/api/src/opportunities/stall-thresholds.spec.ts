import { formatDuration, loadStallThresholds, stallCheckpointsMs } from "./stall-thresholds";

const originalEnv = { ...process.env };

describe("stall thresholds", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("defaults to the original M2A values (1h / 4h)", () => {
    delete process.env.OPPORTUNITY_STALL_MEDIUM_MINUTES;
    delete process.env.OPPORTUNITY_STALL_HIGH_MINUTES;
    expect(loadStallThresholds()).toEqual({ mediumMs: 3_600_000, highMs: 14_400_000 });
    expect(stallCheckpointsMs()).toEqual([3_600_000, 14_400_000]);
  });

  it("reads minutes from env", () => {
    process.env.OPPORTUNITY_STALL_MEDIUM_MINUTES = "1";
    process.env.OPPORTUNITY_STALL_HIGH_MINUTES = "2";
    expect(stallCheckpointsMs()).toEqual([60_000, 120_000]);
  });

  it("rejects invalid or inverted values", () => {
    process.env.OPPORTUNITY_STALL_MEDIUM_MINUTES = "soon";
    expect(() => loadStallThresholds()).toThrow(/OPPORTUNITY_STALL_MEDIUM_MINUTES/);
    process.env.OPPORTUNITY_STALL_MEDIUM_MINUTES = "30";
    process.env.OPPORTUNITY_STALL_HIGH_MINUTES = "30";
    expect(() => loadStallThresholds()).toThrow(/must be greater/);
  });

  it("formats durations like the original reason strings", () => {
    expect(formatDuration(14_400_000)).toBe("4h");
    expect(formatDuration(90 * 60_000)).toBe("90 min");
  });
});
