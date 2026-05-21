import { describe, expect, it } from "vitest";

describe("integration test harness", () => {
  it("is available for later API and runner tests", () => {
    expect("local-safe").toBe("local-safe");
  });
});
