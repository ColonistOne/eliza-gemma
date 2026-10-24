// bun test — the 2026-10-24 reply-history cap (src/context-cap.ts).
import { afterEach, expect, test } from "bun:test";
import type { IAgentRuntime, Memory } from "@elizaos/core";
import {
  HISTORY_AND_RECEIVED_BUDGET,
  MIN_HISTORY_BUDGET,
  PER_ENTRY_CAP,
  PER_ENTRY_OVERHEAD,
  capRoomHistory,
  cappedView,
  installContextCap,
  trimEntry,
} from "../src/context-cap";

const ROOM = "c5b69ee1-0000-0000-0000-000000000000";
const OTHER = "688980fc-0000-0000-0000-000000000000";
const POST = "A long post title\n\n" + "The post body, paragraph after paragraph.\n".repeat(360); // ~15k chars

let t = 1_000;
function mention(n: number, room = ROOM): Memory {
  const text = `${POST}\n\n🎯 REPLY TARGET — your reply will be cast under THIS comment:\n@peer: comment number ${n}. ${"x".repeat(1_500)}\n\nOther comments: ${"y".repeat(900)}`;
  return { id: `m-${n}-${room.slice(0, 4)}`, entityId: "peer", agentId: "agent", roomId: room, content: { text, source: "colony" }, createdAt: t++ } as unknown as Memory;
}
function reply(n: number): Memory {
  return { id: `r-${n}`, entityId: "agent", agentId: "agent", roomId: ROOM, content: { text: `my reply ${n} `.repeat(90), source: "colony", inReplyTo: `m-${n}` }, createdAt: t++ } as unknown as Memory;
}
/** A room shaped like c5b69ee1 on 24 Oct: 16 mentions repeating a ~15k-char post, each followed by eliza's reply. */
function heavyRoom(): { rows: Memory[]; received: Memory } {
  const rows: Memory[] = [];
  for (let n = 0; n < 16; n++) rows.push(mention(n), reply(n));
  const received = mention(16);
  rows.push(received);
  return { rows: rows.reverse(), received }; // getMemories returns newest first
}
const chars = (ms: Memory[]) => ms.reduce((s, m) => s + (m.content.text?.length ?? 0), 0);

afterEach(() => {
  delete process.env.GEMMA_CONTEXT_CAP;
});

test("an older mention loses the start it shares with the received message, and keeps its own part", () => {
  const older = mention(1).content.text!;
  const out = trimEntry(older, mention(2).content.text!, false);
  const cut = Number(/^\[first (\d+) characters cut: the same as the start of the received message\]\n/.exec(out)?.[1]);
  expect(cut).toBeGreaterThan(POST.length); // the post, and the identical target header after it
  expect(older.slice(0, cut)).toBe(mention(2).content.text!.slice(0, cut)); // the note is true
  expect(out).toContain("comment number 1");
  expect(out).not.toContain("paragraph after paragraph");
});

test("the received message's own history entry is capped, with a pointer to the full text", () => {
  const text = mention(3).content.text!;
  const out = trimEntry(text, text, true);
  expect(out.length).toBeLessThan(PER_ENTRY_CAP + 120);
  expect(out).toContain("the full text is under # Received Message");
});

test("unrelated short text passes through unchanged", () => {
  expect(trimEntry("a short DM", POST, false)).toBe("a short DM");
});

test("a room like c5b69ee1 is cut from ~300k characters to the budget, newest entries kept", () => {
  const { rows, received } = heavyRoom();
  expect(chars(rows)).toBeGreaterThan(250_000);
  const capped = capRoomHistory(rows, received);
  const budget = Math.max(MIN_HISTORY_BUDGET, HISTORY_AND_RECEIVED_BUDGET - received.content.text!.length);
  expect(chars(capped) + capped.length * PER_ENTRY_OVERHEAD).toBeLessThanOrEqual(budget + PER_ENTRY_CAP);
  expect(capped[0].id).toBe(received.id); // order kept, newest first
  expect(capped.map((m) => m.id)).toContain("r-15"); // the latest reply survives
  expect(capped.map((m) => m.id)).not.toContain("m-0"); // the oldest mention does not
  // The estimate the budget was set from: ~4,870 tokens + (history + received) / 4.46.
  const estTokens = 4_870 + (chars(capped) + received.content.text!.length) / 4.46;
  expect(estTokens).toBeLessThan(13_000);
});

test("nothing is written: the stored rows are untouched", () => {
  const { rows, received } = heavyRoom();
  const before = rows.map((m) => m.content.text);
  capRoomHistory(rows, received);
  expect(rows.map((m) => m.content.text)).toEqual(before);
});

test("a small room is not trimmed at all", () => {
  const rows = [reply(1), reply(2)];
  expect(capRoomHistory(rows, { id: "x", roomId: ROOM, content: { text: "hi" } } as unknown as Memory)).toEqual(rows);
});

class FakeRuntime {
  #conversationLength = 32;
  providers: { name: string; get: (rt: IAgentRuntime, m: Memory, s: unknown) => Promise<unknown> }[] = [];
  reads: unknown[] = [];
  constructor(private store: Record<string, Memory[]>) {}
  getConversationLength() {
    return this.#conversationLength;
  }
  async getMemories(params: { tableName: string; roomId?: string; count?: number }) {
    this.reads.push(params);
    return params.tableName === "messages" ? (this.store[params.roomId ?? ""] ?? []) : [mention(99)];
  }
}

test("the view caps only the message's own room, only for messages, and keeps private-field methods working", async () => {
  const { rows, received } = heavyRoom();
  const other = [mention(1, OTHER), mention(2, OTHER)];
  const rt = new FakeRuntime({ [ROOM]: rows, [OTHER]: other });
  const view = cappedView(rt as unknown as IAgentRuntime, received);
  expect(view.getConversationLength()).toBe(32); // would throw on a Proxy receiver without the bind
  expect(chars(await view.getMemories({ tableName: "messages", roomId: ROOM, count: 32 }))).toBeLessThan(40_000);
  expect(await view.getMemories({ tableName: "messages", roomId: OTHER, count: 32 })).toEqual(other);
  expect(chars(await view.getMemories({ tableName: "facts", roomId: ROOM, count: 30 }))).toBe(mention(99).content.text!.length);
});

test("install wraps RECENT_MESSAGES so its get sees the capped view; installing twice wraps once", async () => {
  const { rows, received } = heavyRoom();
  const rt = new FakeRuntime({ [ROOM]: rows });
  let seen = 0;
  rt.providers.push({
    name: "RECENT_MESSAGES",
    get: async (r) => {
      seen = chars(await r.getMemories({ tableName: "messages", roomId: ROOM, count: r.getConversationLength() }));
      return { text: "" };
    },
  });
  expect(installContextCap(rt as unknown as IAgentRuntime)).toBe(true);
  const wrapped = rt.providers[0].get;
  expect(installContextCap(rt as unknown as IAgentRuntime)).toBe(true);
  expect(rt.providers[0].get).toBe(wrapped); // a second install does not wrap again
  await rt.providers[0].get(rt as unknown as IAgentRuntime, received, {});
  expect(seen).toBeGreaterThan(0);
  expect(seen).toBeLessThan(40_000);
  expect(rt.reads.length).toBe(1);
});

test("GEMMA_CONTEXT_CAP=off leaves the provider alone", async () => {
  process.env.GEMMA_CONTEXT_CAP = "off";
  const rt = new FakeRuntime({});
  const get = async () => ({ text: "" });
  rt.providers.push({ name: "RECENT_MESSAGES", get });
  expect(installContextCap(rt as unknown as IAgentRuntime)).toBe(false);
  expect(rt.providers[0].get).toBe(get);
});

test("no RECENT_MESSAGES provider: reports not installed", () => {
  expect(installContextCap(new FakeRuntime({}) as unknown as IAgentRuntime)).toBe(false);
});
