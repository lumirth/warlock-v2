import type { Course } from "../../db/types.js";
import type { SearchPlan } from "../search-planner-types.js";
import type { RankingScoreComponent } from "../search-types.js";
import { courseText } from "./ranking-text.js";
import { scoreComponent } from "./score-utils.js";

type NegativePreferenceContext = {
  negativeTerms: Set<string>;
  excludedSubjects: Set<string>;
  softPreferences: SearchPlan["softPreferences"];
};

type EvidenceLabel = string | ((course: Course) => string);

type NegativePreferencePenaltyRule = {
  value: number;
  evidence: EvidenceLabel;
  matches: (course: Course) => boolean;
};

type NegativePreferenceRule = {
  applies: (context: NegativePreferenceContext) => boolean;
  penalties: NegativePreferencePenaltyRule[];
};

const NEGATIVE_PREFERENCE_RULES: NegativePreferenceRule[] = [
  {
    applies: ({ negativeTerms, excludedSubjects, softPreferences }) => (
      negativeTerms.has("math_heavy")
      || Boolean(softPreferences?.lowMath)
      || excludedSubjects.has("MATH")
      || excludedSubjects.has("STAT")
    ),
    penalties: [
      {
        value: -0.7,
        evidence: "math-heavy language",
        matches: course => /\b(qr|quantitative|calculus|statistics|statistical|programming|formal logic)\b/.test(
          courseText(course, ["subject", "title", "description"]),
        ),
      },
      {
        value: -0.4,
        evidence: course => `subject ${course.subject}`,
        matches: course => ["MATH", "STAT"].includes(course.subject.toUpperCase()),
      },
    ],
  },
  {
    applies: ({ negativeTerms, softPreferences }) => (
      negativeTerms.has("writing_heavy")
      || negativeTerms.has("writing")
      || negativeTerms.has("essay")
      || negativeTerms.has("essays")
      || Boolean(softPreferences?.lowWriting)
    ),
    penalties: [{
      value: -0.55,
      evidence: "writing-heavy language",
      matches: course => /\b(advanced composition|writing intensive|essay|papers?)\b/.test(
        courseText(course, ["title", "description"]),
      ),
    }],
  },
  {
    applies: ({ negativeTerms, excludedSubjects }) => (
      negativeTerms.has("biology_heavy")
      || excludedSubjects.has("MCB")
      || excludedSubjects.has("IB")
    ),
    penalties: [
      {
        value: -0.45,
        evidence: "biology-heavy language",
        matches: course => /\b(bio|biology|biological|molecular|cellular|anatomy|physiology)\b/.test(
          courseText(course, ["subject", "title", "description"]),
        ),
      },
      {
        value: -0.35,
        evidence: course => `subject ${course.subject}`,
        matches: course => ["IB", "MCB"].includes(course.subject.toUpperCase()),
      },
    ],
  },
  {
    applies: ({ negativeTerms }) => negativeTerms.has("lab") || negativeTerms.has("labs"),
    penalties: [{
      value: -0.45,
      evidence: "lab language",
      matches: course => /\b(lab|laboratory)\b/.test(
        courseText(course, ["title", "description", "course_info"]),
      ),
    }],
  },
  {
    applies: ({ negativeTerms }) => negativeTerms.has("coding") || negativeTerms.has("programming"),
    penalties: [{
      value: -0.55,
      evidence: "coding/programming language",
      matches: course => (
        /\b(coding|programming|programs?|software|computer science)\b/.test(
          courseText(course, ["subject", "title", "description"]),
        )
        || course.subject.toUpperCase() === "CS"
      ),
    }],
  },
];

export function negativePreferenceComponent(
  course: Course,
  plan: SearchPlan,
): RankingScoreComponent | null {
  const context = negativePreferenceContext(plan);
  let penalty = 0;
  const evidence: string[] = [];

  for (const rule of NEGATIVE_PREFERENCE_RULES) {
    if (!rule.applies(context)) continue;
    for (const penaltyRule of rule.penalties) {
      if (!penaltyRule.matches(course)) continue;
      penalty += penaltyRule.value;
      evidence.push(evidenceLabel(penaltyRule.evidence, course));
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

function evidenceLabel(label: EvidenceLabel, course: Course): string {
  return typeof label === "function" ? label(course) : label;
}
