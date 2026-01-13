import type {
  AgentMessage,
  PhaseId,
  PlayerPublicState,
  PublicMessage,
  PrivateMessage,
} from "./types";

export const phaseLabels: Record<PhaseId, string> = {
  night: "夜晚",
  day: "白天",
  discussion: "发言",
  voting: "投票",
  resolution: "结算",
};

const phaseOrder: PhaseId[] = [
  "night",
  "day",
  "discussion",
  "voting",
  "resolution",
];

export type PublicContextPayload = {
  day: number;
  self: {
    id: string;
    name: string;
    seat: string;
    status: string;
  } | null;
  phase: {
    id: PhaseId;
    name: string;
  };
  phaseOrder: PhaseId[];
  phaseRule: string;
  players: Array<{
    id: string;
    name: string;
    seat: string;
    status: string;
    revealedRole: string | null;
  }>;
  publicLog: Array<{
    day: number;
    phaseId: PhaseId;
    phase: string;
    speakerId: string;
    speakerName: string;
    text: string;
  }>;
};

export type PrivateContextPayload = {
  privateMessages: Array<{
    channel: string;
    from: string;
    content: string;
    day: number;
    phase: string;
  }>;
};

export const buildPublicContextPayload = (params: {
  day: number;
  phaseId: PhaseId;
  players: PlayerPublicState[];
  publicLog: PublicMessage[];
  revealedRoles?: Record<string, string | null>;
  self?: PlayerPublicState | null;
}): PublicContextPayload => ({
  day: params.day,
  self: params.self
    ? {
        id: params.self.id,
        name: params.self.name,
        seat: params.self.seat,
        status: params.self.status,
      }
    : null,
  phase: {
    id: params.phaseId,
    name: phaseLabels[params.phaseId],
  },
  phaseOrder,
  phaseRule:
    "夜晚行动先于白天发言；白天才公开的跳身份不会影响已结束的夜晚选择。",
  players: params.players.map((player) => ({
    id: player.id,
    name: player.name,
    seat: player.seat,
    status: player.status,
    revealedRole: params.revealedRoles?.[player.id] ?? null,
  })),
  publicLog: params.publicLog.map((message) => ({
    day: message.day,
    phaseId: message.phaseId,
    phase: phaseLabels[message.phaseId],
    speakerId: message.speakerId,
    speakerName: message.speakerName,
    text: message.text,
  })),
});

export const buildPrivateContextPayload = (
  privateMessages: PrivateMessage[],
): PrivateContextPayload => ({
  privateMessages: privateMessages.map((message) => ({
    channel: message.channel,
    from: message.from,
    content: message.content,
    day: message.day,
    phase: phaseLabels[message.phaseId],
  })),
});

export const buildPublicContextMessage = (
  payload: PublicContextPayload,
): AgentMessage => ({
  role: "user",
  content: (() => {
    const revealSummary = payload.players
      .filter((player) => player.revealedRole)
      .map((player) => `${player.name}=${player.revealedRole}`)
      .join("、");
    return [
      "以下是当前公开信息（JSON）。publicLog 的每条记录都包含 speakerName/speakerId；你的发言应对应 self.id。",
      `公开身份列表：${revealSummary || "无"}`,
      "players[].revealedRole 为已公开身份（死亡/翻牌）。",
      "请按 phaseOrder 与 publicLog 中的 day/phase 判断先后顺序，不要用白天才出现的信息反推已结束夜晚。",
      "你只能基于这些公开信息与私密信息行动：",
      JSON.stringify(payload, null, 2),
    ].join("\n");
  })(),
});

export const buildPrivateContextMessage = (
  payload: PrivateContextPayload,
): AgentMessage => ({
  role: "user",
  content: [
    "以下是你收到的私密信息（JSON）。不得向其他玩家泄露：",
    JSON.stringify(payload, null, 2),
  ].join("\n"),
});
