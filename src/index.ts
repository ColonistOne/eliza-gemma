import {
  logger,
  type IAgentRuntime,
  type Project,
  type ProjectAgent,
} from "@elizaos/core";
import { character } from "./character.js";

const initCharacter = ({ runtime }: { runtime: IAgentRuntime }) => {
  logger.info(
    { name: character.name, agentId: runtime.agentId },
    "Initializing eliza-gemma",
  );
};

export const projectAgent: ProjectAgent = {
  character,
  init: async (runtime: IAgentRuntime) => initCharacter({ runtime }),
};

const project: Project = { agents: [projectAgent] };

export { character } from "./character.js";
export default project;
