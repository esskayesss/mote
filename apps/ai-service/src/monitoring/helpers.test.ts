import { describe, expect, it } from "bun:test";
import {
  formatMonitorSummary,
  isActionableFactCheck,
  isFactCheckGroundedInTranscript
} from "./helpers";

describe("isFactCheckGroundedInTranscript", () => {
  it("accepts clearly grounded fact checks", () => {
    expect(
      isFactCheckGroundedInTranscript(
        {
          id: "fc1",
          severity: "high",
          claim: "The sun rises in the west and sets in the east.",
          correction: "The sun rises in the east and sets in the west.",
          rationale: "Basic astronomy."
        },
        "2026-03-26T00:00:00.000Z Host: The sun rises in the west and sets in the east."
      )
    ).toBe(true);
  });

  it("rejects ghost fact checks that are not supported by transcript text", () => {
    expect(
      isFactCheckGroundedInTranscript(
        {
          id: "fc2",
          severity: "high",
          claim: "Python cannot do file operations.",
          correction: "Python supports file I/O.",
          rationale: "Python has file handling."
        },
        "2026-03-26T00:00:00.000Z Host: Python is slower than C++ for many workloads."
      )
    ).toBe(false);
  });

  it("rejects no-op fact checks", () => {
    expect(
      isActionableFactCheck({
        id: "fc3",
        severity: "low",
        claim: "Text and binary handling are different.",
        correction: "No correction needed.",
        rationale: "No factual error detected in that claim."
      })
    ).toBe(false);
  });
});

describe("formatMonitorSummary", () => {
  it("stays under the backend chat limit", () => {
    const summary = formatMonitorSummary({
      agendaArtifact: null,
      activeTarget: null,
      patch: null,
      transcriptTurnCount: 42,
      returnedFactCheckCount: 3,
      groundedFactCheckCount: 2,
      publishedFactCheckCount: 1,
      lastTranscriptLine: "x".repeat(1_000),
      evaluationInput: {
        agendaFocus: ["a".repeat(1_000)],
        factCheckFocus: ["b".repeat(1_000)]
      },
      agendaEvaluation: {
        points: [{ id: "P1", status: "active", subtopics: [{ id: "P1S1", status: "active" }] }]
      },
      factCheckEvaluation: [
        {
          id: "fc1",
          severity: "high",
          claim: "c".repeat(600),
          correction: "d".repeat(600),
          rationale: "e".repeat(600)
        }
      ]
    });

    expect(summary.length).toBeLessThanOrEqual(1_900);
  });
});
