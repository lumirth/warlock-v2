import type { RetrievalLane } from "../search-types.js";

export const RANKING_POLICY = {
  retrievalFusion: {
    rrfK: 60,
    laneWeights: {
      exact: 9,
      official_text: 1.8,
      structured_course: 1.8,
      section_text: 1.6,
      topic_semantic: 1.4,
    } satisfies Record<RetrievalLane, number>,
  },
  components: {
    exactness: 6,
    qualityTierWeight: 0.08,
    eligibility: {
      noListedPrereq: 0.35,
      prerequisiteRisk: -0.35,
    },
    requirementIntent: {
      exactMatch: {
        value: 0.9,
        reason: "Course satisfies the requested requirement filter.",
      },
      relatedCredit: {
        value: 0.25,
        reason: "Course has requirement credit, but not the exact requested bucket.",
      },
      missingMapping: {
        value: -0.25,
        reason: "Requirement intent was detected, but this course has no visible requirement mapping.",
      },
    },
    nullSubjectiveEvidencePenalty: -0.35,
    easyIntent: {
      minQualityTierRank: 3,
      preferredWorkloadTier: "Easy",
      minAverageGpa: 3.5,
      boosts: {
        qualityTier: 0.25,
        workloadTier: 0.3,
        averageGpa: 0.2,
      },
      level: {
        level100: 0.55,
        level200: 0.35,
        level300: 0.05,
        level400: -0.35,
        level500Plus: -1.25,
      },
    },
    introductoryGateway: {
      canonicalNumbers: {
        CS: ["124", "101", "105", "128"],
        ECE: ["110", "120"],
        ECON: ["102", "103"],
        MATH: ["220", "221", "234"],
        PSYC: ["100"],
        SPAN: ["101", "102", "122"],
        STAT: ["100", "107", "200"],
      },
      canonicalNumberScore: {
        base: 2,
        rankStep: 0.1,
      },
      level: {
        level100: 1,
        level200: 0.15,
        level300Plus: -0.25,
      },
      titleLanguage: {
        introductory: {
          value: 0.75,
          phrases: [
            "introduction to ",
            "intro to ",
            "introductory ",
            " introduction to ",
            " fundamentals of ",
          ],
        },
        disqualifying: {
          value: -0.75,
          phrases: [
            "undergraduate open seminar",
            "special topics",
            "independent study",
          ],
        },
      },
    },
    negativePreferences: [
      {
        triggers: {
          negativeTerms: ["math_heavy"],
          excludedSubjects: ["MATH", "STAT"],
          softPreferences: ["lowMath"],
        },
        penalties: [
          {
            value: -0.7,
            evidence: "math-heavy language",
            textFields: ["subject", "title", "description"],
            pattern: /\b(qr|quantitative|calculus|statistics|statistical|programming|formal logic)\b/,
          },
          {
            value: -0.4,
            evidenceFromSubject: true,
            subjectMatches: ["MATH", "STAT"],
          },
        ],
      },
      {
        triggers: {
          negativeTerms: ["writing_heavy", "writing", "essay", "essays"],
          softPreferences: ["lowWriting"],
        },
        penalties: [{
          value: -0.55,
          evidence: "writing-heavy language",
          textFields: ["title", "description"],
          pattern: /\b(advanced composition|writing intensive|essay|papers?)\b/,
        }],
      },
      {
        triggers: {
          negativeTerms: ["biology_heavy"],
          excludedSubjects: ["MCB", "IB"],
        },
        penalties: [
          {
            value: -0.45,
            evidence: "biology-heavy language",
            textFields: ["subject", "title", "description"],
            pattern: /\b(bio|biology|biological|molecular|cellular|anatomy|physiology)\b/,
          },
          {
            value: -0.35,
            evidenceFromSubject: true,
            subjectMatches: ["IB", "MCB"],
          },
        ],
      },
      {
        triggers: {
          negativeTerms: ["lab", "labs"],
        },
        penalties: [{
          value: -0.45,
          evidence: "lab language",
          textFields: ["title", "description", "course_info"],
          pattern: /\b(lab|laboratory)\b/,
        }],
      },
      {
        triggers: {
          negativeTerms: ["coding", "programming"],
        },
        penalties: [{
          value: -0.55,
          evidence: "coding/programming language",
          textFields: ["subject", "title", "description"],
          pattern: /\b(coding|programming|programs?|software|computer science)\b/,
          subjectMatches: ["CS"],
        }],
      },
    ],
  },
  filters: {
    workload: {
      easy: {
        maxScoreInclusive: 45,
        fallbackMinGpa: 3.5,
      },
      hard: {
        minScoreExclusive: 75,
        fallbackMaxGpa: 3.0,
      },
    },
  },
} as const;

export const WORKLOAD_FILTER_THRESHOLDS = RANKING_POLICY.filters.workload;
