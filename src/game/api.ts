import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AgentMessage, AgentOutput, ApiProtocol, AiProfile } from "./types";

export type ResponsesRequest = {
  model: string;
  input: AgentMessage[];
  response_format: { type: "json_object" };
  temperature: number;
  top_p: number;
  frequency_penalty: number;
  presence_penalty: number;
};

export type ChatCompletionsRequest = {
  model: string;
  messages: AgentMessage[];
  temperature: number;
  top_p: number;
  frequency_penalty: number;
  presence_penalty: number;
  max_tokens: number;
};

export type CompletionsRequest = {
  model: string;
  prompt: string;
  temperature: number;
  top_p: number;
  frequency_penalty: number;
  presence_penalty: number;
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
  temperature: 1,
  top_p: 1,
  frequency_penalty: 0,
  presence_penalty: 0,
});

export const buildCompletionsRequest = (
  model: string,
  messages: AgentMessage[],
): CompletionsRequest => ({
  model,
  prompt: formatPrompt(messages),
  temperature: 1,
  top_p: 1,
  frequency_penalty: 0,
  presence_penalty: 0,
  max_tokens: 420,
});

export const buildChatCompletionsRequest = (
  model: string,
  messages: AgentMessage[],
): ChatCompletionsRequest => ({
  model,
  messages,
  temperature: 1,
  top_p: 1,
  frequency_penalty: 0,
  presence_penalty: 0,
  max_tokens: 420,
});

export const buildAgentRequest = (
  protocol: ApiProtocol,
  model: string,
  messages: AgentMessage[],
) =>
  protocol === "responses"
    ? buildResponsesRequest(model, messages)
    : protocol === "chat_completions"
      ? buildChatCompletionsRequest(model, messages)
      : buildCompletionsRequest(model, messages);

const trimSlash = (value: string) => value.replace(/\/+$/, "");

const extractMessageText = (content: unknown) => {
  if (typeof content === "string") {
    return content;
  }
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const record = content as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text;
    }
    if (typeof record.content === "string") {
      return record.content;
    }
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object") {
          const record = part as Record<string, unknown>;
          if (typeof record.text === "string") {
            return record.text;
          }
          if (typeof record.content === "string") {
            return record.content;
          }
        }
        return "";
      })
      .filter(Boolean)
      .join("");
  }
  return "";
};

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
    if (message && message.content !== undefined) {
      const text = extractMessageText(message.content);
      if (text) {
        return text;
      }
    }
  }
  return "";
};

const safeParseJson = (raw: string) => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

const stripDecorations = (raw: string) => {
  let cleaned = raw;
  cleaned = cleaned.replace(/```json/gi, "```");
  cleaned = cleaned.replace(/```/g, "");
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "");
  cleaned = cleaned.replace(/<think>[\s\S]*/gi, "");
  return cleaned.trim();
};

const extractStringField = (raw: string, key: string) => {
  const regex = new RegExp(`"${key}"\\s*:\\s*"`, "i");
  const match = regex.exec(raw);
  if (!match || match.index === undefined) {
    return null;
  }
  let index = match.index + match[0].length;
  let value = "";
  let escaped = false;
  for (; index < raw.length; index += 1) {
    const char = raw[index];
    if (escaped) {
      value += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      return value;
    }
    if (char === "\n" || char === "\r") {
      break;
    }
    value += char;
  }
  return value.trim() || null;
};

const extractNumberField = (raw: string, key: string) => {
  const regex = new RegExp(`"${key}"\\s*:\\s*([0-9]*\\.?[0-9]+)`, "i");
  const match = regex.exec(raw);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
};

const extractLooseAgentOutput = (raw: string) => {
  const typeMatch = /"type"\s*:\s*"(speech|vote|night_action|wolf_chat)"/i.exec(
    raw,
  );
  if (!typeMatch) {
    return null;
  }
  const type = typeMatch[1] as AgentOutput["type"];
  const content = extractStringField(raw, "content");
  const notes = extractStringField(raw, "notes") ?? "";
  const confidence = extractNumberField(raw, "confidence");
  const targetNull = /"target"\s*:\s*null/i.test(raw);
  const target =
    extractStringField(raw, "target") ??
    (targetNull ? null : null);

  const normalized = normalizeAgentOutput({
    type,
    content: content ?? "",
    target,
    confidence: confidence ?? 0.5,
    notes,
  });
  if (normalized) {
    return normalized;
  }
  if (type === "vote" || type === "night_action") {
    return {
      type,
      content: "",
      target,
      confidence: confidence ?? 0.5,
      notes,
    };
  }
  return null;
};

type ProxyResponse = {
  ok: boolean;
  status: number;
  status_text: string;
  data: unknown;
  raw_text: string;
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
    profile.protocol === "responses"
      ? "/responses"
      : profile.protocol === "chat_completions"
        ? "/chat/completions"
        : "/completions";
  const url = `${trimSlash(profile.baseUrl)}${endpoint}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${profile.apiKey}`,
  };

  try {
    if (isTauri()) {
      const response = await invoke<ProxyResponse>("http_proxy", {
        request: {
          url,
          method: "POST",
          headers,
          body: JSON.stringify(body),
        },
      });
      if (!response.ok) {
        return {
          output: null,
          raw:
            response.raw_text ||
            `[http ${response.status}] ${response.status_text}`,
        };
      }
      const payload =
        response.data && response.data !== null
          ? response.data
          : safeParseJson(response.raw_text);
      const rawText = extractResponseText(payload).trim();
      const raw =
        rawText || response.raw_text?.toString().trim() || JSON.stringify(payload);
      const parsed = extractAgentOutput(raw);
      if (parsed) {
        return { output: parsed, raw };
      }
      return { output: null, raw };
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return {
        output: null,
        raw: `[http ${response.status}] ${await response.text()}`,
      };
    }
    const payload = (await response.json()) as unknown;
    const rawText = extractResponseText(payload).trim();
    const raw = rawText || JSON.stringify(payload);
    const parsed = extractAgentOutput(raw);
    if (parsed) {
      return { output: parsed, raw };
    }
    return { output: null, raw };
  } catch (error) {
    return {
      output: null,
      raw: `[request-error] ${String(error)}`,
    };
  }
};

export const extractJson = (raw: string) => {
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(raw.slice(start, index + 1));
        start = -1;
      }
    }
  }
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const parsed = safeParseJson(candidates[index]);
    if (parsed) {
      return parsed;
    }
  }
  return null;
};

const normalizeAgentOutput = (value: unknown): AgentOutput | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<AgentOutput>;
  const type = record.type;
  if (
    type !== "speech" &&
    type !== "vote" &&
    type !== "night_action" &&
    type !== "wolf_chat"
  ) {
    return null;
  }
  const content = typeof record.content === "string" ? record.content : "";
  const target =
    record.target === null || typeof record.target === "string"
      ? record.target
      : null;
  const confidence =
    typeof record.confidence === "number"
      ? Math.min(1, Math.max(0, record.confidence))
      : 0.5;
  const notes = typeof record.notes === "string" ? record.notes : "";
  if ((type === "speech" || type === "wolf_chat") && !content.trim()) {
    return null;
  }
  return {
    type,
    content,
    target,
    confidence,
    notes,
  };
};

const extractAgentOutput = (raw: string): AgentOutput | null => {
  const cleaned = stripDecorations(raw);
  const parsed = extractJson(cleaned);
  const normalized = normalizeAgentOutput(parsed);
  if (normalized) {
    return normalized;
  }
  return extractLooseAgentOutput(cleaned);
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
