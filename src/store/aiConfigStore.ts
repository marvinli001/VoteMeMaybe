import { Store } from "@tauri-apps/plugin-store";
import type { AiPlayerConfig, ApiProtocol, ApiProvider } from "../game/types";

const STORE_FILE = "ai-config.json";
const CONFIG_KEY = "aiConfig";

let storePromise: Promise<Store> | null = null;

const getStore = () => {
  if (!storePromise) {
    storePromise = Store.load(STORE_FILE);
  }
  return storePromise;
};

const isProtocol = (value: unknown): value is ApiProtocol =>
  value === "responses" || value === "completions";

export type AiConfigState = {
  providers: ApiProvider[];
  aiPlayers: AiPlayerConfig[];
};

const normalizeProviders = (
  raw: unknown,
  fallback: ApiProvider[],
): ApiProvider[] => {
  if (!Array.isArray(raw)) {
    return fallback;
  }

  const normalized: ApiProvider[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const candidate = item as Partial<ApiProvider>;
    if (
      typeof candidate.id === "string" &&
      typeof candidate.name === "string" &&
      isProtocol(candidate.protocol) &&
      typeof candidate.baseUrl === "string"
    ) {
      normalized.push({
        id: candidate.id,
        name: candidate.name.trim() || "未命名提供商",
        protocol: candidate.protocol,
        baseUrl: candidate.baseUrl.trim(),
        apiKey: typeof candidate.apiKey === "string" ? candidate.apiKey.trim() : "",
      });
    }
  }

  return normalized.length ? normalized : fallback;
};

const normalizeAiPlayers = (
  raw: unknown,
  fallback: AiPlayerConfig[],
  providers: ApiProvider[],
): AiPlayerConfig[] => {
  if (!Array.isArray(raw)) {
    return fallback;
  }

  const byId = new Map<string, Partial<AiPlayerConfig>>();
  for (const item of raw) {
    if (item && typeof item === "object") {
      const candidate = item as Partial<AiPlayerConfig>;
      if (typeof candidate.id === "string") {
        byId.set(candidate.id, candidate);
      }
    }
  }

  const providerIds = new Set(providers.map((provider) => provider.id));
  const fallbackProviderId = providers[0]?.id ?? "";

  return fallback.map((preset) => {
    const override = byId.get(preset.id);
    if (!override) {
      return preset;
    }

    const providerId =
      typeof override.providerId === "string" && providerIds.has(override.providerId)
        ? override.providerId
        : preset.providerId || fallbackProviderId;
    const model =
      typeof override.model === "string" && override.model.trim()
        ? override.model.trim()
        : preset.model;

    return {
      ...preset,
      providerId,
      model,
    };
  });
};

export const normalizeAiConfig = (
  raw: unknown,
  fallback: AiConfigState,
): AiConfigState => {
  if (!raw || typeof raw !== "object") {
    return fallback;
  }

  const record = raw as Partial<AiConfigState>;
  const providers = normalizeProviders(record.providers, fallback.providers);
  const aiPlayers = normalizeAiPlayers(record.aiPlayers, fallback.aiPlayers, providers);

  return {
    providers,
    aiPlayers,
  };
};

export const loadAiConfig = async (
  fallback: AiConfigState,
): Promise<AiConfigState> => {
  try {
    const store = await getStore();
    const stored = await store.get<AiConfigState>(CONFIG_KEY);
    return normalizeAiConfig(stored, fallback);
  } catch {
    return fallback;
  }
};

export const saveAiConfig = async (config: AiConfigState) => {
  const store = await getStore();
  await store.set(CONFIG_KEY, config);
  await store.save();
};
