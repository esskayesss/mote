import { describe, expect, it } from "bun:test";
import type { AgendaArtifact, AgendaStatusPatch } from "@mote/models";
import { applyHeuristicAgendaProgress, normalizeAgendaPatch } from "./agenda";

const agendaArtifact: AgendaArtifact = {
  kind: "agenda.v1",
  locked: true,
  generatedAt: "2026-03-26T00:00:00.000Z",
  meetingTitle: "Python File I/O",
  sourcePrompt: ["Python File I/O"],
  meetingIntent: "Teach file handling.",
  summary: "A focused lecture agenda.",
  points: [
    {
      id: "P1",
      order: 1,
      title: "Read files safely",
      objective: "Teach file reading patterns.",
      status: "completed",
      talkingPoints: ["open a file", "read bytes"],
      successSignals: ["Students can read a file"],
      estimatedDurationMinutes: 8,
      ownerHint: null,
      dependencies: [],
      tags: ["files"],
      subtopics: [
        {
          id: "P1S1",
          order: 1,
          title: "Open and close files",
          status: "completed",
          talkingPoints: ["open a file", "close the handle"]
        }
      ]
    },
    {
      id: "P2",
      order: 2,
      title: "Handle encodings",
      objective: "Teach text decoding pitfalls.",
      status: "pending",
      talkingPoints: ["decode text", "pick the right encoding"],
      successSignals: ["Students can explain encoding errors"],
      estimatedDurationMinutes: 8,
      ownerHint: null,
      dependencies: [],
      tags: ["encoding"],
      subtopics: [
        {
          id: "P2S1",
          order: 1,
          title: "Unicode decode errors",
          status: "pending",
          talkingPoints: ["decode text", "pick the right encoding"]
        }
      ]
    }
  ]
};

describe("agenda heuristics", () => {
  it("keeps completed items completed even if the model later tries to reactivate them", () => {
    const patch = normalizeAgendaPatch(agendaArtifact, {
      activeTarget: { kind: "subtopic", id: "P1S1" },
      points: [
        {
          id: "P1",
          status: "active",
          subtopics: [{ id: "P1S1", status: "active" }]
        },
        {
          id: "P2",
          status: "pending",
          subtopics: [{ id: "P2S1", status: "pending" }]
        }
      ]
    });

    expect(patch.points[0]?.status).toBe("completed");
    expect(patch.points[0]?.subtopics[0]?.status).toBe("completed");
  });

  it("marks a topic and subtopic completed once its talking points are repeatedly covered", () => {
    const patch: AgendaStatusPatch = {
      points: agendaArtifact.points.map((point) => ({
        id: point.id,
        status: point.status ?? "pending",
        subtopics: point.subtopics.map((subtopic) => ({
          id: subtopic.id,
          status: subtopic.status ?? "pending"
        }))
      }))
    };

    const updated = applyHeuristicAgendaProgress(agendaArtifact, patch, [
      "2026-03-26T00:00:10.000Z Host: First we decode text with the right encoding.",
      "2026-03-26T00:00:14.000Z Host: If you do not pick the right encoding, decode text fails.",
      "2026-03-26T00:00:18.000Z Host: The key is to pick the right encoding before you decode text."
    ]);

    const point = updated.points.find((entry) => entry.id === "P2");
    const subtopic = point?.subtopics.find((entry) => entry.id === "P2S1");

    expect(point?.status).toBe("completed");
    expect(subtopic?.status).toBe("completed");
  });
});
