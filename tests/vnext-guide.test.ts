import { expect, it } from "vitest";
import {
  findScenarios,
  guideScenarios,
  scenarioPrompt,
  skillIds,
} from "../src/shared/vnext-guide.js";

it("covers all eleven canonical vNext skills with unique scenarios and explicit boundaries", () => {
  expect(new Set(guideScenarios.map((scenario) => scenario.id)).size).toBe(
    guideScenarios.length,
  );
  expect(
    [...new Set(guideScenarios.map((scenario) => scenario.skill))].sort(),
  ).toEqual([...skillIds].sort());
  for (const scenario of guideScenarios) {
    expect(scenarioPrompt(scenario)).toBe(
      `$${scenario.skill} ${scenario.request}`,
    );
    expect(scenario.result.length).toBeGreaterThan(10);
    expect(scenario.boundary.length).toBeGreaterThan(10);
  }
});

it("combines case-insensitive search terms with category filters and handles no results", () => {
  expect(
    findScenarios("EXECUTE-STEP finish", "交付与提交").map(
      (scenario) => scenario.id,
    ),
  ).toEqual(["finish"]);
  expect(findScenarios("  ", "")).toEqual(guideScenarios);
  expect(findScenarios("readonly-unmatched-query", "")).toEqual([]);
  expect(findScenarios("commit", "暂停与恢复")).toEqual([]);
  expect(
    findScenarios("原始需求", "").some(
      (scenario) => scenario.id === "documents",
    ),
  ).toBe(true);
});
