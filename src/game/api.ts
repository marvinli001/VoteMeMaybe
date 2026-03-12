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

type JsonSchemaDefinition = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchemaDefinition };

export type ChatCompletionsRequest = {
  model: string;
  messages: AgentMessage[];
  response_format?: ResponseFormat;
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

const AGENT_OUTPUT_SCHEMA: ResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "agent_output",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        type: {
          type: "string",
          enum: ["speech", "vote", "night_action", "wolf_chat"],
        },
        content: { type: "string" },
        target: {
          anyOf: [{ type: "string" }, { type: "null" }],
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
        },
        notes: { type: "string" },
      },
      required: ["type", "content", "target", "confidence", "notes"],
    },
  },
};

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
  max_tokens: 20480,
});

const JSON_OBJECT_RESPONSE_FORMAT: ResponseFormat = { type: "json_object" };

export const buildChatCompletionsRequest = (
  model: string,
  messages: AgentMessage[],
  responseFormat: ResponseFormat | null = AGENT_OUTPUT_SCHEMA,
): ChatCompletionsRequest => {
  const request: ChatCompletionsRequest = {
    model,
    messages,
    temperature: 1,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    max_tokens: 20480,
  };
  if (responseFormat) {
    request.response_format = responseFormat;
  }
  return request;
};

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

const isReasoningFragment = (value: unknown) => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type.toLowerCase() : "";
  if (!type) {
    return false;
  }
  return (
    type.includes("reasoning") ||
    type === "analysis" ||
    type === "thinking"
  );
};

const extractMessageText = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((part) => !isReasoningFragment(part))
      .map((part) => {
        return extractMessageText(part);
      })
      .filter(Boolean)
      .join("");
  }
  if (content && typeof content === "object") {
    if (isReasoningFragment(content)) {
      return "";
    }
    const record = content as Record<string, unknown>;
    const directKeys = ["text", "content", "value", "output_text", "outputText"];
    for (const key of directKeys) {
      const value = record[key];
      if (typeof value === "string" && value) {
        return value;
      }
    }
    const nestedKeys = ["content", "parts", "items", "data", "message"];
    for (const key of nestedKeys) {
      if (record[key] !== undefined) {
        const nested = extractMessageText(record[key]);
        if (nested) {
          return nested;
        }
      }
    }
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
    for (const item of output) {
      const recordItem = item as Record<string, unknown>;
      const content = recordItem?.content;
      const text = extractMessageText(content);
      if (text) {
        return text;
      }
    }
  }
  const choices = record.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0] as Record<string, unknown>;
    if (typeof first.text === "string") {
      return first.text;
    }
    const messageText = extractMessageText(first.message);
    if (messageText) {
      return messageText;
    }
    const deltaText = extractMessageText(first.delta);
    if (deltaText) {
      return deltaText;
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

const stripReasoningFields = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => stripReasoningFields(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === "reasoning_content" || lowerKey === "reasoningcontent") {
      continue;
    }
    cleaned[key] = stripReasoningFields(entry);
  }
  return cleaned;
};

const stripReasoningContentFromRaw = (raw: string) => {
  const parsed = safeParseJson(raw);
  if (!parsed || typeof parsed !== "object") {
    return raw;
  }
  return JSON.stringify(stripReasoningFields(parsed));
};

const stripThoughtTags = (raw: string) => {
  let cleaned = raw;
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "");
  cleaned = cleaned.replace(/<think>[\s\S]*/gi, "");
  cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
  cleaned = cleaned.replace(/<thinking>[\s\S]*/gi, "");
  cleaned = cleaned.replace(
    /<reasoning_content>[\s\S]*?<\/reasoning_content>/gi,
    "",
  );
  cleaned = cleaned.replace(/<reasoning_content>[\s\S]*/gi, "");
  cleaned = cleaned.replace(
    /<reasoning(?:content)?>[\s\S]*?<\/reasoning(?:content)?>/gi,
    "",
  );
  cleaned = cleaned.replace(/<reasoning(?:content)?>[\s\S]*/gi, "");
  return cleaned;
};

const stripDecorations = (raw: string) => {
  let cleaned = raw;
  cleaned = cleaned.replace(/```json/gi, "```");
  cleaned = cleaned.replace(/```/g, "");
  cleaned = stripThoughtTags(cleaned);
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
  const targetString = extractStringField(raw, "target");
  const targetNumber = extractNumberField(raw, "target");
  const target =
    targetString ?? (targetNumber !== null ? String(targetNumber) : null);

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

type ResponseFormatFallback = "json_object" | "none";

const getResponseFormatFallback = (
  status: number,
  raw: string,
): ResponseFormatFallback | null => {
  if (![400, 415, 422].includes(status)) {
    return null;
  }
  const lower = raw.toLowerCase();
  if (!lower) {
    return "none";
  }
  if (lower.startsWith("[http")) {
    return "none";
  }
  if (lower.includes("json_schema") || lower.includes("schema")) {
    return "json_object";
  }
  if (lower.includes("response_format")) {
    return "none";
  }
  if (lower.includes("bad request") || lower.includes("bad_response_status_code")) {
    return "json_object";
  }
  return null;
};

const extractErrorText = (payload: unknown) => {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string") {
    return error.trim();
  }
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") {
      return message.trim();
    }
  }
  return "";
};

const extractCleanText = (payload: unknown) =>
  stripReasoningContentFromRaw(
    stripThoughtTags(extractResponseText(payload)).trim(),
  );

const parseAgentPayload = (payload: unknown, rawFallback: string) => {
  const rawText = extractCleanText(payload);
  const fallbackPayload = rawFallback ? safeParseJson(rawFallback) : null;
  const fallbackText = fallbackPayload ? extractCleanText(fallbackPayload) : "";
  const errorText =
    extractErrorText(payload) ||
    (fallbackPayload ? extractErrorText(fallbackPayload) : "");
  const fallback = stripReasoningContentFromRaw(
    stripThoughtTags(rawFallback).trim(),
  );
  const payloadSnapshot = JSON.stringify(stripReasoningFields(payload ?? null));
  const raw = rawText || fallbackText || errorText || fallback || payloadSnapshot;
  const parsed = extractAgentOutput(rawText || fallbackText || fallback);
  return { output: parsed, raw };
};

export const requestAgentOutput = async (
  profile: AiProfile,
  messages: AgentMessage[],
): Promise<{
  output: AgentOutput | null;
  raw: string;
}> => {
  const buildBody = (
    requestMessages: AgentMessage[],
    responseFormat?: ResponseFormat | null,
  ) => {
    if (profile.protocol === "chat_completions") {
      const format =
        responseFormat === undefined ? AGENT_OUTPUT_SCHEMA : responseFormat;
      return buildChatCompletionsRequest(
        profile.model,
        requestMessages,
        format,
      );
    }
    return buildAgentRequest(profile.protocol, profile.model, requestMessages);
  };
  const repairMessages: AgentMessage[] = [
    ...messages,
    {
      role: "user",
      content:
        "上一次输出未满足 JSON 格式要求。请仅输出一个 JSON 对象，且必须包含 type/content/target/confidence/notes 字段，不要输出解释或思考过程。",
    },
  ];
  const body = buildBody(messages);
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
      const attempt = async (requestBody: unknown) => {
        const response = await invoke<ProxyResponse>("ai_proxy", {
          request: {
            baseUrl: profile.baseUrl,
            protocol: profile.protocol,
            apiKey: profile.apiKey,
            body: JSON.stringify(requestBody),
          },
        });
        if (!response.ok) {
          return {
            ok: false as const,
            status: response.status,
            raw:
              response.raw_text ||
              `[http ${response.status}] ${response.status_text}`,
          };
        }
        const payload =
          response.data && response.data !== null
            ? response.data
            : safeParseJson(response.raw_text);
        const parsed = parseAgentPayload(
          payload,
          response.raw_text?.toString().trim() || "",
        );
        return { ok: true as const, ...parsed };
      };

      const primary = await attempt(body);
      if (!primary.ok) {
        const fallbackKind =
          profile.protocol === "chat_completions"
            ? getResponseFormatFallback(primary.status, primary.raw)
            : null;
        if (fallbackKind) {
          const fallbackBody = buildBody(
            messages,
            fallbackKind === "json_object" ? JSON_OBJECT_RESPONSE_FORMAT : null,
          );
          const fallback = await attempt(fallbackBody);
          if (fallback.ok) {
            return { output: fallback.output, raw: fallback.raw };
          }
          return { output: null, raw: fallback.raw };
        }
        return { output: null, raw: primary.raw };
      }
      if (profile.protocol === "chat_completions" && !primary.output) {
        const fallbackBody = buildBody(messages, JSON_OBJECT_RESPONSE_FORMAT);
        const fallback = await attempt(fallbackBody);
        if (fallback.ok && fallback.output) {
          return { output: fallback.output, raw: fallback.raw };
        }
        const noFormatBody = buildBody(messages, null);
        const noFormat = await attempt(noFormatBody);
        if (noFormat.ok) {
          return { output: noFormat.output, raw: noFormat.raw };
        }
        const repairBody = buildBody(repairMessages, JSON_OBJECT_RESPONSE_FORMAT);
        const repair = await attempt(repairBody);
        if (repair.ok) {
          return { output: repair.output, raw: repair.raw };
        }
        return { output: null, raw: repair.raw };
      }
      if (!primary.output) {
        const repairBody = buildBody(repairMessages);
        const repair = await attempt(repairBody);
        if (repair.ok) {
          return { output: repair.output, raw: repair.raw };
        }
        return { output: null, raw: repair.raw };
      }
      return { output: primary.output, raw: primary.raw };
    }

    const attempt = async (requestBody: unknown) => {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) {
        return {
          ok: false as const,
          status: response.status,
          raw: `[http ${response.status}] ${await response.text()}`,
        };
      }
      const payload = (await response.json()) as unknown;
      const parsed = parseAgentPayload(payload, "");
      return { ok: true as const, ...parsed };
    };

    const primary = await attempt(body);
    if (!primary.ok) {
      const fallbackKind =
        profile.protocol === "chat_completions"
          ? getResponseFormatFallback(primary.status, primary.raw)
          : null;
      if (fallbackKind) {
        const fallbackBody = buildBody(
          messages,
          fallbackKind === "json_object" ? JSON_OBJECT_RESPONSE_FORMAT : null,
        );
        const fallback = await attempt(fallbackBody);
        if (fallback.ok) {
          return { output: fallback.output, raw: fallback.raw };
        }
        return { output: null, raw: fallback.raw };
      }
      return { output: null, raw: primary.raw };
    }
    if (profile.protocol === "chat_completions" && !primary.output) {
      const fallbackBody = buildBody(messages, JSON_OBJECT_RESPONSE_FORMAT);
      const fallback = await attempt(fallbackBody);
      if (fallback.ok && fallback.output) {
        return { output: fallback.output, raw: fallback.raw };
      }
      const noFormatBody = buildBody(messages, null);
      const noFormat = await attempt(noFormatBody);
      if (noFormat.ok) {
        return { output: noFormat.output, raw: noFormat.raw };
      }
      const repairBody = buildBody(repairMessages, JSON_OBJECT_RESPONSE_FORMAT);
      const repair = await attempt(repairBody);
      if (repair.ok) {
        return { output: repair.output, raw: repair.raw };
      }
      return { output: null, raw: repair.raw };
    }
    if (!primary.output) {
      const repairBody = buildBody(repairMessages);
      const repair = await attempt(repairBody);
      if (repair.ok) {
        return { output: repair.output, raw: repair.raw };
      }
      return { output: null, raw: repair.raw };
    }
    return { output: primary.output, raw: primary.raw };
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
  const content =
    typeof record.content === "string" ? stripThoughtTags(record.content) : "";
  const target =
    record.target === null
      ? null
      : typeof record.target === "string"
        ? record.target
        : typeof record.target === "number" && Number.isFinite(record.target)
          ? String(record.target)
          : null;
  const confidence =
    typeof record.confidence === "number"
      ? Math.min(1, Math.max(0, record.confidence))
      : 0.5;
  const notes =
    typeof record.notes === "string" ? stripThoughtTags(record.notes) : "";
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
