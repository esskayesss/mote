const agendaStatusValue = {
  type: "string",
  enum: ["pending", "active", "partially_completed", "completed"]
} as const;

export const agendaArtifactSchema = {
  name: "agenda_artifact",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "kind",
      "locked",
      "generatedAt",
      "meetingTitle",
      "sourcePrompt",
      "meetingIntent",
      "summary",
      "points"
    ],
    properties: {
      kind: {
        type: "string",
        enum: ["agenda.v1"]
      },
      locked: {
        type: "boolean",
        enum: [true]
      },
      generatedAt: {
        type: "string"
      },
      meetingTitle: {
        type: "string"
      },
      sourcePrompt: {
        type: "array",
        items: { type: "string" }
      },
      meetingIntent: {
        type: "string"
      },
      summary: {
        type: "string"
      },
      points: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "id",
            "order",
            "title",
            "objective",
            "subtopics",
            "status",
            "talkingPoints",
            "successSignals",
            "estimatedDurationMinutes",
            "ownerHint",
            "dependencies",
            "tags"
          ],
          properties: {
            id: { type: "string" },
            order: { type: "number" },
            title: { type: "string" },
            status: {
              type: "string",
              enum: ["pending", "active", "completed"]
            },
            objective: { type: "string" },
            subtopics: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "order", "title", "status", "talkingPoints"],
                properties: {
                  id: { type: "string" },
                  order: { type: "number" },
                  title: { type: "string" },
                  status: {
                    type: "string",
                    enum: ["pending", "active", "completed"]
                  },
                  talkingPoints: {
                    type: "array",
                    items: { type: "string" }
                  }
                }
              }
            },
            talkingPoints: {
              type: "array",
              items: { type: "string" }
            },
            successSignals: {
              type: "array",
              items: { type: "string" }
            },
            estimatedDurationMinutes: { type: "number" },
            ownerHint: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            dependencies: {
              type: "array",
              items: { type: "string" }
            },
            tags: {
              type: "array",
              items: { type: "string" }
            }
          }
        }
      }
    }
  }
} as const;

export const agendaStatusEvaluationSchema = {
  name: "agenda_status_evaluation",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["activeTarget", "points"],
    properties: {
      activeTarget: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "id"],
            properties: {
              kind: {
                type: "string",
                enum: ["point", "subtopic"]
              },
              id: { type: "string" }
            }
          },
          {
            type: "null"
          }
        ]
      },
      points: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "status", "subtopics"],
          properties: {
            id: { type: "string" },
            status: agendaStatusValue,
            subtopics: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "status"],
                properties: {
                  id: { type: "string" },
                  status: agendaStatusValue
                }
              }
            }
          }
        }
      }
    }
  }
} as const;

export const factCheckSchema = {
  name: "fact_check_result",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "severity", "claim", "correction", "rationale"],
          properties: {
            id: { type: "string" },
            severity: {
              type: "string",
              enum: ["low", "medium", "high"]
            },
            claim: { type: "string" },
            correction: { type: "string" },
            rationale: { type: "string" }
          }
        }
      }
    }
  }
} as const;

export const factCheckAcknowledgementSchema = {
  name: "fact_check_acknowledgement",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["message"],
    properties: {
      message: {
        type: "string"
      }
    }
  }
} as const;
