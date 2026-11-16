import { AGENT_STEP_LIMIT } from "./tool-catalog";

export function getAgentStepLimit() {
  const value = process.env.AGENT_MAX_STEPS?.trim();
  if (!value || !/^\d+$/.test(value)) return AGENT_STEP_LIMIT;
  const limit = Number(value);
  return Number.isSafeInteger(limit) && limit > 0 ? limit : AGENT_STEP_LIMIT;
}
