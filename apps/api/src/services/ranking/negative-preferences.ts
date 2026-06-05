import type { Course } from "../../db/types.js";
import type { SearchPlan } from "../search-planner-types.js";
import type { RankingScoreComponent } from "../search-types.js";
import { courseText } from "./ranking-text.js";
import { RANKING_POLICY } from "./ranking-policy.js";
import { scoreComponent } from "./score-utils.js";

type NegativePreferenceContext = {
  negativeTerms: Set<string>;
  excludedSubjects: Set<string>;
  softPreferences: SearchPlan["softPreferences"];
};

type NegativePreferenceRule =
  typeof RANKING_POLICY.components.negativePreferences[number];
type NegativePreferencePenalty = NegativePreferenceRule["penalties"][number];
type NegativePreferenceTriggers = {
  negativeTerms?: readonly string[];
  excludedSubjects?: readonly string[];
  softPreferences?: readonly (keyof NonNullable<SearchPlan["softPreferences"]>)[];
};
type SubjectPenaltyShape = {
  subjectMatches?: readonly string[];
};
type TextPenaltyShape = {
  textFields?: readonly Parameters<typeof courseText>[1][number][];
  pattern?: RegExp;
};

export function negativePreferenceComponent(
  course: Course,
  plan: SearchPlan,
): RankingScoreComponent | null {
  const context = negativePreferenceContext(plan);
  let penalty = 0;
  const evidence: string[] = [];

  for (const rule of RANKING_POLICY.components.negativePreferences) {
    if (!negativePreferenceRuleApplies(rule, context)) continue;
    for (const penaltyRule of rule.penalties) {
      if (!negativePreferencePenaltyMatches(penaltyRule, course)) continue;
      penalty += penaltyRule.value;
      evidence.push(negativePreferenceEvidence(penaltyRule, course));
    }
  }

  return penalty === 0
    ? null
    : scoreComponent(
      "negative_preference_penalty",
      penalty,
      "Course conflicts with an avoided topic or workload signal.",
      evidence,
    );
}

function negativePreferenceContext(plan: SearchPlan): NegativePreferenceContext {
  return {
    negativeTerms: new Set([
      ...(plan.rescue?.negativeTerms ?? []),
      ...(plan.filters.not?.keywords ?? []),
    ]),
    excludedSubjects: new Set(
      (plan.filters.not?.subjects ?? []).map(subject => subject.toUpperCase()),
    ),
    softPreferences: plan.softPreferences,
  };
}

function negativePreferenceRuleApplies(
  rule: NegativePreferenceRule,
  context: NegativePreferenceContext,
): boolean {
  const triggers = rule.triggers as NegativePreferenceTriggers;
  return Boolean(
    triggers.negativeTerms?.some(term => context.negativeTerms.has(term))
    || triggers.excludedSubjects?.some(subject => context.excludedSubjects.has(subject))
    || triggers.softPreferences?.some(preference => Boolean(context.softPreferences?.[preference])),
  );
}

function negativePreferencePenaltyMatches(
  penalty: NegativePreferencePenalty,
  course: Course,
): boolean {
  const subjectPolicy = penalty as SubjectPenaltyShape;
  const textPolicy = penalty as TextPenaltyShape;
  const subjectMatches = subjectPolicy.subjectMatches
    ? subjectPolicy.subjectMatches.includes(course.subject.toUpperCase())
    : false;
  const textMatches = textPolicy.pattern && textPolicy.textFields
    ? textPolicy.pattern.test(courseText(course, textPolicy.textFields))
    : false;

  return subjectMatches || textMatches;
}

function negativePreferenceEvidence(
  penalty: NegativePreferencePenalty,
  course: Course,
): string {
  if ("evidenceFromSubject" in penalty && penalty.evidenceFromSubject) {
    return `subject ${course.subject}`;
  }

  return "evidence" in penalty ? penalty.evidence : `subject ${course.subject}`;
}
