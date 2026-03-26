import { afterEach, describe, expect, it } from "bun:test";
import type { AgendaArtifact } from "@mote/models";
import { MeetingMonitoringRuntime } from "./runtime";

const waitFor = async (predicate: () => boolean, timeoutMs = 2_000) => {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for predicate.");
    }

    await Bun.sleep(10);
  }
};

const agendaArtifact: AgendaArtifact = {
  kind: "agenda.v1",
  locked: true,
  generatedAt: "2026-03-26T00:00:00.000Z",
  meetingTitle: "Python File I/O",
  sourcePrompt: ["Python File I/O"],
  meetingIntent: "Teach file handling.",
  summary: "A small lecture agenda.",
  points: [
    {
      id: "P1",
      order: 1,
      title: "Introduction",
      objective: "Set context.",
      status: "active",
      subtopics: [
        {
          id: "P1S1",
          order: 1,
          title: "Scope",
          status: "active",
          talkingPoints: ["Define the scope."]
        }
      ],
      talkingPoints: ["What file I/O is"],
      successSignals: ["Scope is clear"],
      estimatedDurationMinutes: 5,
      ownerHint: null,
      dependencies: [],
      tags: ["intro"]
    }
  ]
};

const roomPayload = {
  room: {
    id: "room-1",
    code: "room-code",
    capacity: 8,
    createdAt: "2026-03-26T00:00:00.000Z",
    meetingTitle: "Python File I/O",
    agenda: ["Introduction"],
    agendaArtifact,
    transcriptionProvider: "openai",
    transcriptionModel: "whisper-1",
    policy: {
      endMeetingOnHostExit: true
    },
    participants: [
      {
        id: "host-1",
        displayName: "Host",
        role: "host",
        authorityRole: "host",
        isPresenter: true,
        mediaCapabilities: {
          publishAudio: true,
          publishVideo: true,
          publishScreen: true,
          subscribeAudio: true,
          subscribeVideo: true,
          subscribeScreen: true
        },
        joinedAt: "2026-03-26T00:00:00.000Z"
      }
    ]
  }
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("MeetingMonitoringRuntime", () => {
  it("re-runs a room evaluation if new transcript arrives during an in-flight run", async () => {
    let agendaCallCount = 0;
    let releaseFirstEvaluation: (() => void) | null = null;

    globalThis.fetch = (async () =>
      new Response(JSON.stringify(roomPayload), {
        status: 200,
        headers: { "content-type": "application/json" }
      })) as unknown as typeof fetch;

    const runtime = new MeetingMonitoringRuntime(
      "http://backend.local",
      {
        publishAgendaStatusPatch: async () => undefined,
        publishFactCheckEvent: async () => undefined,
        publishChatMessage: async () => undefined
      } as never,
      {
        evaluateAgendaStatuses: async () => {
          agendaCallCount += 1;

          if (agendaCallCount === 1) {
            await new Promise<void>((resolve) => {
              releaseFirstEvaluation = resolve;
            });
          }

          return {
            activeTarget: { kind: "point" as const, id: "P1" },
            points: [
              {
                id: "P1",
                status: "active" as const,
                subtopics: [{ id: "P1S1", status: "active" as const }]
              }
            ]
          };
        },
        evaluateFactChecks: async () => [],
        refineAgenda: async () => agendaArtifact,
        formatFactCheckAcknowledgement: async () => "ack",
        isConfigured: () => true,
        getModels: () => ({
          agendaRefinement: "gpt-5-nano",
          agendaStatus: "gpt-5-nano",
          factCheck: "gpt-5-nano",
          factCheckAcknowledgement: "gpt-4.1-nano"
        })
      } as never
    );

    runtime.observeFinalTranscript("room-1", "room-code", "host-1", "First transcript turn.");
    await waitFor(() => agendaCallCount === 1);
    expect(releaseFirstEvaluation).not.toBeNull();
    if (!releaseFirstEvaluation) {
      throw new Error("Expected the first evaluation to be blocked.");
    }
    const release = releaseFirstEvaluation as unknown as () => void;

    runtime.observeFinalTranscript("room-1", "room-code", "host-1", "Second transcript turn.");
    release();

    await waitFor(() => agendaCallCount === 2);
    expect(agendaCallCount).toBe(2);
  });
});
