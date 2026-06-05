import type {
  DecisionQueryType,
  RetrievalLane,
} from "./search-planner-types.js";

export function lanesForDecisionQueryTypes(
  queryTypes: Set<DecisionQueryType>,
): RetrievalLane[] {
  const lanes = new Set<RetrievalLane>();
  if (queryTypes.has("exact_course")) lanes.add("exact");
  if (
    queryTypes.has("topic")
    || queryTypes.has("requirement")
    || queryTypes.has("comparison")
  ) {
    lanes.add("official_text");
  }
  if (
    queryTypes.has("requirement")
    || queryTypes.has("degree_progress")
  ) {
    lanes.add("requirement");
  }
  if (queryTypes.has("schedule")) lanes.add("structured_section");
  if (
    queryTypes.has("subjective_vibe")
    || queryTypes.has("avoidance")
  ) {
    lanes.add("student_language_alias");
  }
  if (
    queryTypes.has("topic")
    || queryTypes.has("comparison")
  ) {
    lanes.add("topic_semantic");
  }
  if (
    queryTypes.has("subjective_vibe")
    || queryTypes.has("avoidance")
    || queryTypes.has("eligibility")
  ) {
    lanes.add("workload_evidence");
  }
  if (
    queryTypes.has("help_or_how_to")
    || queryTypes.has("degree_progress")
  ) {
    lanes.add("help_path");
  }
  return Array.from(lanes);
}
