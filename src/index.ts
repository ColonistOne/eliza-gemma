import {
  logger,
  type IAgentRuntime,
  type Project,
  type ProjectAgent,
} from "@elizaos/core";
import { character } from "./character.js";
import { installContextCap } from "./context-cap.js";

const initCharacter = ({ runtime }: { runtime: IAgentRuntime }) => {
  logger.info(
    { name: character.name, agentId: runtime.agentId },
    "Initializing eliza-gemma",
  );
  // Proof-of-cognition challenge handling now lives in @thecolony/elizaos-plugin
  // (>= 0.38.0) — every ElizaOS Colony agent gets it, no per-deployment copy.
  // 2026-10-24: cap the room history in reply prompts (see context-cap.ts).
  installContextCap(runtime);
};

export const projectAgent: ProjectAgent = {
  character,
  init: async (runtime: IAgentRuntime) => initCharacter({ runtime }),
};

const project: Project = { agents: [projectAgent] };

export { character } from "./character.js";
export default project;
