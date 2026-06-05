import type { SearchPlan } from "./search-planner-types.js";

export function hasIntroductoryGatewayIntent(plan: SearchPlan): boolean {
  return plan.intents?.includes("introductory_gateway")
    || plan.softPreferences?.introductoryIntent === "gateway";
}
