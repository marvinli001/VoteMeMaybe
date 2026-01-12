import type { AgentMessage, AgentOutput, ApiProtocol, AiProfile } from "./types";

export type ResponsesRequest = {
  model: string;
  input: AgentMessage[];
  response_format: { type: "json_object" };
  temperature: number;
};

export type CompletionsRequest = {
  model: string;
  prompt: string;
  temperature: number;
  max_tokens: number;
};

const formatPrompt = (messages: AgentMessage[]) =>
  messages
    .map((message) => `[${message.role}] ${message.content}`)
    .join("\n\n")
    .trim();

export const buildResponsesRequest = (
  model: string,
  messages: AgentMessage[],
): ResponsesRequest => ({
  model,
  input: messages,
  response_format: { type: "json_object" },
  temperature: 0.6,
});

export const buildCompletionsRequest = (
  model: string,
  messages: AgentMessage[],
): CompletionsRequest => ({
  model,
  prompt: formatPrompt(messages),
  temperature: 0.6,
  max_tokens: 420,
});

export const buildAgentRequest = (
  protocol: ApiProtocol,
  model: string,
  messages: AgentMessage[],
) =>
  protocol === "responses"
    ? buildResponsesRequest(model, messages)
    : buildCompletionsRequest(model, messages);

const trimSlash = (value: string) => value.replace(/\/+$/, "");

const extractResponseText = (payload: unknown) => {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string") {
    return record.output_text;
  }
  const output = record.output;
  if (Array.isArray(output) && output.length > 0) {
    const first = output[0] as Record<string, unknown>;
    const content = first?.content;
    if (Array.isArray(content) && content.length > 0) {
      const chunk = content[0] as Record<string, unknown>;
      if (typeof chunk?.text === "string") {
        return chunk.text;
      }
    }
  }
  const choices = record.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0] as Record<string, unknown>;
    if (typeof first.text === "string") {
      return first.text;
    }
    const message = first.message as Record<string, unknown> | undefined;
    if (message && typeof message.content === "string") {
      return message.content;
    }
  }
  return "";
};

export const requestAgentOutput = async (
  profile: AiProfile,
  messages: AgentMessage[],
): Promise<{
  output: AgentOutput | null;
  raw: string;
}> => {
  const body = buildAgentRequest(profile.protocol, profile.model, messages);
  const endpoint =
    profile.protocol === "responses" ? "/responses" : "/completions";
  const url = `${trimSlash(profile.baseUrl)}${endpoint}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${profile.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as unknown;
  const raw = extractResponseText(payload).trim();
  const parsed = extractJson(raw);
  if (parsed && validateAgentOutput(parsed)) {
    return { output: parsed, raw };
  }
  return { output: null, raw };
};

export const extractJson = (raw: string) => {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
};

export const validateAgentOutput = (value: unknown): value is AgentOutput => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const output = value as AgentOutput;
  const typeOk =
    output.type === "speech" ||
    output.type === "vote" ||
    output.type === "night_action" ||
    output.type === "wolf_chat";
  const contentOk = typeof output.content === "string";
  const targetOk = output.target === null || typeof output.target === "string";
  const confidenceOk =
    typeof output.confidence === "number" &&
    output.confidence >= 0 &&
    output.confidence <= 1;
  const notesOk = typeof output.notes === "string";

  return typeOk && contentOk && targetOk && confidenceOk && notesOk;
};
