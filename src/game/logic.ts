import type { PlayerPublicState } from "./types";

export const getAlivePlayers = (players: PlayerPublicState[]) =>
  players.filter((player) => player.status !== "死亡");

export const getEligibleVoters = (players: PlayerPublicState[]) =>
  players.filter((player) => player.status === "存活");

export const resolveTargetId = (
  players: PlayerPublicState[],
  target: string | null,
): string | null => {
  if (!target) {
    return null;
  }
  const normalized = target.trim();
  const byId = players.find((player) => player.id === normalized);
  if (byId) {
    return byId.id;
  }
  const byName = players.find((player) => player.name === normalized);
  if (byName) {
    return byName.id;
  }
  const byPrefix = players.filter((player) =>
    player.name.startsWith(normalized),
  );
  if (byPrefix.length === 1) {
    return byPrefix[0].id;
  }
  return null;
};

export const pickMajorityTarget = (
  votes: Array<string | null>,
  seatOrder: string[],
): string | null => {
  if (votes.length === 0) {
    return null;
  }
  const tally = new Map<string, number>();
  let nullCount = 0;
  votes.forEach((vote) => {
    if (!vote) {
      nullCount += 1;
      return;
    }
    tally.set(vote, (tally.get(vote) ?? 0) + 1);
  });
  if (tally.size === 0) {
    return null;
  }
  const max = Math.max(0, ...Array.from(tally.values()), nullCount);
  const topTargets = Array.from(tally.entries())
    .filter(([, count]) => count === max)
    .map(([target]) => target);

  if (nullCount === max) {
    return null;
  }
  if (topTargets.length <= 1) {
    return topTargets[0] ?? null;
  }

  for (const seatId of seatOrder) {
    if (topTargets.includes(seatId)) {
      return seatId;
    }
  }

  return topTargets[0] ?? null;
};

export const resolveVoteOutcome = (
  votes: Record<string, string | null>,
  seatOrder: string[],
): { targetId: string | null; isTie: boolean } => {
  const tally = new Map<string, number>();
  Object.values(votes).forEach((vote) => {
    if (!vote) {
      return;
    }
    tally.set(vote, (tally.get(vote) ?? 0) + 1);
  });
  if (tally.size === 0) {
    return { targetId: null, isTie: true };
  }
  const max = Math.max(...Array.from(tally.values()));
  const topTargets = Array.from(tally.entries())
    .filter(([, count]) => count === max)
    .map(([target]) => target);
  if (topTargets.length !== 1) {
    return { targetId: null, isTie: true };
  }

  const targetId = topTargets[0];
  if (!seatOrder.includes(targetId)) {
    return { targetId, isTie: false };
  }
  return { targetId, isTie: false };
};
