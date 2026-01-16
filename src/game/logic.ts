import type { PlayerPublicState, SeatId } from "./types";

const PUNCTUATION_REGEX = /[，,。.?!！？、:：;；"'“”‘’()（）[\]{}<>《》【】]/g;

const normalizeComparable = (value: string) =>
  value.replace(/\s+/g, "").replace(PUNCTUATION_REGEX, "").toLowerCase();

const seatAliasMap: Record<string, SeatId> = {
  "左上": "top-left",
  "上左": "top-mid-left",
  "上右": "top-mid-right",
  "右上": "top-right",
  "右侧上": "right-top",
  "右侧下": "right-bottom",
  "右下": "bottom-right",
  "下右": "bottom-mid-right",
  "下左": "bottom-mid-left",
  "左下": "bottom-left",
  "左侧下": "left-bottom",
  "左侧上": "left-top",
};

export const getAlivePlayers = (players: PlayerPublicState[]) =>
  players.filter((player) => player.status !== "死亡");

export const getEligibleVoters = (players: PlayerPublicState[]) =>
  players.filter((player) => player.status === "存活");

export const resolveTargetId = (
  players: PlayerPublicState[],
  target: string | null,
  roster: PlayerPublicState[] = players,
): string | null => {
  if (!target) {
    return null;
  }
  const normalized = target.trim();
  if (!normalized) {
    return null;
  }
  const condensed = normalized.replace(/\s+/g, "");
  const cleaned = normalizeComparable(condensed);
  const condensedLower = condensed.toLowerCase();
  const byId = players.find((player) => {
    const id = player.id.toLowerCase();
    return id === condensedLower || id === cleaned;
  });
  if (byId) {
    return byId.id;
  }
  const byName = players.find(
    (player) => normalizeComparable(player.name) === cleaned,
  );
  if (byName) {
    return byName.id;
  }
  const seatAlias = seatAliasMap[cleaned];
  if (seatAlias) {
    const seatMatch = players.find((player) => player.seat === seatAlias);
    if (seatMatch) {
      return seatMatch.id;
    }
  }
  const seatMatch = players.find((player) => {
    const seat = player.seat.toLowerCase();
    return (
      seat === condensed.toLowerCase() ||
      seat.replace(/[-_]/g, "") === cleaned
    );
  });
  if (seatMatch) {
    return seatMatch.id;
  }
  const byPrefix = players.filter((player) =>
    normalizeComparable(player.name).startsWith(cleaned),
  );
  if (byPrefix.length === 1) {
    return byPrefix[0].id;
  }
  const numberMatch = condensed.match(/\d+/);
  if (numberMatch && !/[a-z]/i.test(condensed)) {
    const seatNumber = Number(numberMatch[0]);
    if (Number.isFinite(seatNumber) && seatNumber >= 1) {
      const rosterTarget = roster[seatNumber - 1];
      if (rosterTarget && players.some((player) => player.id === rosterTarget.id)) {
        return rosterTarget.id;
      }
    }
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
