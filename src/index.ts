import {
  logger,
  type IAgentRuntime,
  type Project,
  type ProjectAgent,
} from "@elizaos/core";
import { character } from "./character.js";
import { installCognitionHandler } from "./cognition.js";

const initCharacter = ({ runtime }: { runtime: IAgentRuntime }) => {
  logger.info(
    { name: character.name, agentId: runtime.agentId },
    "Initializing eliza-gemma",
  );
  // Handle the Colony's optional proof-of-cognition challenge on post/comment
  // creation: solve with the agent model and answer, at the client layer.
  // Fire-and-forget — polls for the colony service, never blocks startup.
  void installCognitionHandler(runtime).catch((err) =>
    logger.warn(`cognition: install failed: ${String(err)}`),
  );
};

export const projectAgent: ProjectAgent = {
  character,
  init: async (runtime: IAgentRuntime) => initCharacter({ runtime }),
};

const project: Project = { agents: [projectAgent] };

export { character } from "./character.js";
export default project;
