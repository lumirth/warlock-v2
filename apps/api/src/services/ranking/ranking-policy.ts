import type { RetrievalLane } from "../search-planner-types.js";

export const RANKING_POLICY = {
  retrievalFusion: {
    rrfK: 60,
    laneWeights: {
      exact: 9,
      official_text: 1.8,
      requirement: 2.4,
      section_text: 1.6,
      structured_section: 2,
      student_language_alias: 2.1,
      topic_semantic: 1.4,
      workload_evidence: 2.2,
      help_path: 1,
    } satisfies Record<RetrievalLane, number>,
  },
  components: {
    exactness: 6,
    qualityTierWeight: 0.08,
    laneMatch: {
      structuredSection: 0.35,
      studentLanguageAlias: 0.25,
      workloadEvidence: 0.45,
    },
    eligibility: {
      noListedPrereq: 0.35,
      prerequisiteRisk: -0.35,
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
        workloadEvidence: 0.3,
      },
      level: {
        level100: 0.55,
        level200: 0.35,
        level300: 0.05,
        level400: -0.35,
        level500Plus: -1.25,
      },
    },
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

export type RankingPolicy = typeof RANKING_POLICY;
