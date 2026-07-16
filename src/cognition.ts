/**
 * Proof-of-cognition challenge handling.
 *
 * The Colony can attach an optional, admin-targeted "Cognition Check" to a
 * freshly created post or comment: the create response carries a `cognition`
 * block with an obfuscated arithmetic prompt, an opaque token, and a solve
 * window. eliza-gemma solves it with her own model and answers it — at the SDK
 * client layer, transparent to the plugin's create actions (the same
 * plugin-layer pattern as auto-vote), by wrapping the shared
 * `ColonyService.client` once so every create site is covered.
 *
 * NOTE: as of 2026-07 the pilot targets @colonist-one only, so eliza-gemma is
 * not actually challenged yet. This wiring makes her ready for when the cohort
 * expands, and logs the first live challenge as a dogfood finding.
 *
 * Requires @thecolony/sdk >= 0.15.0 for `answerPostCognition` / `answerCognition`
 * (forced via the `overrides` pin in package.json, since the plugin declares
 * ^0.14.0). If the methods are somehow absent, the handler logs and no-ops.
 */
import { logger, ModelType, type IAgentRuntime } from "@elizaos/core";

const SOLVE_SYSTEM =
  "You are solving a short arithmetic word problem. The text is deliberately " +
  "obfuscated with random capitalisation and inserted punctuation, and the numbers " +
  "are written as words (for example 'seventeen', 'ten'). Read it, compute the single " +
  "whole-number answer, and reply with ONLY that number as digits — no words, no units, " +
  "no working, nothing else.";

interface CognitionBlock {
  token?: string;
  prompt?: string;
  difficulty?: unknown;
}
interface CreateResponse {
  id?: string;
  cognition?: CognitionBlock | null;
  [k: string]: unknown;
}

/** Loose view of the SDK client — we only touch create + answer methods. */
type ColonyClientLike = Record<string, unknown> & {
  __cognitionWrapped?: boolean;
};

function parseAnswer(text: string): string | null {
  // The obfuscated prompt has no digits (operands are number-words), so any
  // digits in the reply are the model's arithmetic; take the last integer.
  const nums = text.match(/-?\d+/g);
  return nums && nums.length ? nums[nums.length - 1] : null;
}

async function solve(runtime: IAgentRuntime, prompt: string): Promise<string | null> {
  const raw = String(
    await runtime.useModel(ModelType.TEXT_SMALL, {
      prompt: `${SOLVE_SYSTEM}\n\nPuzzle: ${prompt}`,
      temperature: 0,
      maxTokens: 200,
    }),
  );
  return parseAnswer(raw);
}

async function handle(
  runtime: IAgentRuntime,
  client: ColonyClientLike,
  kind: "post" | "comment",
  resp: CreateResponse,
): Promise<void> {
  const cog = resp?.cognition;
  if (!cog || !cog.token || !cog.prompt) return; // not challenged — normal
  const id = resp.id;
  if (!id) {
    logger.warn(`cognition: ${kind} challenge arrived with no id`);
    return;
  }
  logger.info(`cognition: ${kind} ${id} was challenged — solving with the agent model`);
  const answer = await solve(runtime, cog.prompt);
  if (answer == null) {
    logger.warn(`cognition: agent model produced no numeric answer for ${kind} ${id}`);
    return;
  }
  const method = kind === "post" ? "answerPostCognition" : "answerCognition";
  const fn = client[method];
  if (typeof fn !== "function") {
    logger.warn(`cognition: client.${method} unavailable (need @thecolony/sdk >= 0.15.0)`);
    return;
  }
  const res = (await (fn as (...a: unknown[]) => Promise<unknown>).call(
    client,
    id,
    cog.token,
    answer,
  )) as { status?: string; attempts_remaining?: number } | undefined;
  if (res?.status === "proved") {
    logger.info(`cognition: ${kind} ${id} PROVED (answer=${answer})`);
  } else {
    logger.warn(
      `cognition: ${kind} ${id} NOT proved (status=${res?.status} answer=${answer} remaining=${res?.attempts_remaining})`,
    );
  }
}

function wrap(
  runtime: IAgentRuntime,
  client: ColonyClientLike,
  method: "createPost" | "createComment",
  kind: "post" | "comment",
): void {
  const orig = client[method];
  if (typeof orig !== "function") return;
  const bound = (orig as (...a: unknown[]) => Promise<unknown>).bind(client);
  client[method] = async (...args: unknown[]): Promise<unknown> => {
    const resp = await bound(...args);
    // Best-effort, in the background: never block or break the create itself.
    void Promise.resolve()
      .then(() => handle(runtime, client, kind, resp as CreateResponse))
      .catch((err) => logger.warn(`cognition: handler error on ${kind} create: ${String(err)}`));
    return resp;
  };
}

/**
 * Wait for the colony service, then wrap its client's create methods so a
 * cognition challenge on the response is solved and answered automatically.
 * Idempotent. Fire-and-forget from the agent's `init` — it polls for the
 * service (which registers during runtime init) and never blocks startup.
 */
export async function installCognitionHandler(runtime: IAgentRuntime): Promise<void> {
  let service: { client?: ColonyClientLike } | null = null;
  for (let i = 0; i < 30; i++) {
    service = runtime.getService?.("colony") as { client?: ColonyClientLike } | null;
    if (service?.client) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const client = service?.client;
  if (!client) {
    logger.warn("cognition: colony service/client not available — handler NOT installed");
    return;
  }
  if (client.__cognitionWrapped) return;
  wrap(runtime, client, "createPost", "post");
  wrap(runtime, client, "createComment", "comment");
  client.__cognitionWrapped = true;
  logger.info("cognition: challenge handler installed (solve via agent model)");
}
