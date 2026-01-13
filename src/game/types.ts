export type SeatId =
  | "top-left"
  | "top-mid-left"
  | "top-mid-right"
  | "top-right"
  | "right-top"
  | "right-bottom"
  | "bottom-right"
  | "bottom-mid-right"
  | "bottom-mid-left"
  | "bottom-left"
  | "left-bottom"
  | "left-top";

export type PlayerStatus = "存活" | "死亡" | "禁投";

export type ApiProtocol = "responses" | "completions" | "chat_completions";

export type ApiProvider = {
  id: string;
  name: string;
  protocol: ApiProtocol;
  baseUrl: string;
  apiKey: string;
};

export type AiPlayerConfig = {
  id: string;
  name: string;
  seat: SeatId;
  providerId: string;
  model: string;
};

export type AiProfile = {
  id: string;
  name: string;
  seat: SeatId;
  providerId: string;
  model: string;
  protocol: ApiProtocol;
  baseUrl: string;
  apiKey: string;
};

export type Role =
  | "werewolf"
  | "seer"
  | "witch"
  | "hunter"
  | "idiot"
  | "villager";

export type ActorRole = Role | "moderator";

export type PhaseId = "night" | "day" | "discussion" | "voting" | "resolution";

export type PlayerPublicState = {
  id: string;
  name: string;
  seat: SeatId;
  status: PlayerStatus;
};

export type PublicMessage = {
  id: string;
  day: number;
  phaseId: PhaseId;
  speakerId: string;
  speakerName: string;
  text: string;
};

export type PrivateChannel = "moderator" | "wolf_chat" | "role_prompt";

export type PrivateMessage = {
  id: string;
  channel: PrivateChannel;
  day: number;
  phaseId: PhaseId;
  from: string;
  to: string;
  content: string;
};

export type AgentMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AgentOutput = {
  type: "speech" | "vote" | "night_action" | "wolf_chat";
  content: string;
  target: string | null;
  confidence: number;
  notes: string;
};

export type AgentThread = {
  id: string;
  name: string;
  role: ActorRole;
  systemPrompt: string;
  messages: AgentMessage[];
  privateMessages: PrivateMessage[];
};

export type WitchState = {
  antidoteUsed: boolean;
  poisonUsed: boolean;
};

export type GameSession = {
  id: string;
  day: number;
  phaseId: PhaseId;
  players: PlayerPublicState[];
  publicLog: PublicMessage[];
  roleAssignments: Record<string, Role>;
  agents: Record<string, AgentThread>;
  aiProfiles: Record<string, AiProfile>;
  wolfChat: PrivateMessage[];
  moderator: AgentThread;
  witchState: WitchState;
  idiotRevealed: Record<string, boolean>;
  hunterShotUsed: boolean;
};
