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

export type PublicContextPayload = {
  day: number;
  phase: {
    id: PhaseId;
    name: string;
  };
  players: Array<{
    id: string;
    name: string;
    seat: string;
    status: string;
  }>;
  publicLog: Array<{
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
}): PublicContextPayload => ({
  day: params.day,
  phase: {
    id: params.phaseId,
    name: phaseLabels[params.phaseId],
  },
  players: params.players.map((player) => ({
    id: player.id,
    name: player.name,
    seat: player.seat,
    status: player.status,
  })),
  publicLog: params.publicLog.map((message) => ({
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
  content: [
    "以下是当前公开信息（JSON）。你只能基于这些公开信息与私密信息行动：",
    JSON.stringify(payload, null, 2),
  ].join("\n"),
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
