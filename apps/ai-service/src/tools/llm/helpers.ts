import type { RefineAgendaRequest } from "@mote/models";

type ChatCompletionPayload = {
  choices?: Array<{
    message?: {
      content?: string | Array<string | { text?: string }> | null;
      refusal?: string | null;
    } | null;
  }>;
};

export const extractTextContent = (payload: ChatCompletionPayload) => {
  const message = payload.choices?.[0]?.message;
  const content = message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if ("text" in part && typeof part.text === "string") {
          return part.text;
        }

        return "";
      })
      .join("")
      .trim();
  }

  if ("refusal" in (message ?? {}) && typeof message?.refusal === "string") {
    return message.refusal.trim();
  }

  return "";
};

export const isGpt5Model = (model: string) => /^gpt-5/i.test(model.trim());

export const getSourcePrompt = (input: RefineAgendaRequest) => {
  const agenda = (input.agenda ?? []).map((item) => item.trim()).filter(Boolean);

  if (agenda.length > 0) {
    return agenda;
  }

  return [input.meetingTitle?.trim(), input.meetingGoal?.trim()].filter(
    (value): value is string => Boolean(value)
  );
};

export const getAgendaCompletionTokenBudget = (
  input: RefineAgendaRequest,
  multiplier = 1
) => {
  const topicCount = Math.max(input.agenda?.length ?? 0, 1);
  const baseBudget = 2200 + topicCount * 250;
  return Math.min(Math.round(baseBudget * multiplier), 4800);
};
