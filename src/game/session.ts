import type {
  AgentMessage,
  AgentThread,
  AiPlayerConfig,
  ApiProvider,
  GameSession,
  PhaseId,
  PlayerPublicState,
  PrivateMessage,
  Role,
} from "./types";
import {
  buildModeratorSystemPrompt,
  buildPlayerSystemPrompt,
  buildRolePrompt,
} from "./prompts";
import {
  buildPrivateContextMessage,
  buildPrivateContextPayload,
  buildPublicContextMessage,
  buildPublicContextPayload,
} from "./context";

const ROLE_SEQUENCE: Role[] = [
  "werewolf",
  "werewolf",
  "werewolf",
  "werewolf",
  "seer",
  "witch",
  "hunter",
  "idiot",
  "villager",
  "villager",
  "villager",
  "villager",
];

const ROLE_PUBLIC_LABELS: Record<Role, string> = {
  werewolf: "狼人",
  seer: "预言家",
  witch: "女巫",
  hunter: "猎人",
  idiot: "白痴",
  villager: "平民",
};

const createId = () =>
  `id_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;

const shuffle = <T,>(items: T[]) => {
  const array = [...items];
  for (let index = array.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [array[index], array[swapIndex]] = [array[swapIndex], array[index]];
  }
  return array;
};

export const assignRoles = (
  players: PlayerPublicState[],
  overrides: Record<string, Role> = {},
) => {
  const rolePool = shuffle(ROLE_SEQUENCE);
  const assignments: Record<string, Role> = {};
  players.forEach((player, index) => {
    assignments[player.id] =
      overrides[player.id] ?? rolePool[index] ?? "villager";
  });
  return assignments;
};

const createRoleMessage = (params: {
  playerId: string;
  role: Role;
  day: number;
  phaseId: PhaseId;
  wolfTeamList: string[];
}): PrivateMessage => ({
  id: createId(),
  channel: "role_prompt",
  day: params.day,
  phaseId: params.phaseId,
  from: "moderator",
  to: params.playerId,
  content: buildRolePrompt(params.role, {
    wolfTeamList: params.wolfTeamList,
  }),
});

export const createGameSession = (params: {
  players: PlayerPublicState[];
  aiPlayers: AiPlayerConfig[];
  providers: ApiProvider[];
  day?: number;
  phaseId?: PhaseId;
  roleOverrides?: Record<string, Role>;
}): GameSession => {
  const day = params.day ?? 1;
  const phaseId = params.phaseId ?? "night";
  const roleAssignments = assignRoles(params.players, params.roleOverrides);
  const wolfTeamList = params.players
    .filter((player) => roleAssignments[player.id] === "werewolf")
    .map((player) => player.name);

  const providerById = new Map(
    params.providers.map((provider) => [provider.id, provider]),
  );
  const fallbackProvider = params.providers[0];

  const aiProfiles = params.aiPlayers.reduce<GameSession["aiProfiles"]>(
    (acc, ai) => {
      const provider = providerById.get(ai.providerId) ?? fallbackProvider;
      acc[ai.id] = {
        id: ai.id,
        name: ai.name,
        seat: ai.seat,
        providerId: provider?.id ?? ai.providerId,
        model: ai.model,
        protocol: provider?.protocol ?? "responses",
        baseUrl: provider?.baseUrl ?? "",
        apiKey: provider?.apiKey ?? "",
      };
      return acc;
    },
    {},
  );

  const agents = params.players.reduce<Record<string, AgentThread>>(
    (acc, player) => {
      const role = roleAssignments[player.id] ?? "villager";
      const privateMessages = [
        createRoleMessage({
          playerId: player.id,
          role,
          day,
          phaseId,
          wolfTeamList,
        }),
      ];

      acc[player.id] = {
        id: player.id,
        name: player.name,
        role,
        systemPrompt: buildPlayerSystemPrompt(),
        messages: [],
        privateMessages,
      };
      return acc;
    },
    {},
  );

  const moderator: AgentThread = {
    id: "moderator",
    name: "主持人",
    role: "moderator",
    systemPrompt: buildModeratorSystemPrompt(),
    messages: [],
    privateMessages: [],
  };

  return {
    id: createId(),
    day,
    phaseId,
    players: params.players,
    publicLog: [],
    roleAssignments,
    agents,
    aiProfiles,
    wolfChat: [],
    moderator,
    witchState: {
      antidoteUsed: false,
      poisonUsed: false,
    },
    idiotRevealed: {},
    hunterShotUsed: false,
  };
};

export const buildAgentTurnMessages = (
  session: GameSession,
  agentId: string,
): AgentMessage[] => {
  const agent = session.agents[agentId];
  if (!agent) {
    return [];
  }

  const privateMessages =
    agent.role === "werewolf"
      ? [...agent.privateMessages, ...session.wolfChat]
      : agent.privateMessages;
  const revealedRoles: Record<string, string | null> = {};
  session.players.forEach((player) => {
    if (player.status === "死亡" || session.idiotRevealed[player.id]) {
      const role = session.roleAssignments[player.id];
      revealedRoles[player.id] = role ? ROLE_PUBLIC_LABELS[role] ?? role : null;
    }
  });
  const selfPlayer = session.players.find((player) => player.id === agentId) ?? null;
  const publicPayload = buildPublicContextPayload({
    day: session.day,
    phaseId: session.phaseId,
    players: session.players,
    publicLog: session.publicLog,
    revealedRoles,
    self: selfPlayer,
  });
  const privatePayload = buildPrivateContextPayload(privateMessages);

  return [
    { role: "system", content: agent.systemPrompt },
    ...agent.messages,
    buildPrivateContextMessage(privatePayload),
    buildPublicContextMessage(publicPayload),
  ];
};

export const pushAgentMessage = (
  session: GameSession,
  agentId: string,
  message: AgentMessage,
) => {
  const agent = session.agents[agentId];
  if (!agent) {
    return;
  }
  agent.messages.push(message);
};

export const pushPrivateMessage = (
  session: GameSession,
  agentId: string,
  message: PrivateMessage,
) => {
  const agent = session.agents[agentId];
  if (!agent) {
    return;
  }
  agent.privateMessages.push(message);
};

export const pushWolfChatMessage = (
  session: GameSession,
  message: PrivateMessage,
) => {
  session.wolfChat.push(message);
};

export const pushPublicMessage = (
  session: GameSession,
  message: {
    id: string;
    day: number;
    phaseId: PhaseId;
    speakerId: string;
    speakerName: string;
    text: string;
  },
) => {
  session.publicLog.push(message);
};
