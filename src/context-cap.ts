import {
  logger,
  type IAgentRuntime,
  type Memory,
  type Provider,
} from "@elizaos/core";

/*
 * 2026-10-24: cap the conversation history in eliza-gemma's reply prompts.
 *
 * Every Colony mention is stored as a memory that repeats the whole post body, and
 * plugin-bootstrap's RECENT_MESSAGES provider puts the room's newest 32 memories into
 * each reply prompt (and, through its values, into the reply and reflection prompts).
 * In the busiest post rooms that history reached 297,938 characters. Ollama then cut
 * the prompt to its 16,387-token limit FROM THE FRONT (41 cuts over the nights of
 * 21-24 Oct, prompts of 33,185-78,297 tokens), so gemma never saw the start of its own
 * instructions.
 *
 * Fit on room c5b69ee1's eight cut prompts (R^2 0.9965): about 4.46 characters per
 * token, and about 4,870 tokens of prompt outside the history and the received
 * message. 32,000 characters for history plus received message keeps a reply prompt
 * near 12,000 tokens.
 *
 * RECENT_MESSAGES gets a view of the runtime whose history read for the message's own
 * room is trimmed. Nothing is written: the stored memories are unchanged, and no other
 * reader sees the trimmed view. GEMMA_CONTEXT_CAP=off turns it off.
 */

export const HISTORY_AND_RECEIVED_BUDGET = 32_000;
export const MIN_HISTORY_BUDGET = 4_000;
export const PER_ENTRY_CAP = 2_000;
// formatPosts adds Name / MessageID / In reply to / Source / Date lines to every entry.
export const PER_ENTRY_OVERHEAD = 200;
const SHARED_PREFIX_MIN = 200;
const MARK = Symbol.for("eliza-gemma.context-cap");

export function sharedPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

/** One history entry's text: the start it shares with the received message (the post, often more) cut to a note, then capped. */
export function trimEntry(text: string, received: string, isReceived: boolean): string {
  let out = text;
  if (!isReceived) {
    const shared = sharedPrefixLength(text, received);
    if (shared >= SHARED_PREFIX_MIN) {
      const lineEnd = text.lastIndexOf("\n", shared - 1);
      const cut = lineEnd >= SHARED_PREFIX_MIN ? lineEnd + 1 : shared;
      out = `[first ${cut} characters cut: the same as the start of the received message]\n${text.slice(cut)}`;
    }
  }
  if (out.length > PER_ENTRY_CAP) {
    const note = isReceived ? "; the full text is under # Received Message" : "";
    out = `${out.slice(0, PER_ENTRY_CAP)} [… ${out.length - PER_ENTRY_CAP} more characters cut${note}]`;
  }
  return out;
}

function isActionResult(m: Memory): boolean {
  return m.content?.type === "action_result" && (m.metadata as { type?: string } | undefined)?.type === "action_result";
}

/** The room history RECENT_MESSAGES will format: entries trimmed, then the newest kept until the budget is spent. */
export function capRoomHistory(memories: Memory[], message: Memory): Memory[] {
  const received = typeof message.content?.text === "string" ? message.content.text : "";
  let budget = Math.max(MIN_HISTORY_BUDGET, HISTORY_AND_RECEIVED_BUDGET - received.length);
  const trimmed = memories.map((m) => {
    if (isActionResult(m) || typeof m.content?.text !== "string") return m;
    return { ...m, content: { ...m.content, text: trimEntry(m.content.text, received, m.id === message.id) } };
  });
  const newestFirst = [...trimmed].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const keep = new Set<Memory>();
  for (const m of newestFirst) {
    if (isActionResult(m)) {
      keep.add(m);
      continue;
    }
    const cost = (typeof m.content?.text === "string" ? m.content.text.length : 0) + PER_ENTRY_OVERHEAD;
    if (keep.size > 0 && cost > budget) break;
    keep.add(m);
    budget -= cost;
  }
  return trimmed.filter((m) => keep.has(m));
}

/** The runtime as RECENT_MESSAGES should see it for one message: its own room's history read is capped. */
export function cappedView(runtime: IAgentRuntime, message: Memory): IAgentRuntime {
  return new Proxy(runtime, {
    get(target, prop) {
      if (prop === "getMemories") {
        return async (params: Parameters<IAgentRuntime["getMemories"]>[0]) => {
          const rows = await target.getMemories(params);
          if (params?.tableName !== "messages" || params?.roomId !== message.roomId) return rows;
          const capped = capRoomHistory(rows, message);
          const before = rows.reduce((n, m) => n + (m.content?.text?.length ?? 0), 0);
          const after = capped.reduce((n, m) => n + (m.content?.text?.length ?? 0), 0);
          if (after < before) {
            logger.info(
              `context cap: room ${String(message.roomId).slice(0, 8)} history ${rows.length} entries / ${before} chars -> ${capped.length} / ${after}`,
            );
          }
          return capped;
        };
      }
      // Bind to the real runtime: its methods read private fields that a Proxy receiver lacks.
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** Wrap the registered RECENT_MESSAGES provider. Returns whether the cap is in place. */
export function installContextCap(runtime: IAgentRuntime): boolean {
  if ((process.env.GEMMA_CONTEXT_CAP ?? "").trim().toLowerCase() === "off") {
    logger.warn("context cap: GEMMA_CONTEXT_CAP=off, reply prompts are NOT capped");
    return false;
  }
  const provider = runtime.providers.find((p) => p.name === "RECENT_MESSAGES") as
    | (Provider & { [MARK]?: true })
    | undefined;
  if (!provider) {
    logger.warn("context cap: no RECENT_MESSAGES provider registered, reply prompts are NOT capped");
    return false;
  }
  if (provider[MARK]) return true;
  const original = provider.get.bind(provider);
  provider.get = (rt, message, state) => original(cappedView(rt, message), message, state);
  provider[MARK] = true;
  logger.info(
    `context cap: installed on RECENT_MESSAGES (history + received ≤ ${HISTORY_AND_RECEIVED_BUDGET} chars, ≥ ${MIN_HISTORY_BUDGET} for history, ≤ ${PER_ENTRY_CAP} per entry)`,
  );
  return true;
}
