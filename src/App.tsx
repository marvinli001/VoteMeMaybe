import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import "./App.css";
import type {
  ApiProvider,
  AiPlayerConfig,
  GameSession,
  PhaseId,
  PlayerPublicState,
  PlayerStatus,
  Role,
  SeatId,
} from "./game/types";
import {
  buildAgentTurnMessages,
  createGameSession,
  pushAgentMessage,
  pushPrivateMessage,
  pushPublicMessage,
  pushWolfChatMessage,
} from "./game/session";
import { requestAgentOutput } from "./game/api";
import {
  getAlivePlayers,
  getEligibleVoters,
  pickMajorityTarget,
  resolveTargetId,
  resolveVoteOutcome,
} from "./game/logic";
import { loadAiConfig, saveAiConfig } from "./store/aiConfigStore";
import type { AiConfigState } from "./store/aiConfigStore";

type Player = {
  id: string;
  name: string;
  seat: SeatId;
  status: PlayerStatus;
  isHuman?: boolean;
  accent: string;
};

type PendingAction =
  | { type: "speech"; maxLength: number }
  | { type: "vote"; options: PlayerPublicState[] }
  | {
      type: "night";
      role: Role;
      options: PlayerPublicState[];
      wolfTargetId?: string | null;
      canSave?: boolean;
      canPoison?: boolean;
    }
  | { type: "hunter"; options: PlayerPublicState[] };

type SpeechResult = { text: string };
type VoteResult = { targetId: string | null };
type NightResult = {
  action: "kill" | "check" | "save" | "poison" | "none" | "shoot";
  targetId: string | null;
  chat?: string;
};
type HunterResult = { targetId: string | null };

type EngineToken = { aborted: boolean };

type PhaseMeta = {
  name: string;
  detail: string;
  hint: string;
};

const humanId = "p0";

const seatLabels: Record<SeatId, string> = {
  "top-left": "左上",
  "top-mid-left": "上左",
  "top-mid-right": "上右",
  "top-right": "右上",
  "right-top": "右侧上",
  "right-bottom": "右侧下",
  "bottom-right": "右下",
  "bottom-mid-right": "下右",
  "bottom-mid-left": "下左",
  "bottom-left": "左下",
  "left-bottom": "左侧下",
  "left-top": "左侧上",
};

const seatPositions: Record<SeatId, CSSProperties> = {
  "top-left": { top: "9%", left: "18%" },
  "top-mid-left": { top: "4%", left: "38%" },
  "top-mid-right": { top: "4%", left: "62%" },
  "top-right": { top: "9%", left: "82%" },
  "right-top": { top: "28%", left: "94%" },
  "right-bottom": { top: "72%", left: "94%" },
  "bottom-right": { top: "91%", left: "82%" },
  "bottom-mid-right": { top: "96%", left: "62%" },
  "bottom-mid-left": { top: "96%", left: "38%" },
  "bottom-left": { top: "91%", left: "18%" },
  "left-bottom": { top: "72%", left: "6%" },
  "left-top": { top: "28%", left: "6%" },
};

const roster: Player[] = [
  {
    id: "p0",
    name: "旅人",
    seat: "bottom-mid-left",
    status: "存活",
    isHuman: true,
    accent: "#E3B56B",
  },
  {
    id: "p1",
    name: "乌鸦",
    seat: "bottom-mid-right",
    status: "存活",
    accent: "#2A9D8F",
  },
  {
    id: "p2",
    name: "灯塔",
    seat: "bottom-right",
    status: "存活",
    accent: "#5FB4D4",
  },
  {
    id: "p3",
    name: "雾行者",
    seat: "right-bottom",
    status: "存活",
    accent: "#F4A261",
  },
  {
    id: "p4",
    name: "镜面",
    seat: "right-top",
    status: "存活",
    accent: "#90BE6D",
  },
  {
    id: "p5",
    name: "赤砂",
    seat: "top-right",
    status: "存活",
    accent: "#F9C74F",
  },
  {
    id: "p6",
    name: "白棋",
    seat: "top-mid-right",
    status: "存活",
    accent: "#A0AEC0",
  },
  {
    id: "p7",
    name: "星铃",
    seat: "top-mid-left",
    status: "存活",
    accent: "#4D96FF",
  },
  {
    id: "p8",
    name: "旧槐",
    seat: "top-left",
    status: "存活",
    accent: "#43AA8B",
  },
  {
    id: "p9",
    name: "山雀",
    seat: "left-top",
    status: "存活",
    accent: "#F94144",
  },
  {
    id: "p10",
    name: "墨影",
    seat: "left-bottom",
    status: "存活",
    accent: "#577590",
  },
  {
    id: "p11",
    name: "黑潮",
    seat: "bottom-left",
    status: "存活",
    accent: "#84A98C",
  },
];

const seatOrder = roster.map((player) => player.id);
const thinkingTagTopIds = new Set([humanId, "p1"]);

const seatColors = roster.reduce(
  (acc, player) => {
    acc[player.seat] = player.accent;
    return acc;
  },
  {} as Record<SeatId, string>,
);

const roleLabels: Record<Role, string> = {
  werewolf: "狼人",
  seer: "预言家",
  witch: "女巫",
  hunter: "猎人",
  idiot: "白痴",
  villager: "平民",
};

const roleTeams: Record<Role, string> = {
  werewolf: "狼人阵营",
  seer: "好人阵营",
  witch: "好人阵营",
  hunter: "好人阵营",
  idiot: "好人阵营",
  villager: "好人阵营",
};

const roleHints: Record<Role, string> = {
  werewolf: "夜晚与狼队协作击杀，白天伪装好人。",
  seer: "每晚可查验 1 名玩家阵营。",
  witch: "拥有一次解药与一次毒药。",
  hunter: "死亡时可选择开枪带走一人。",
  idiot: "被放逐可翻牌免死但失去投票权。",
  villager: "无夜间技能，靠发言与投票推理。",
};

const defaultBaseUrl = "https://api.openai.com/v1";

const defaultProviders: ApiProvider[] = [
  {
    id: "provider-openai",
    name: "默认 OpenAI",
    protocol: "responses",
    baseUrl: defaultBaseUrl,
    apiKey: "",
  },
];

const defaultAiPlayers: AiPlayerConfig[] = [
  {
    id: "p1",
    name: "乌鸦",
    seat: "bottom-mid-right",
    providerId: "provider-openai",
    model: "gpt-4.1-mini",
  },
  {
    id: "p2",
    name: "灯塔",
    seat: "bottom-right",
    providerId: "provider-openai",
    model: "gpt-4.1",
  },
  {
    id: "p3",
    name: "雾行者",
    seat: "right-bottom",
    providerId: "provider-openai",
    model: "gpt-4.1-mini",
  },
  {
    id: "p4",
    name: "镜面",
    seat: "right-top",
    providerId: "provider-openai",
    model: "gpt-4.1",
  },
  {
    id: "p5",
    name: "赤砂",
    seat: "top-right",
    providerId: "provider-openai",
    model: "gpt-4.1-mini",
  },
  {
    id: "p6",
    name: "白棋",
    seat: "top-mid-right",
    providerId: "provider-openai",
    model: "gpt-4.1-mini",
  },
  {
    id: "p7",
    name: "星铃",
    seat: "top-mid-left",
    providerId: "provider-openai",
    model: "gpt-4.1-mini",
  },
  {
    id: "p8",
    name: "旧槐",
    seat: "top-left",
    providerId: "provider-openai",
    model: "gpt-4.1",
  },
  {
    id: "p9",
    name: "山雀",
    seat: "left-top",
    providerId: "provider-openai",
    model: "gpt-4.1-mini",
  },
  {
    id: "p10",
    name: "墨影",
    seat: "left-bottom",
    providerId: "provider-openai",
    model: "gpt-4.1-mini",
  },
  {
    id: "p11",
    name: "黑潮",
    seat: "bottom-left",
    providerId: "provider-openai",
    model: "gpt-4.1-mini",
  },
];

const defaultAiConfig: AiConfigState = {
  providers: defaultProviders,
  aiPlayers: defaultAiPlayers,
};

const phaseMeta: Record<PhaseId, PhaseMeta> = {
  night: {
    name: "夜晚阶段",
    detail: "部分玩家正在秘密行动",
    hint: "等待夜晚结算",
  },
  day: {
    name: "白天阶段",
    detail: "公布昨夜结果",
    hint: "准备进入讨论",
  },
  discussion: {
    name: "讨论阶段",
    detail: "你可以发言一次",
    hint: "按座位依次发言",
  },
  voting: {
    name: "投票阶段",
    detail: "请选择要放逐的玩家",
    hint: "投票后不可更改",
  },
  resolution: {
    name: "结算阶段",
    detail: "结算死亡技能与胜负",
    hint: "等待结算完成",
  },
};

const phaseOrder: PhaseId[] = [
  "night",
  "day",
  "discussion",
  "voting",
  "resolution",
];

const createId = () =>
  `id_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const cloneSession = (session: GameSession) =>
  typeof structuredClone === "function"
    ? structuredClone(session)
    : JSON.parse(JSON.stringify(session));

const formatRoleReveal = (session: GameSession, playerId: string) => {
  const player = session.players.find((item) => item.id === playerId);
  const role = session.roleAssignments[playerId];
  const roleLabel = role ? roleLabels[role] ?? role : "未知身份";
  return `${player?.name ?? playerId}（${roleLabel}）`;
};

const listUnavailableAiPlayers = (config: AiConfigState) => {
  const providerById = new Map(
    config.providers.map((provider) => [provider.id, provider]),
  );
  const fallbackProvider = config.providers[0];
  return config.aiPlayers
    .filter((player) => {
      const provider = providerById.get(player.providerId) ?? fallbackProvider;
      if (!provider) {
        return true;
      }
      return !provider.baseUrl.trim() || !provider.apiKey.trim();
    })
    .map((player) => player.name);
};

const parseWitchAction = (output: { content: string; notes: string } | null) => {
  if (!output) {
    return "none" as const;
  }
  const noteMatch = output.notes.match(/action=(save|poison|none)/i);
  if (noteMatch) {
    return noteMatch[1].toLowerCase() as "save" | "poison" | "none";
  }
  const text = `${output.content} ${output.notes}`.toLowerCase();
  if (text.includes("save") || text.includes("解药") || text.includes("救")) {
    return "save" as const;
  }
  if (text.includes("poison") || text.includes("毒")) {
    return "poison" as const;
  }
  return "none" as const;
};

function App() {
  const [view, setView] = useState<"menu" | "ai-config" | "game">("menu");
  const [aiConfig, setAiConfig] = useState<AiConfigState>(defaultAiConfig);
  const [session, setSession] = useState<GameSession | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const [paused, setPaused] = useState(false);
  const [draft, setDraft] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [selectedVoteTarget, setSelectedVoteTarget] = useState<string | null>(null);
  const [nightActionType, setNightActionType] = useState<
    "save" | "poison" | "none"
  >("none");
  const [nightTargetId, setNightTargetId] = useState<string | null>(null);
  const [currentSpeakerId, setCurrentSpeakerId] = useState<string | null>(null);
  const [thinkingId, setThinkingId] = useState<string | null>(null);
  const [privateOpen, setPrivateOpen] = useState(false);
  const [wolfChatDraft, setWolfChatDraft] = useState("");
  const [gameResult, setGameResult] = useState<string | null>(null);
  const [voteSummary, setVoteSummary] = useState<string[]>([]);
  const [voteSummaryOpen, setVoteSummaryOpen] = useState(false);
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);

  const sessionRef = useRef<GameSession | null>(null);
  const pausedRef = useRef(false);
  const pendingResolverRef = useRef<((value: unknown) => void) | null>(null);
  const engineRef = useRef<EngineToken | null>(null);
  const agentErrorRef = useRef<Record<string, string>>({});
  const chatBodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    let active = true;
    loadAiConfig(defaultAiConfig).then((loaded) => {
      if (active) {
        setAiConfig(loaded);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!pendingAction) {
      setSelectedVoteTarget(null);
      setNightTargetId(null);
      setWolfChatDraft("");
      return;
    }
    if (pendingAction.type === "night" && pendingAction.role === "witch") {
      if (pendingAction.canSave) {
        setNightActionType("save");
      } else if (pendingAction.canPoison) {
        setNightActionType("poison");
      } else {
        setNightActionType("none");
      }
      setNightTargetId(null);
      return;
    }
    setNightActionType("none");
    setNightTargetId(null);
  }, [pendingAction]);

  const displayPlayers = useMemo(() => {
    if (!session) {
      return roster;
    }
    const statusById = new Map(
      session.players.map((player) => [player.id, player.status]),
    );
    return roster.map((player) => ({
      ...player,
      status: statusById.get(player.id) ?? "存活",
    }));
  }, [session]);

  const phaseId = session?.phaseId ?? "night";
  const phaseInfo = phaseMeta[phaseId];
  const phaseProgress =
    (phaseOrder.indexOf(phaseId) + 1) / Math.max(phaseOrder.length, 1);
  const showThinkingIndicators = phaseId !== "night";

  const currentSpeaker = currentSpeakerId;
  const thinkingSpeaker = thinkingId;

  const publicLog = session?.publicLog ?? [];
  const humanRole = session?.roleAssignments[humanId];
  const humanRoleLabel = humanRole ? roleLabels[humanRole] : "未知";
  const humanRoleTeam = humanRole ? roleTeams[humanRole] : "";
  const humanRoleHint = humanRole ? roleHints[humanRole] : "";
  const humanPrivateMessages = session?.agents[humanId]?.privateMessages ?? [];
  const wolfChatMessages = session?.wolfChat ?? [];
  const wolfTeamNames = useMemo(() => {
    if (!session || humanRole !== "werewolf") {
      return [];
    }
    return session.players
      .filter((player) => session.roleAssignments[player.id] === "werewolf")
      .filter((player) => player.id !== humanId)
      .map((player) => player.name);
  }, [session, humanRole]);

  const isChatNearBottom = (element: HTMLElement) =>
    element.scrollHeight - element.scrollTop - element.clientHeight <= 48;

  const scrollChatToBottom = (behavior: ScrollBehavior = "smooth") => {
    const element = chatBodyRef.current;
    if (!element) {
      return;
    }
    element.scrollTo({ top: element.scrollHeight, behavior });
  };

  useEffect(() => {
    if (view !== "game") {
      setShowScrollToLatest(false);
      return;
    }
    const element = chatBodyRef.current;
    if (!element) {
      return;
    }
    const handleScroll = () => {
      setShowScrollToLatest(!isChatNearBottom(element));
    };
    handleScroll();
    element.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", handleScroll);
    };
  }, [view]);

  useEffect(() => {
    if (view !== "game") {
      return;
    }
    const element = chatBodyRef.current;
    if (!element) {
      return;
    }
    if (isChatNearBottom(element)) {
      scrollChatToBottom("smooth");
      setShowScrollToLatest(false);
    } else {
      setShowScrollToLatest(true);
    }
  }, [publicLog.length, view]);

  const canSpeak =
    pendingAction?.type === "speech" && !paused && view === "game";
  const canVote = pendingAction?.type === "vote" && !paused && view === "game";
  const canUseNight =
    (pendingAction?.type === "night" || pendingAction?.type === "hunter") &&
    !paused &&
    view === "game";

  const updateProvider = (id: string, patch: Partial<ApiProvider>) => {
    setAiConfig((prev) => ({
      ...prev,
      providers: prev.providers.map((provider) =>
        provider.id === id ? { ...provider, ...patch } : provider,
      ),
    }));
  };

  const addProvider = () => {
    const id = `provider_${Math.random().toString(36).slice(2, 8)}`;
    setAiConfig((prev) => ({
      ...prev,
      providers: [
        ...prev.providers,
        {
          id,
          name: "新提供商",
          protocol: "responses",
          baseUrl: defaultBaseUrl,
          apiKey: "",
        },
      ],
    }));
  };

  const removeProvider = (id: string) => {
    setAiConfig((prev) => {
      const providers = prev.providers.filter((provider) => provider.id !== id);
      const fallbackId = providers[0]?.id ?? "";
      return {
        providers,
        aiPlayers: prev.aiPlayers.map((player) =>
          player.providerId === id
            ? { ...player, providerId: fallbackId }
            : player,
        ),
      };
    });
  };

  const updateAiPlayer = (id: string, patch: Partial<AiPlayerConfig>) => {
    setAiConfig((prev) => ({
      ...prev,
      aiPlayers: prev.aiPlayers.map((player) =>
        player.id === id ? { ...player, ...patch } : player,
      ),
    }));
  };

  const handleSaveAiConfig = async () => {
    try {
      await saveAiConfig(aiConfig);
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1400);
    } catch {
      setSaveState("error");
      window.setTimeout(() => setSaveState("idle"), 1800);
    }
  };

  const stopEngine = () => {
    if (engineRef.current) {
      engineRef.current.aborted = true;
    }
    engineRef.current = null;
  };

  const handleReturnMenu = () => {
    stopEngine();
    pendingResolverRef.current = null;
    setPaused(false);
    setSession(null);
    sessionRef.current = null;
    setPendingAction(null);
    setCurrentSpeakerId(null);
    setThinkingId(null);
    setGameResult(null);
    setVoteSummary([]);
    setVoteSummaryOpen(false);
    setDraft("");
    setSelectedVoteTarget(null);
    setNightTargetId(null);
    setNightActionType("none");
    setPrivateOpen(false);
    setWolfChatDraft("");
    setView("menu");
  };

  const mutateSession = (mutator: (draft: GameSession) => void) => {
    const current = sessionRef.current;
    if (!current) {
      return;
    }
    mutator(current);
    setSession(cloneSession(current));
  };

  const addSystemMessage = (text: string) => {
    mutateSession((draft) => {
      pushPublicMessage(draft, {
        id: createId(),
        day: draft.day,
        phaseId: draft.phaseId,
        speakerId: "system",
        speakerName: "系统",
        text,
      });
    });
  };

  const addSpeechMessage = (speakerId: string, text: string) => {
    mutateSession((draft) => {
      const speaker = draft.players.find((player) => player.id === speakerId);
      if (!speaker) {
        return;
      }
      pushPublicMessage(draft, {
        id: createId(),
        day: draft.day,
        phaseId: draft.phaseId,
        speakerId,
        speakerName: speaker.name,
        text,
      });
    });
  };

  const addPrivateMessage = (targetId: string, content: string) => {
    mutateSession((draft) => {
      pushPrivateMessage(draft, targetId, {
        id: createId(),
        channel: "moderator",
        day: draft.day,
        phaseId: draft.phaseId,
        from: "moderator",
        to: targetId,
        content,
      });
    });
  };

  const addVoteBreakdown = (votes: Record<string, string | null>) => {
    const current = sessionRef.current;
    if (!current) {
      return;
    }
    const details = seatOrder
      .filter((voterId) => voterId in votes)
      .map((voterId) => {
        const voterName =
          current.players.find((player) => player.id === voterId)?.name ??
          voterId;
        const voterStatus =
          current.players.find((player) => player.id === voterId)?.status ??
          "死亡";
        if (voterStatus !== "存活") {
          return null;
        }
        const targetId = votes[voterId];
        if (!targetId) {
          return `${voterName}→弃票`;
        }
        const targetName =
          current.players.find((player) => player.id === targetId)?.name ??
          targetId;
        return `${voterName}→${targetName}`;
      })
      .filter(Boolean) as string[];
    if (details.length > 0) {
      addPrivateMessage(humanId, `投票明细（仅你可见）：${details.join("；")}`);
      setVoteSummary(details);
      setVoteSummaryOpen(true);
    }
  };

  const addWolfChat = (fromId: string, content: string) => {
    mutateSession((draft) => {
      const from = draft.players.find((player) => player.id === fromId);
      pushWolfChatMessage(draft, {
        id: createId(),
        channel: "wolf_chat",
        day: draft.day,
        phaseId: draft.phaseId,
        from: from?.name ?? fromId,
        to: "wolf_chat",
        content,
      });
    });
  };

  const markDead = (playerId: string) => {
    mutateSession((draft) => {
      const player = draft.players.find((item) => item.id === playerId);
      if (player && player.status !== "死亡") {
        player.status = "死亡";
      }
    });
  };

  const updatePhase = (nextPhase: PhaseId) => {
    mutateSession((draft) => {
      draft.phaseId = nextPhase;
    });
  };

  const waitWhilePaused = async (engine: EngineToken) => {
    while (!engine.aborted && pausedRef.current) {
      await delay(200);
    }
  };

  const requestHumanAction = <T,>(action: PendingAction) =>
    new Promise<T>((resolve) => {
      pendingResolverRef.current = resolve as (value: unknown) => void;
      setPendingAction(action);
    });

  const resolvePendingAction = (payload: unknown) => {
    if (pendingResolverRef.current) {
      pendingResolverRef.current(payload);
    }
    pendingResolverRef.current = null;
    setPendingAction(null);
  };

  const handleSubmitSpeech = () => {
    if (pendingAction?.type !== "speech") {
      return;
    }
    const text = draft.trim();
    if (!text) {
      return;
    }
    resolvePendingAction({ text } satisfies SpeechResult);
    setDraft("");
  };

  const handleConfirmVote = () => {
    if (pendingAction?.type !== "vote") {
      return;
    }
    if (!selectedVoteTarget) {
      return;
    }
    if (selectedVoteTarget === "__abstain__") {
      resolvePendingAction({ targetId: null } satisfies VoteResult);
      return;
    }
    resolvePendingAction({ targetId: selectedVoteTarget } satisfies VoteResult);
  };

  const handleAbstainVote = () => {
    if (pendingAction?.type !== "vote" || !canVote) {
      return;
    }
    resolvePendingAction({ targetId: null } satisfies VoteResult);
    setSelectedVoteTarget(null);
  };

  const handleConfirmNightAction = () => {
    if (pendingAction?.type !== "night") {
      return;
    }
    if (pendingAction.role === "werewolf") {
      const targetId = nightTargetId === "__none__" ? null : nightTargetId;
      resolvePendingAction({
        action: "kill",
        targetId,
        chat: wolfChatDraft.trim() || undefined,
      } satisfies NightResult);
      return;
    }
    if (pendingAction.role === "seer") {
      if (!nightTargetId) {
        return;
      }
      resolvePendingAction({
        action: "check",
        targetId: nightTargetId,
      } satisfies NightResult);
      return;
    }
    if (pendingAction.role === "witch") {
      if (nightActionType === "save") {
        resolvePendingAction({
          action: "save",
          targetId: pendingAction.wolfTargetId ?? null,
        } satisfies NightResult);
        return;
      }
      if (nightActionType === "poison") {
        if (!nightTargetId) {
          return;
        }
        resolvePendingAction({
          action: "poison",
          targetId: nightTargetId,
        } satisfies NightResult);
        return;
      }
      resolvePendingAction({ action: "none", targetId: null } satisfies NightResult);
      return;
    }
    resolvePendingAction({ action: "none", targetId: null } satisfies NightResult);
  };

  const handleConfirmHunter = () => {
    if (pendingAction?.type !== "hunter") {
      return;
    }
    const targetId = nightTargetId === "__none__" ? null : nightTargetId;
    resolvePendingAction({ targetId } satisfies HunterResult);
  };

  const handleStartGame = () => {
    stopEngine();
    pendingResolverRef.current = null;
    agentErrorRef.current = {};
    const players: PlayerPublicState[] = roster.map((player) => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
      status: "存活",
    }));
    const nextSession = createGameSession({
      players,
      aiPlayers: aiConfig.aiPlayers,
      providers: aiConfig.providers,
      day: 1,
      phaseId: "night",
    });
    sessionRef.current = nextSession;
    setSession(cloneSession(nextSession));
    setView("game");
    setPaused(false);
    setPendingAction(null);
    setCurrentSpeakerId(null);
    setThinkingId(null);
    setGameResult(null);
    setVoteSummary([]);
    setVoteSummaryOpen(false);
    setDraft("");
    setSelectedVoteTarget(null);
    setNightTargetId(null);
    setNightActionType("none");
    setPrivateOpen(false);
    setWolfChatDraft("");

    const offlineAi = listUnavailableAiPlayers(aiConfig);
    if (offlineAi.length > 0) {
      addSystemMessage(
        `提示：以下 AI 未配置 API Key 或 Host，将自动沉默：${offlineAi.join(
          "、",
        )}。`,
      );
    }
    addSystemMessage("身份已分配，夜晚降临。请查看右侧身份卡与私密信息。");

    const engine = { aborted: false };
    engineRef.current = engine;
    runGameLoop(engine).catch(() => {
      engine.aborted = true;
    });
  };

  const reportAgentFailure = (agentId: string, raw: string) => {
    const current = sessionRef.current;
    if (!current) {
      return;
    }
    const name =
      current.players.find((player) => player.id === agentId)?.name ?? agentId;
    const trimmed = raw.trim();
    const summary = trimmed
      ? trimmed.slice(0, 180)
      : "响应为空或不符合 JSON 结构。";
    const signature = `${agentId}:${summary}`;
    if (agentErrorRef.current[agentId] === signature) {
      return;
    }
    agentErrorRef.current[agentId] = signature;
    addPrivateMessage(
      humanId,
      `AI ${name} 响应无效/失败：${summary}`,
    );
  };

  const callAgent = async (agentId: string) => {
    const current = sessionRef.current;
    if (!current) {
      return null;
    }
    const profile = current.aiProfiles[agentId];
    if (!profile || !profile.baseUrl || !profile.apiKey) {
      reportAgentFailure(agentId, "缺少 API Host 或 API Key。");
      return null;
    }
    const messages = buildAgentTurnMessages(current, agentId);
    try {
      const { output, raw } = await requestAgentOutput(profile, messages);
      const assistantContent = output
        ? JSON.stringify(output)
        : "[invalid-response]";
      mutateSession((draft) => {
        pushAgentMessage(draft, agentId, {
          role: "assistant",
          content: assistantContent,
        });
      });
      if (!output) {
        reportAgentFailure(agentId, raw || "响应未通过解析。");
      }
      return output;
    } catch {
      mutateSession((draft) => {
        pushAgentMessage(draft, agentId, {
          role: "assistant",
          content: "[request-error]",
        });
      });
      reportAgentFailure(agentId, "请求异常。");
      return null;
    }
  };

  const getWinner = () => {
    const current = sessionRef.current;
    if (!current) {
      return null;
    }
    const alive = getAlivePlayers(current.players);
    const wolfAlive = alive.filter(
      (player) => current.roleAssignments[player.id] === "werewolf",
    ).length;
    const nonWolfAlive = alive.length - wolfAlive;
    if (wolfAlive === 0) {
      return "good";
    }
    if (wolfAlive >= nonWolfAlive) {
      return "wolf";
    }
    return null;
  };

  const endGame = (winner: "good" | "wolf", engine: EngineToken) => {
    updatePhase("resolution");
    setCurrentSpeakerId(null);
    setThinkingId(null);
    setPendingAction(null);
    const winnerText = winner === "good" ? "好人胜利" : "狼人胜利";
    addSystemMessage(`游戏结束：${winnerText}`);
    setGameResult(winnerText);
    engine.aborted = true;
  };

  const runGameLoop = async (engine: EngineToken) => {
    while (!engine.aborted) {
      await runNightPhase(engine);
      if (engine.aborted) {
        return;
      }
      const winnerAfterNight = getWinner();
      if (winnerAfterNight) {
        endGame(winnerAfterNight, engine);
        return;
      }
      await runDayPhase(engine);
      if (engine.aborted) {
        return;
      }
      const winnerAfterDay = getWinner();
      if (winnerAfterDay) {
        endGame(winnerAfterDay, engine);
        return;
      }
      mutateSession((draft) => {
        draft.day += 1;
      });
    }
  };

  const runNightPhase = async (engine: EngineToken) => {
    updatePhase("night");
    await waitWhilePaused(engine);
    if (engine.aborted) {
      return;
    }
    const current = sessionRef.current;
    if (!current) {
      return;
    }

    const alivePlayers = getAlivePlayers(current.players);
    const wolves = alivePlayers.filter(
      (player) => current.roleAssignments[player.id] === "werewolf",
    );
    const wolfVotes: Array<string | null> = [];
    const validWolfTargets = alivePlayers
      .filter((player) => current.roleAssignments[player.id] !== "werewolf")
      .map((player) => player.id);

    for (const wolf of wolves) {
      await waitWhilePaused(engine);
      if (engine.aborted) {
        return;
      }
      if (wolf.id === humanId) {
        const result = await requestHumanAction<NightResult>({
          type: "night",
          role: "werewolf",
          options: alivePlayers,
        });
        if (engine.aborted) {
          return;
        }
        if (result.chat) {
          addWolfChat(wolf.id, result.chat);
        }
        if (result.targetId && validWolfTargets.includes(result.targetId)) {
          wolfVotes.push(result.targetId);
        } else {
          wolfVotes.push(null);
        }
        continue;
      }
      addPrivateMessage(
        wolf.id,
        "夜晚行动：请在狼队私聊输出你的计划。若给出击杀目标，type=wolf_chat 或 night_action，target 填玩家编号/姓名；允许空刀可填 null。",
      );
      setThinkingId(wolf.id);
      const output = await callAgent(wolf.id);
      setThinkingId(null);
      if (engine.aborted) {
        return;
      }
      if (output?.type === "wolf_chat" && output.content.trim()) {
        addWolfChat(wolf.id, output.content.trim());
      }
      if (
        (output?.type === "wolf_chat" || output?.type === "night_action") &&
        output?.target
      ) {
        const resolved = resolveTargetId(alivePlayers, output.target, current.players);
        if (resolved && validWolfTargets.includes(resolved)) {
          wolfVotes.push(resolved);
        } else {
          wolfVotes.push(null);
        }
      } else {
        wolfVotes.push(null);
      }
    }

    const wolfTargetId = pickMajorityTarget(wolfVotes, seatOrder);

    const seerEntry = Object.entries(current.roleAssignments).find(
      ([, role]) => role === "seer",
    );
    const seerId = seerEntry?.[0];
    if (seerId) {
      const seer = current.players.find((player) => player.id === seerId);
      if (seer?.status !== "死亡") {
        await waitWhilePaused(engine);
        if (!engine.aborted) {
          if (seerId === humanId) {
            const result = await requestHumanAction<NightResult>({
              type: "night",
              role: "seer",
              options: alivePlayers,
            });
            if (engine.aborted) {
              return;
            }
            if (result.targetId) {
              const targetRole = current.roleAssignments[result.targetId];
              const resultText =
                targetRole === "werewolf" ? "狼人" : "好人";
              addPrivateMessage(
                seerId,
                `查验结果：${
                  current.players.find((player) => player.id === result.targetId)
                    ?.name ?? result.targetId
                } 是 ${resultText}。`,
              );
            }
          } else {
            addPrivateMessage(
              seerId,
              "夜晚行动：请选择查验目标。type=night_action，target 填玩家编号/姓名。",
            );
            setThinkingId(seerId);
            const output = await callAgent(seerId);
            setThinkingId(null);
            if (engine.aborted) {
              return;
            }
            const resolved = resolveTargetId(
              alivePlayers,
              output?.target ?? null,
              current.players,
            );
            if (resolved) {
              const targetRole = current.roleAssignments[resolved];
              const resultText = targetRole === "werewolf" ? "狼人" : "好人";
              addPrivateMessage(
                seerId,
                `查验结果：${
                  current.players.find((player) => player.id === resolved)?.name ??
                  resolved
                } 是 ${resultText}。`,
              );
            }
          }
        }
      }
    }

    const witchEntry = Object.entries(current.roleAssignments).find(
      ([, role]) => role === "witch",
    );
    const witchId = witchEntry?.[0];
    let saved = false;
    let poisonedId: string | null = null;
    if (witchId) {
      const witch = current.players.find((player) => player.id === witchId);
      if (witch?.status !== "死亡") {
        const canSave =
          !current.witchState.antidoteUsed && Boolean(wolfTargetId);
        const canPoison = !current.witchState.poisonUsed;
        await waitWhilePaused(engine);
        if (!engine.aborted) {
          if (witchId === humanId) {
            const result = await requestHumanAction<NightResult>({
              type: "night",
              role: "witch",
              options: alivePlayers,
              wolfTargetId,
              canSave,
              canPoison,
            });
            if (engine.aborted) {
              return;
            }
            if (result.action === "save" && canSave && wolfTargetId) {
              saved = true;
              mutateSession((draft) => {
                draft.witchState.antidoteUsed = true;
              });
            } else if (result.action === "poison" && canPoison) {
              if (result.targetId) {
                poisonedId = result.targetId;
                mutateSession((draft) => {
                  draft.witchState.poisonUsed = true;
                });
              }
            }
          } else {
            addPrivateMessage(
              witchId,
              `夜晚行动：你只能救或毒其一，action=save/poison/none。今晚被刀：${
                wolfTargetId
                  ? current.players.find((player) => player.id === wolfTargetId)
                      ?.name ?? wolfTargetId
                  : "无人"
              }。notes 请以 action=save/poison/none 开头。`,
            );
            setThinkingId(witchId);
            const output = await callAgent(witchId);
            setThinkingId(null);
            if (engine.aborted) {
              return;
            }
            const action = parseWitchAction(output);
            if (action === "save" && canSave && wolfTargetId) {
              saved = true;
              mutateSession((draft) => {
                draft.witchState.antidoteUsed = true;
              });
            } else if (action === "poison" && canPoison) {
              const resolved = resolveTargetId(
                alivePlayers,
                output?.target ?? null,
                current.players,
              );
              if (resolved) {
                poisonedId = resolved;
                mutateSession((draft) => {
                  draft.witchState.poisonUsed = true;
                });
              }
            }
          }
        }
      }
    }

    const nightDeaths: string[] = [];
    if (wolfTargetId && !saved) {
      nightDeaths.push(wolfTargetId);
    }
    if (poisonedId && !nightDeaths.includes(poisonedId)) {
      nightDeaths.push(poisonedId);
    }

    nightDeaths.forEach((id) => markDead(id));

    mutateSession((draft) => {
      draft.phaseId = "day";
    });

    if (nightDeaths.length === 0) {
      addSystemMessage("昨夜无人死亡（平安夜）。");
    } else {
      const names = nightDeaths
        .map((id) => formatRoleReveal(current, id))
        .join("、");
      addSystemMessage(`昨夜死亡：${names}。`);
    }

    await resolveHunterShot(engine, nightDeaths);
    if (engine.aborted) {
      return;
    }
  };

  const runDayPhase = async (engine: EngineToken) => {
    updatePhase("discussion");
    await waitWhilePaused(engine);
    if (engine.aborted) {
      return;
    }
    const current = sessionRef.current;
    if (!current) {
      return;
    }

    for (const playerId of seatOrder) {
      const player = current.players.find((item) => item.id === playerId);
      if (!player || player.status === "死亡") {
        continue;
      }
      await waitWhilePaused(engine);
      if (engine.aborted) {
        return;
      }
      if (playerId === humanId) {
        setCurrentSpeakerId(playerId);
        const result = await requestHumanAction<SpeechResult>({
          type: "speech",
          maxLength: 240,
        });
        if (engine.aborted) {
          return;
        }
        addSpeechMessage(playerId, result.text.trim());
        setCurrentSpeakerId(null);
        continue;
      }
      addPrivateMessage(
        playerId,
        "发言阶段：请输出 type=speech，content 为公开发言。",
      );
      setThinkingId(playerId);
      const output = await callAgent(playerId);
      setThinkingId(null);
      if (engine.aborted) {
        return;
      }
      setCurrentSpeakerId(playerId);
      const speechText =
        output?.type === "speech" && output.content.trim()
          ? output.content.trim()
          : "（沉默）";
      addSpeechMessage(playerId, speechText);
      await delay(250);
      if (engine.aborted) {
        return;
      }
      setCurrentSpeakerId(null);
      await delay(200);
      if (engine.aborted) {
        return;
      }
    }

    updatePhase("voting");
    await waitWhilePaused(engine);
    if (engine.aborted) {
      return;
    }

    const voters = getEligibleVoters(current.players);
    const votes: Record<string, string | null> = {};
    for (const voterId of seatOrder) {
      const voterState = current.players.find((player) => player.id === voterId);
      if (!voterState || voterState.status !== "存活") {
        continue;
      }
      if (!voters.find((player) => player.id === voterId)) {
        continue;
      }
      await waitWhilePaused(engine);
      if (engine.aborted) {
        return;
      }
      if (voterId === humanId) {
        const result = await requestHumanAction<VoteResult>({
          type: "vote",
          options: getAlivePlayers(current.players),
        });
        if (engine.aborted) {
          return;
        }
        votes[voterId] = result.targetId;
        continue;
      }
      addPrivateMessage(
        voterId,
        "投票阶段：请独立决策后输出 type=vote，target 填放逐目标编号/姓名或 null。",
      );
      setThinkingId(voterId);
      const output = await callAgent(voterId);
      setThinkingId(null);
      if (engine.aborted) {
        return;
      }
      const resolved = resolveTargetId(
        getAlivePlayers(current.players),
        output?.target ?? null,
        current.players,
      );
      votes[voterId] = output?.type === "vote" ? resolved : null;
    }

    addVoteBreakdown(votes);

    updatePhase("resolution");
    const outcome = resolveVoteOutcome(votes, seatOrder);
    if (!outcome.targetId || outcome.isTie) {
      addSystemMessage("投票结果：平票，无放逐。");
      return;
    }

    const targetId = outcome.targetId;
    const targetRole = current.roleAssignments[targetId];
    if (targetRole === "idiot" && !current.idiotRevealed[targetId]) {
      mutateSession((draft) => {
        draft.idiotRevealed[targetId] = true;
        const target = draft.players.find((player) => player.id === targetId);
        if (target) {
          target.status = "禁投";
        }
      });
      addSystemMessage(
        `投票结果：${
          current.players.find((player) => player.id === targetId)?.name ??
          targetId
        } 翻牌为白痴，免死并失去投票权。`,
      );
      return;
    }

    markDead(targetId);
    addSystemMessage(`投票结果：${formatRoleReveal(current, targetId)} 被放逐。`);
    await resolveHunterShot(engine, [targetId]);
    if (engine.aborted) {
      return;
    }
  };

  const resolveHunterShot = async (engine: EngineToken, deaths: string[]) => {
    const current = sessionRef.current;
    if (!current || current.hunterShotUsed) {
      return;
    }
    const hunterEntry = Object.entries(current.roleAssignments).find(
      ([, role]) => role === "hunter",
    );
    const hunterId = hunterEntry?.[0];
    if (!hunterId || !deaths.includes(hunterId)) {
      return;
    }

    await waitWhilePaused(engine);
    if (engine.aborted) {
      return;
    }

    if (hunterId === humanId) {
      const result = await requestHumanAction<HunterResult>({
        type: "hunter",
        options: getAlivePlayers(current.players),
      });
      if (engine.aborted) {
        return;
      }
      mutateSession((draft) => {
        draft.hunterShotUsed = true;
      });
      if (result.targetId) {
        markDead(result.targetId);
        addSystemMessage(
          `猎人开枪带走了 ${formatRoleReveal(current, result.targetId)}。`,
        );
      } else {
        addSystemMessage("猎人选择不开枪。");
      }
      return;
    }

    addPrivateMessage(
      hunterId,
      "你已死亡，可选择开枪带走一名玩家。type=night_action，target=目标或 null。",
    );
    setThinkingId(hunterId);
    const output = await callAgent(hunterId);
    setThinkingId(null);
    if (engine.aborted) {
      return;
    }
    mutateSession((draft) => {
      draft.hunterShotUsed = true;
    });
    const resolved = resolveTargetId(
      getAlivePlayers(current.players),
      output?.target ?? null,
      current.players,
    );
    if (resolved) {
      markDead(resolved);
      addSystemMessage(
        `猎人开枪带走了 ${formatRoleReveal(current, resolved)}。`,
      );
    } else {
      addSystemMessage("猎人选择不开枪。");
    }
  };
  const playerHasWolfChat = session
    ? session.roleAssignments[humanId] === "werewolf" &&
      session.players.find((player) => player.id === humanId)?.status !== "死亡"
    : false;

  const voteTargets = displayPlayers.map((player) => ({
    ...player,
    disabled:
      phaseId !== "voting" ||
      player.status !== "存活" ||
      !canVote ||
      paused,
  }));

  const nightTargets = displayPlayers.filter(
    (player) => player.status !== "死亡",
  );

  return (
    <div className="app">
      {view === "menu" ? (
        <div className="menu">
          <header className="menu__header">
            <div>
              <span className="menu__badge">离线桌游 · 单人推理</span>
              <h1 className="menu__title">Vote Me Maybe</h1>
              <p className="menu__subtitle">
                你是唯一的人类玩家，其余席位由 AI 代理接管。对局过程中
                只展示最终发言，不展示推理链与身份信息。
              </p>
            </div>
            <div className="menu__status">
              <div className="menu__status-item">
                <span className="menu__status-label">席位</span>
                <strong>12 人局</strong>
              </div>
              <div className="menu__status-item">
                <span className="menu__status-label">模式</span>
                <strong>单机 / 离线</strong>
              </div>
            </div>
          </header>

          <div className="menu__body">
            <section className="menu__center">
              <div className="menu__top">
                <div className="panel start-panel">
                  <div>
                    <span className="start-panel__eyebrow">快速开局</span>
                    <h2>准备进入牌桌</h2>
                    <p>
                      先完成 AI 协议与模型配置，再开始对局。所有输出以 JSON
                      结构返回，界面只呈现发言字段。
                    </p>
                  </div>
                  <div className="start-panel__actions">
                    <button
                      className="button button--primary"
                      onClick={handleStartGame}
                    >
                      开始游戏
                    </button>
                    <button
                      className="button button--ghost"
                      onClick={() => setView("ai-config")}
                    >
                      AI 玩家配置
                    </button>
                  </div>
                </div>

                <div className="panel panel--compact">
                  <div className="panel__title">开局配置</div>
                  <div className="setup-grid">
                    <label>
                      角色包
                      <select defaultValue="classic">
                        <option value="classic">经典 12 人</option>
                        <option value="guard">含守卫</option>
                        <option value="seer">多神职</option>
                      </select>
                    </label>
                    <label>
                      显示提示
                      <select defaultValue="soft">
                        <option value="soft">温和引导</option>
                        <option value="hard">仅阶段提示</option>
                      </select>
                    </label>
                  </div>
                  <div className="setup-note">
                    发言与投票均为单次锁定，非法操作会提前禁用。
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      ) : view === "ai-config" ? (
        <div className="config">
          <header className="config__header">
            <div>
              <span className="config__badge">AI 玩家配置</span>
              <h1 className="config__title">配置 AI 玩家</h1>
                <p className="config__subtitle">
                  先创建 API 提供商，再为每位 AI 选择提供商与模型。Responses
                  调用 /v1/responses，Chat Completions 调用 /v1/chat/completions。
                </p>
            </div>
            <div className="config__actions">
              <button className="button button--ghost" onClick={() => setView("menu")}
              >
                返回主页
              </button>
              <button className="button button--ghost" onClick={handleSaveAiConfig}
              >
                {saveState === "saved"
                  ? "已保存"
                  : saveState === "error"
                    ? "保存失败"
                    : "保存配置"}
              </button>
              <button className="button button--primary" onClick={handleStartGame}
              >
                开始游戏
              </button>
            </div>
          </header>

          <section className="config__body">
            <div className="config__panels">
              <div className="panel panel--providers">
                <div className="panel__title">API 提供商</div>
                <p className="panel__hint">
                  添加 API 协议、Key 与 Host，可用于多个 AI 玩家复用。
                </p>
                <div className="provider-list">
                  {aiConfig.providers.map((provider) => (
                    <div key={provider.id} className="provider-card">
                      <div className="provider-header">
                        <input
                          value={provider.name}
                          onChange={(event) =>
                            updateProvider(provider.id, { name: event.target.value })
                          }
                          placeholder="提供商名称"
                        />
                        <button
                          className="button button--ghost"
                          onClick={() => removeProvider(provider.id)}
                          disabled={aiConfig.providers.length <= 1}
                        >
                          删除
                        </button>
                      </div>
                      <div className="provider-grid">
                        <label>
                          API 协议
                          <select
                            value={provider.protocol}
                            onChange={(event) =>
                              updateProvider(provider.id, {
                                protocol: event.target.value as ApiProvider["protocol"],
                              })
                            }
                          >
                            <option value="responses">OpenAI Responses API</option>
                            <option value="chat_completions">
                              OpenAI Chat Completions API
                            </option>
                          </select>
                        </label>
                        <label>
                          API Host
                          <input
                            value={provider.baseUrl}
                            onChange={(event) =>
                              updateProvider(provider.id, { baseUrl: event.target.value })
                            }
                            placeholder="https://api.openai.com/v1"
                          />
                        </label>
                        <label>
                          API Key
                          <input
                            type="password"
                            value={provider.apiKey}
                            onChange={(event) =>
                              updateProvider(provider.id, { apiKey: event.target.value })
                            }
                            placeholder="sk-..."
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
                <button className="button button--secondary" onClick={addProvider}
                >
                  添加提供商
                </button>
              </div>

              <div className="panel panel--ai">
                <div className="panel__title">AI 玩家配置</div>
                <p className="panel__hint">
                  选择提供商与模型，系统会按 JSON 格式接收推理输出，仅显示最终发言。
                </p>
                <div className="ai-grid">
                  {aiConfig.aiPlayers.map((ai) => (
                    <div key={ai.id} className="ai-row">
                      <div className="ai-seat">
                        <span
                          className="ai-dot"
                          style={{
                            background: seatColors[ai.seat],
                          }}
                        />
                        <div>
                          <strong>{ai.name}</strong>
                          <span className="ai-seat-label">{seatLabels[ai.seat]}</span>
                        </div>
                      </div>
                      <div className="ai-controls">
                        <label>
                          提供商
                          <select
                            value={ai.providerId}
                            onChange={(event) =>
                              updateAiPlayer(ai.id, {
                                providerId: event.target.value,
                              })
                            }
                          >
                            {aiConfig.providers.map((provider) => (
                              <option key={provider.id} value={provider.id}>
                                {provider.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          模型
                          <input
                            value={ai.model}
                            onChange={(event) =>
                              updateAiPlayer(ai.id, { model: event.target.value })
                            }
                            placeholder="gpt-4.1-mini"
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : (
        <div className="game">
          <section className="table-panel">
            <header className="table-header">
              <div className="phase-panel">
                <div>
                  <span className="phase-title">{phaseInfo.name}</span>
                  <p className="phase-detail">{phaseInfo.detail}</p>
                </div>
                <div className="phase-meta">
                  <span>{phaseInfo.hint}</span>
                  <div className="phase-progress">
                    <span style={{ width: `${phaseProgress * 100}%` }} />
                  </div>
                </div>
              </div>
              <div className="table-header__actions">
                <button className="button button--ghost" onClick={handleReturnMenu}
                >
                  返回菜单
                </button>
                <button
                  className="button button--secondary"
                  onClick={() => setPaused(true)}
                >
                  暂停
                </button>
              </div>
            </header>

            <div className="table-scene">
              <div className="table-core">
                <div className="table-core__glow" />
                <div className="table-core__label">
                  <span>
                    票桌 · 第 {session?.day ?? 1} 日
                    {gameResult ? ` · ${gameResult}` : ""}
                  </span>
                  <strong>
                    {gameResult ? "对局已结束" : "请记录每个人的站位与逻辑"}
                  </strong>
                </div>
              </div>

                <div className="table-seats">
                  {displayPlayers.map((player) => (
                    <div
                      key={player.id}
                      className={[
                        "seat",
                        player.isHuman ? "seat--human" : "",
                        currentSpeaker === player.id ? "seat--speaking" : "",
                        showThinkingIndicators && thinkingSpeaker === player.id
                          ? "seat--thinking"
                          : "",
                        player.status === "死亡" ? "seat--dead" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    style={
                      {
                        ...seatPositions[player.seat],
                        "--seat-color": player.accent,
                      } as CSSProperties
                    }
                  >
                    <div className="seat__avatar">{player.name.slice(0, 1)}</div>
                    <div className="seat__body">
                      <span className="seat__name">
                        {player.name}
                        {player.isHuman && <span className="seat__you">你</span>}
                      </span>
                      <span className="seat__status" data-status={player.status}
                      >
                        {player.status}
                      </span>
                    </div>
                    {currentSpeaker === player.id && (
                      <span className="seat__tag">发言中</span>
                    )}
                      {showThinkingIndicators && thinkingSpeaker === player.id && (
                        <span
                          className={[
                            "seat__tag",
                            "seat__tag--ghost",
                            thinkingTagTopIds.has(player.id)
                              ? "seat__tag--top"
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          思考中
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                {phaseId === "night" && (
                  <div className="night-overlay">
                    <span>天黑请闭眼</span>
                  </div>
                )}
              </div>

            <div className="action-bar">
              <div className="action-card">
                <div>
                  <strong>投票目标</strong>
                  <p>点击座位或下方按钮选择对象，需要二次确认。</p>
                </div>
                <div className="action-grid">
                  {voteTargets.map((player) => (
                    <button
                      key={player.id}
                      className={[
                        "action-chip",
                        selectedVoteTarget === player.id ? "action-chip--active" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      disabled={player.disabled}
                      style={{ borderColor: player.accent }}
                      onClick={() => setSelectedVoteTarget(player.id)}
                    >
                      {player.name}
                    </button>
                  ))}
                </div>
                <div className="action-actions">
                  <button
                    className="button button--ghost"
                    disabled={!canVote}
                    onClick={handleAbstainVote}
                  >
                    弃票
                  </button>
                  <button
                    className="button button--primary"
                    disabled={!canVote || !selectedVoteTarget}
                    onClick={handleConfirmVote}
                  >
                    确认放逐
                  </button>
                </div>
              </div>
              <div
                className={[
                  "action-card",
                  canUseNight ? "" : "action-card--disabled",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div>
                  <strong>
                    {pendingAction?.type === "hunter" ? "猎人开枪" : "夜晚技能"}
                  </strong>
                  <p>
                    {pendingAction?.type === "night" ||
                    pendingAction?.type === "hunter"
                      ? "请选择目标后确认执行。"
                      : "当前阶段不可用，等待夜晚开始。"}
                  </p>
                </div>
                {pendingAction?.type === "night" ? (
                  <div className="night-action">
                    {pendingAction.role === "witch" ? (
                      <div className="night-options">
                        <label>
                          行动类型
                          <select
                            value={nightActionType}
                            onChange={(event) =>
                              setNightActionType(
                                event.target.value as "save" | "poison" | "none",
                              )
                            }
                            disabled={!canUseNight}
                          >
                            <option value="none">不行动</option>
                            <option value="save" disabled={!pendingAction.canSave}
                            >
                              使用解药
                            </option>
                            <option value="poison" disabled={!pendingAction.canPoison}
                            >
                              使用毒药
                            </option>
                          </select>
                        </label>
                        {nightActionType === "save" ? (
                          <div className="night-note">
                            今晚被刀：
                            {pendingAction.wolfTargetId
                              ? displayPlayers.find(
                                  (player) =>
                                    player.id === pendingAction.wolfTargetId,
                                )?.name ?? pendingAction.wolfTargetId
                              : "无人"}
                          </div>
                        ) : nightActionType === "poison" ? (
                          <label>
                            毒药目标
                            <select
                              value={nightTargetId ?? ""}
                              onChange={(event) => setNightTargetId(event.target.value)}
                              disabled={!canUseNight}
                            >
                              <option value="">请选择目标</option>
                              {nightTargets.map((player) => (
                                <option key={player.id} value={player.id}>
                                  {player.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                      </div>
                    ) : pendingAction.role === "seer" ? (
                      <label>
                        查验目标
                        <select
                          value={nightTargetId ?? ""}
                          onChange={(event) => setNightTargetId(event.target.value)}
                          disabled={!canUseNight}
                        >
                          <option value="">请选择目标</option>
                          {nightTargets.map((player) => (
                            <option key={player.id} value={player.id}>
                              {player.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : pendingAction.role === "werewolf" ? (
                      <div className="night-options">
                        <label>
                          狼刀目标
                          <select
                            value={nightTargetId ?? ""}
                            onChange={(event) => setNightTargetId(event.target.value)}
                            disabled={!canUseNight}
                          >
                            <option value="__none__">空刀</option>
                            {nightTargets
                              .filter(
                                (player) =>
                                  session?.roleAssignments[player.id] !== "werewolf",
                              )
                              .map((player) => (
                                <option key={player.id} value={player.id}>
                                  {player.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        {playerHasWolfChat && (
                          <label>
                            狼队夜聊
                            <textarea
                              value={wolfChatDraft}
                              onChange={(event) => setWolfChatDraft(event.target.value)}
                              maxLength={140}
                              placeholder="可选：给狼队的私密说明"
                            />
                          </label>
                        )}
                      </div>
                    ) : (
                      <div className="night-note">暂无可用技能。</div>
                    )}
                    <button
                      className="button button--primary"
                      disabled={!canUseNight}
                      onClick={handleConfirmNightAction}
                    >
                      确认执行
                    </button>
                  </div>
                ) : pendingAction?.type === "hunter" ? (
                  <div className="night-action">
                    <label>
                      枪击目标
                      <select
                        value={nightTargetId ?? ""}
                        onChange={(event) => setNightTargetId(event.target.value)}
                        disabled={!canUseNight}
                      >
                        <option value="__none__">不开枪</option>
                        {nightTargets.map((player) => (
                          <option key={player.id} value={player.id}>
                            {player.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="button button--primary"
                      disabled={!canUseNight}
                      onClick={handleConfirmHunter}
                    >
                      确认执行
                    </button>
                  </div>
                ) : (
                  <button className="button button--ghost" disabled>
                    确认执行
                  </button>
                )}
              </div>
            </div>
          </section>

          <aside className="chat-panel">
            <header className="chat-header">
              <div>
                <span className="chat-title">公共讨论</span>
                <p className="chat-subtitle">
                  发言将同步到所有玩家，注意字数限制。
                </p>
              </div>
              <div className="chat-phase">
                <span>阶段</span>
                <strong>{phaseInfo.name}</strong>
              </div>
            </header>

            <div className="chat-body" ref={chatBodyRef}>
              {publicLog.map((message) => (
                <div
                  key={message.id}
                  className={[
                    "chat-message",
                    message.speakerId === "system" ? "chat-message--system" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {message.speakerId === "system" ? (
                    <span>{message.text}</span>
                  ) : (
                    <>
                      <div className="chat-meta">
                        <span
                          className="chat-seat"
                          style={{
                            background:
                              displayPlayers.find(
                                (player) => player.id === message.speakerId,
                              )?.accent ?? "#94a3b8",
                          }}
                        />
                        <span className="chat-name">
                          {message.speakerName}
                          {message.speakerId === humanId && (
                            <span className="chat-you">你</span>
                          )}
                        </span>
                        <span className="chat-position">
                          {seatLabels[
                            displayPlayers.find(
                              (player) => player.id === message.speakerId,
                            )?.seat ?? "bottom-left"
                          ] ?? ""}
                        </span>
                      </div>
                      <p className="chat-text">{message.text}</p>
                    </>
                  )}
                </div>
              ))}
              {showScrollToLatest && (
                <button
                  type="button"
                  className="chat-scroll"
                  onClick={() => scrollChatToBottom("smooth")}
                  aria-label="滚动到最新"
                >
                  <svg
                    className="chat-scroll__icon"
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                  >
                    <path d="M10 4a1 1 0 0 1 1 1v6.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4.01 4a1 1 0 0 1-1.4 0l-4.01-4a1 1 0 1 1 1.4-1.42l2.3 2.3V5a1 1 0 0 1 1-1z" />
                  </svg>
                </button>
              )}
            </div>

            <div className="chat-input">
              <label>
                你的发言
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  maxLength={240}
                  placeholder="请输入你的推理与立场（仅一次发言）"
                  disabled={!canSpeak}
                />
              </label>
              <div className="chat-input__meta">
                <span className="chat-count">
                  {draft.length}/240
                </span>
                <button
                  className="button button--primary"
                  disabled={!canSpeak || draft.trim().length === 0}
                  onClick={handleSubmitSpeech}
                >
                  发言
                </button>
              </div>
            </div>

            <div
              className={[
                "private-panel",
                privateOpen ? "private-panel--open" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <button
                className="private-toggle"
                onClick={() => setPrivateOpen((open) => !open)}
              >
                {privateOpen ? "收起私密" : "展开私密"}
              </button>
              <div className="private-content">
                {session && (
                  <div className="role-card role-card--private">
                    <div className="role-card__header">
                      <span className="role-card__label">你的身份</span>
                      <strong>{humanRoleLabel}</strong>
                      {humanRoleTeam && (
                        <span className="role-card__team">{humanRoleTeam}</span>
                      )}
                    </div>
                    {humanRoleHint && (
                      <p className="role-card__hint">{humanRoleHint}</p>
                    )}
                    {humanRole === "werewolf" && wolfTeamNames.length > 0 && (
                      <p className="role-card__hint">
                        狼队同伴：{wolfTeamNames.join("、")}
                      </p>
                    )}
                  </div>
                )}
                <div className="private-section">
                  <h3>私密信息</h3>
                  <div className="private-log">
                    {humanPrivateMessages.length > 0 ? (
                      humanPrivateMessages.map((message) => (
                        <div key={message.id} className="private-message">
                          <span className="private-tag">
                            {message.channel === "role_prompt"
                              ? "身份提示"
                              : "主持人"}
                          </span>
                          <p className="private-text">{message.content}</p>
                        </div>
                      ))
                    ) : (
                      <p>暂无私密信息。</p>
                    )}
                  </div>
                </div>
                <div className="private-section">
                  <h3>狼人夜聊</h3>
                  {playerHasWolfChat ? (
                    <>
                      <div className="private-log">
                        {wolfChatMessages.length > 0 ? (
                          wolfChatMessages.map((message) => (
                            <div key={message.id} className="private-message">
                              <span className="private-tag">{message.from}</span>
                              <p className="private-text">{message.content}</p>
                            </div>
                          ))
                        ) : (
                          <p>暂无夜聊内容。</p>
                        )}
                      </div>
                      <label className="private-input">
                        夜聊输入
                        <textarea
                          value={wolfChatDraft}
                          onChange={(event) => setWolfChatDraft(event.target.value)}
                          maxLength={140}
                          placeholder="写给狼队的私密信息"
                          disabled={phaseId !== "night" || paused}
                        />
                      </label>
                      <button
                        className="button button--ghost"
                        disabled={phaseId !== "night" || paused}
                        onClick={() => {
                          if (wolfChatDraft.trim()) {
                            addWolfChat(humanId, wolfChatDraft.trim());
                            setWolfChatDraft("");
                          }
                        }}
                      >
                        发送夜聊
                      </button>
                    </>
                  ) : (
                    <p>仅狼人可见。</p>
                  )}
                </div>
              </div>
            </div>
          </aside>
            {paused && (
              <div className="pause-overlay">
                <div className="pause-card">
                <span className="pause-badge">对局已暂停</span>
                <h2>暂时停下</h2>
                <p>阶段推进与计时已暂停，点击继续返回牌桌。</p>
                <div className="pause-actions">
                  <button
                    className="button button--primary"
                    onClick={() => setPaused(false)}
                  >
                    继续对局
                  </button>
                  <button className="button button--ghost" onClick={handleReturnMenu}
                  >
                    返回菜单
                  </button>
                </div>
                </div>
              </div>
            )}
            {voteSummaryOpen && (
              <div className="vote-overlay">
                <div className="vote-card">
                  <span className="vote-badge">投票票型</span>
                  <h3>本轮投票明细</h3>
                  <div className="vote-list">
                    {voteSummary.map((item) => (
                      <div key={item} className="vote-item">
                        {item}
                      </div>
                    ))}
                  </div>
                  <div className="vote-actions">
                    <button
                      className="button button--primary"
                      onClick={() => setVoteSummaryOpen(false)}
                    >
                      知道了
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
    </div>
  );
}

export default App;
