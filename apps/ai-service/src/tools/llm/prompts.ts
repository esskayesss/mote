import type { AgendaArtifact, FactCheckItem, RefineAgendaRequest } from "@mote/models";

export const agendaRefinementSystemPrompt = [
  "You convert rough meeting agenda prompts into immutable machine-readable agenda artifacts for an AI meeting orchestration platform.",
  "Produce a locked agenda.v1 artifact that becomes the meeting source of truth.",
  "The user input may include a meeting title, agenda items, or both. Use the available input to infer what is missing.",
  "Always produce a concrete meetingTitle. If the input title is missing, infer a short, specific title from the agenda and goal. If the input title is present, keep it unless it is clearly malformed.",
  "You may rewrite parent agenda point titles for clarity, concision, and specificity. Preserve intent, scope, and domain meaning rather than surface wording.",
  "Do not preserve markdown bullets, numbering, or list punctuation in generated titles or subtopics unless the user explicitly asks for that formatting.",
  "If the input already contains a usable agenda, keep the plan close to the supplied shape. Usually keep roughly the same number of points, merging duplicates or lightly splitting overloaded points only when clearly helpful.",
  "Do not expand a short agenda into a much larger one. Avoid adding many new topics that the presenter did not imply.",
  "If the input has only a meeting title or only a vague goal with little agenda detail, generate a compact skeleton agenda, usually 3 to 5 points.",
  "Each agenda point must include concise subtopic objects with id, order, title, status, and talkingPoints, plus a point-level status, objective, talking points, success signals, dependencies, estimated duration, and tags.",
  "Subtopics must be contextual, domain-specific, and downstream-useful. Expand the actual subject matter of the point instead of using generic scaffolding.",
  "Do not use generic filler such as 'Context framing', 'Key decision', 'Takeaway', 'Risks', or 'Questions' unless the source prompt explicitly asks for those topics.",
  "Use only entities, nouns, and domain terms that appear in the user input. Do not invent example domains or echo internal app/demo scaffolding.",
  "Never mention FileBackedNotesManager, Notes Manager, or NotesManager unless those exact terms appear in the user input.",
  "Prefer 2 to 4 short subtopics per point. Each subtopic should read like a specific discussion lane, implementation concern, edge case, or decision surface.",
  "Keep point titles short and concrete, usually 3 to 8 words. Avoid repeating the full objective verbatim in multiple fields.",
  "Keep the artifact compact. Use short objectives and keep talking points, success signals, and dependencies brief.",
  "Default the first topic and its first subtopic to active when no better execution state is implied. Use pending for future work and completed only when the prompt clearly implies it.",
  "Do not add filler. Keep the agenda structured, sequenced, and execution-ready.",
  "Return only valid JSON that matches the requested schema."
].join(" ");

export const agendaStatusSystemPrompt = [
  "You update execution statuses for an existing meeting agenda from presenter transcript evidence.",
  "Return only a status evaluation keyed by existing point and subtopic ids. Never rename, add, or delete agenda content.",
  "Use only these statuses: pending, active, partially_completed, completed.",
  "Exactly zero or one agenda entry may be active across the entire agenda. Use activeTarget to identify it. If no clear current focus exists, return activeTarget as null.",
  "Prefer the most specific subtopic as active when the current discussion clearly matches a subtopic. Use point-level active only when the presenter is covering the broader point without focusing on one subtopic.",
  "When a subtopic is active, its parent point should usually be partially_completed rather than active.",
  "The focusTranscriptWindow contains the newest presenter turns and should dominate active selection.",
  "The coverageTranscriptWindow contains broader recent presenter context and should influence partially_completed or completed judgments, not broad activation.",
  "Do not mark an item active or partially_completed when it is only mentioned as an overview, roadmap, teaser, or future topic list.",
  "Require clear elaboration for active status: usually at least two related sentences that spend time on the topic or subtopic.",
  "Use semantic matching, not only literal word overlap, but stay conservative.",
  "The meeting does not have to follow the agenda order. If the presenter clearly jumps to a later topic, that later topic may become active or partially_completed.",
  "Mark completed when the transcript indicates the point or subtopic has been substantively covered and the discussion has moved on.",
  "Once a point or subtopic is completed, do not regress it back to pending or partially_completed.",
  "Use partially_completed for items that have been meaningfully covered already but are not the single current focus or not fully closed.",
  "For demo purposes, be moderately aggressive about completion once the presenter clearly moves on to another topic after substantive coverage.",
  "If an introduction or setup section was active and the presenter has now shifted into the next real teaching topic, usually mark that introduction completed rather than leaving it hanging.",
  "Leave untouched future work as pending.",
  "It is acceptable for all points to remain pending if the transcript evidence is weak.",
  "Prefer conservative activation. Do not overclaim progress from passing mentions, introductions, or one-line previews.",
  "Use only evidence from the provided transcript windows.",
  "Return valid JSON that matches the schema."
].join(" ");

export const agendaStatusFewShotMessages = [
  {
    role: "user" as const,
    content: JSON.stringify(
      {
        meetingTitle: "Python File I/O",
        focusTranscriptWindow:
          "Presenter: Welcome to the class. Today we will cover reading files, encodings, and error handling. Presenter: First, let me introduce what file I/O is and why it matters.",
        coverageTranscriptWindow:
          "Presenter: Welcome to the class. Today we will cover reading files, encodings, and error handling. Presenter: First, let me introduce what file I/O is and why it matters. Presenter: We will get to Unicode errors later.",
        agendaArtifact: {
          meetingTitle: "Python File I/O",
          meetingIntent: "Teach file reading and writing.",
          summary: "A lecture about practical file handling in Python.",
          points: [
            {
              id: "intro",
              order: 1,
              title: "Introduction and scope",
              objective: "Set up the lecture.",
              status: "active",
              talkingPoints: [],
              successSignals: [],
              tags: ["intro"],
              subtopics: [
                {
                  id: "intro-1",
                  order: 1,
                  title: "What file I/O means",
                  status: "active",
                  talkingPoints: ["Define file input and output."]
                }
              ]
            },
            {
              id: "encoding",
              order: 2,
              title: "Unicode and encoding errors",
              objective: "Cover encoding pitfalls.",
              status: "pending",
              talkingPoints: [],
              successSignals: [],
              tags: ["encoding"],
              subtopics: [
                {
                  id: "encoding-1",
                  order: 1,
                  title: "Decode failures",
                  status: "pending",
                  talkingPoints: ["Explain UnicodeDecodeError causes."]
                }
              ]
            }
          ]
        }
      },
      null,
      2
    )
  },
  {
    role: "assistant" as const,
    content: JSON.stringify(
      {
        activeTarget: { kind: "subtopic", id: "intro-1" },
        points: [
          {
            id: "intro",
            status: "partially_completed",
            subtopics: [{ id: "intro-1", status: "active" }]
          },
          {
            id: "encoding",
            status: "pending",
            subtopics: [{ id: "encoding-1", status: "pending" }]
          }
        ]
      },
      null,
      2
    )
  },
  {
    role: "user" as const,
    content: JSON.stringify(
      {
        meetingTitle: "Python File I/O",
        focusTranscriptWindow:
          "Presenter: Now let us look at UnicodeDecodeError and why UTF-8 files sometimes fail under the wrong codec. Presenter: If you open the file with the wrong encoding, Python raises a decode error.",
        coverageTranscriptWindow:
          "Presenter: We finished the introduction to file I/O. Presenter: Now let us look at UnicodeDecodeError and why UTF-8 files sometimes fail under the wrong codec. Presenter: If you open the file with the wrong encoding, Python raises a decode error.",
        agendaArtifact: {
          meetingTitle: "Python File I/O",
          meetingIntent: "Teach file reading and writing.",
          summary: "A lecture about practical file handling in Python.",
          points: [
            {
              id: "intro",
              order: 1,
              title: "Introduction and scope",
              objective: "Set up the lecture.",
              status: "active",
              talkingPoints: [],
              successSignals: [],
              tags: ["intro"],
              subtopics: [
                {
                  id: "intro-1",
                  order: 1,
                  title: "What file I/O means",
                  status: "active",
                  talkingPoints: ["Define file input and output."]
                }
              ]
            },
            {
              id: "encoding",
              order: 2,
              title: "Unicode and encoding errors",
              objective: "Cover encoding pitfalls.",
              status: "pending",
              talkingPoints: [],
              successSignals: [],
              tags: ["encoding"],
              subtopics: [
                {
                  id: "encoding-1",
                  order: 1,
                  title: "Decode failures",
                  status: "pending",
                  talkingPoints: ["Explain UnicodeDecodeError causes."]
                }
              ]
            }
          ]
        }
      },
      null,
      2
    )
  },
  {
    role: "assistant" as const,
    content: JSON.stringify(
      {
        activeTarget: { kind: "subtopic", id: "encoding-1" },
        points: [
          {
            id: "intro",
            status: "completed",
            subtopics: [{ id: "intro-1", status: "completed" }]
          },
          {
            id: "encoding",
            status: "partially_completed",
            subtopics: [{ id: "encoding-1", status: "active" }]
          }
        ]
      },
      null,
      2
    )
  }
] as const;

export const factCheckSystemPrompt = [
  "You review live meeting transcript turns and flag only obvious factual mistakes or high-confidence corrections.",
  "latestTranscriptFocus contains the newest turns and should dominate the decision.",
  "transcriptHistory provides supporting recent context only.",
  "Only emit a fact check when the mistaken claim is directly grounded in the provided transcript. Never invent, broaden, or paraphrase a claim that the speaker did not actually make.",
  "Do not treat hypotheticals, questions, roadmap mentions, or quoted examples as factual claims unless the speaker clearly asserted them as true.",
  "Obvious contradictions to common knowledge should be flagged. Example: 'the sun rises in the west' should be corrected.",
  "If the speaker says Python cannot perform file operations or cannot make network requests, that is an obvious factual error and should be corrected.",
  "issuedFactChecksAlreadySent contains prior fact checks that were already delivered. Never repeat, restate, or acknowledge them.",
  "Never emit placeholder or no-op items such as 'No correction needed', 'No correction required', or 'No factual error detected'. If there is no obvious factual error, return an empty items array.",
  "Be conservative. If the transcript does not contain an obvious error, return an empty items array.",
  "Keep each claim, correction, and rationale short and concrete.",
  "Return valid JSON that matches the schema."
].join(" ");

export const factCheckFewShotMessages = [
  {
    role: "user" as const,
    content: JSON.stringify(
      {
        meetingTitle: "Python File I/O",
        latestTranscriptFocus: [
          "2026-03-25T21:40:16.000Z Host: The sun rises in the west and sets in the east."
        ],
        transcriptHistory: [
          "2026-03-25T21:40:10.000Z Host: Let's talk about buffered versus unbuffered I/O.",
          "2026-03-25T21:40:16.000Z Host: The sun rises in the west and sets in the east."
        ],
        issuedFactChecksAlreadySent: []
      },
      null,
      2
    )
  },
  {
    role: "assistant" as const,
    content: JSON.stringify(
      {
        items: [
          {
            id: "fc1",
            severity: "high",
            claim: "The sun rises in the west and sets in the east.",
            correction: "The sun rises in the east and sets in the west.",
            rationale: "This is a basic astronomical fact."
          }
        ]
      },
      null,
      2
    )
  },
  {
    role: "user" as const,
    content: JSON.stringify(
      {
        meetingTitle: "Python File I/O",
        latestTranscriptFocus: [
          "2026-03-25T21:41:08.000Z Host: Python cannot do any file operations and cannot connect to the internet."
        ],
        transcriptHistory: [
          "2026-03-25T21:41:00.000Z Host: Next let's cover file handling in Python.",
          "2026-03-25T21:41:08.000Z Host: Python cannot do any file operations and cannot connect to the internet."
        ],
        issuedFactChecksAlreadySent: []
      },
      null,
      2
    )
  },
  {
    role: "assistant" as const,
    content: JSON.stringify(
      {
        items: [
          {
            id: "fc2",
            severity: "high",
            claim: "Python cannot do any file operations and cannot connect to the internet.",
            correction: "Python can perform file operations and can make network requests.",
            rationale: "Python supports file I/O and networking libraries."
          }
        ]
      },
      null,
      2
    )
  },
  {
    role: "user" as const,
    content: JSON.stringify(
      {
        meetingTitle: "Python File I/O",
        latestTranscriptFocus: [
          "2026-03-25T21:41:16.000Z Host: Anyway, back to buffering."
        ],
        transcriptHistory: [
          "2026-03-25T21:41:08.000Z Host: Python cannot do any file operations and cannot connect to the internet.",
          "2026-03-25T21:41:16.000Z Host: Anyway, back to buffering."
        ],
        issuedFactChecksAlreadySent: [
          {
            claim: "Python cannot do any file operations and cannot connect to the internet.",
            correction: "Python can perform file operations and can make network requests."
          }
        ]
      },
      null,
      2
    )
  },
  {
    role: "assistant" as const,
    content: JSON.stringify({ items: [] }, null, 2)
  }
] as const;

export const factCheckAcknowledgementSystemPrompt = [
  "You rewrite a fact check into a short conversational presenter acknowledgement for a live meeting chat.",
  "Keep it natural and direct, as if the presenter is briefly correcting themselves and moving on.",
  "Do not mention AI, monitoring, fact checks, or moderation.",
  "Do not sound robotic or over-apologetic.",
  "Limit the response to one or two short sentences.",
  "Return valid JSON that matches the schema."
].join(" ");

export const refineAgendaUserPrompt = (input: RefineAgendaRequest) =>
  JSON.stringify(
    {
      roomCode: input.roomCode ?? null,
      meetingTitle: input.meetingTitle ?? null,
      meetingGoal: input.meetingGoal ?? null,
      agendaPrompt: input.agenda ?? []
    },
    null,
    2
  );

export const agendaStatusUserPrompt = (input: {
  meetingTitle: string | null;
  focusTranscriptWindow: string;
  coverageTranscriptWindow: string;
  agendaArtifact: AgendaArtifact;
}) =>
  JSON.stringify(
    {
      meetingTitle: input.meetingTitle,
      focusTranscriptWindow: input.focusTranscriptWindow,
      coverageTranscriptWindow: input.coverageTranscriptWindow,
      agendaArtifact: {
        meetingTitle: input.agendaArtifact.meetingTitle,
        meetingIntent: input.agendaArtifact.meetingIntent,
        summary: input.agendaArtifact.summary,
        points: input.agendaArtifact.points.map((point) => ({
          id: point.id,
          order: point.order,
          title: point.title,
          objective: point.objective,
          status: point.status ?? "pending",
          talkingPoints: point.talkingPoints,
          successSignals: point.successSignals,
          tags: point.tags,
          subtopics: point.subtopics.map((subtopic) => ({
            id: subtopic.id,
            order: subtopic.order,
            title: subtopic.title,
            status: subtopic.status ?? "pending",
            talkingPoints: subtopic.talkingPoints
          }))
        }))
      }
    },
    null,
    2
  );

export const factCheckUserPrompt = (input: {
  meetingTitle: string | null;
  latestTranscriptFocus: string[];
  transcriptHistory: string[];
  issuedFactChecks: Array<{
    claim: string;
    correction: string;
  }>;
}) =>
  JSON.stringify(
    {
      meetingTitle: input.meetingTitle,
      latestTranscriptFocus: input.latestTranscriptFocus,
      transcriptHistory: input.transcriptHistory,
      issuedFactChecksAlreadySent: input.issuedFactChecks
    },
    null,
    2
  );

export const factCheckAcknowledgementUserPrompt = (input: {
  meetingTitle: string | null;
  claim: string;
  correction: string;
  rationale: string;
}) =>
  JSON.stringify(
    {
      meetingTitle: input.meetingTitle,
      factCheck: {
        claim: input.claim,
        correction: input.correction,
        rationale: input.rationale
      }
    },
    null,
    2
  );

export const getFactCheckSummary = (items: FactCheckItem[]) =>
  items.map((item) => ({
    severity: item.severity,
    claim: item.claim,
    correction: item.correction
  }));
