import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('architecture boundaries', () => {
  it('keeps the search route as an adapter instead of a public response presenter', () => {
    const source = readFileSync('apps/api/src/routes/search.ts', 'utf8');

    expect(source).toContain('presentSearchResponse');
    expect(source).not.toMatch(/SearchResponseDto|SearchInterpretationDto|SearchPlan/);
    expect(source).not.toContain('../dto/course');
    expect(source).not.toContain('../dto/search-geneds');
    expect(source).not.toContain('../services/search-ui-plan');
    expect(source).not.toContain('../services/term-state');
  });

  it('keeps retrieval execution behind the lane executor registry', () => {
    const hybridSource = readFileSync('apps/api/src/services/search-hybrid.ts', 'utf8');
    const fusionSource = readFileSync('apps/api/src/services/search-fusion.ts', 'utf8');
    const planSource = readFileSync('apps/api/src/services/search-retrieval-plan.ts', 'utf8');
    const executorSource = readFileSync('apps/api/src/services/search-retrieval-lane-executors.ts', 'utf8');
    const laneBarrelSource = readFileSync('apps/api/src/services/search-retrieval-lanes.ts', 'utf8');

    expect(hybridSource).toContain('executeRetrievalLanes');
    expect(hybridSource).not.toMatch(/keywordSearch|sectionKeywordSearch|requirementLaneSearch|studentAliasLaneSearch|workloadEvidenceLaneSearch|laneEnabled/);
    expect(fusionSource).toContain('laneResults: RetrievalLaneResult[]');
    expect(fusionSource).not.toMatch(/courseKeywordResults|sectionKeywordResults|requirementResults|structuredSectionResults|aliasResults|semanticResults|workloadResults/);
    expect(planSource).not.toContain('search-retrieval-lanes');
    expect(executorSource).toContain('search-retrieval-course-lanes');
    expect(executorSource).toContain('search-retrieval-section-lanes');
    expect(laneBarrelSource).not.toMatch(/SELECT|FROM courses|JOIN sections|MATCH \?/);
  });

  it('keeps student language interpretation free of executable retrieval policy', () => {
    const lexiconSource = readFileSync('apps/api/src/services/student-language-lexicon.ts', 'utf8');
    const lanePolicySource = readFileSync('apps/api/src/services/search-decision-lane-policy.ts', 'utf8');

    expect(lexiconSource).not.toMatch(/RetrievalLane|lanesForDecisionQueryTypes/);
    expect(lanePolicySource).toMatch(/RetrievalLane|lanesForDecisionQueryTypes/);
  });

  it('keeps search UI metadata split into presenter roles', () => {
    const uiPlanSource = readFileSync('apps/api/src/services/search-ui-plan.ts', 'utf8');

    expect(uiPlanSource).toContain('buildSearchChips');
    expect(uiPlanSource).toContain('buildAmbiguityActions');
    expect(uiPlanSource).toContain('publicFiltersFromPlan');
    expect(uiPlanSource).not.toMatch(/removeSearchIntentAction|ambiguitySearchAction|formatResolvedHintLabel|formatDisplayHintValue/);
  });

  it('keeps debug search routes as adapters over a debug presenter', () => {
    const debugRouteSource = readFileSync('apps/api/src/routes/debug.ts', 'utf8');

    expect(debugRouteSource).toContain('presentSearchDebugResponse');
    expect(debugRouteSource).not.toMatch(/loadSearchResultGeneds|getSearchTermSummary|_debug:\s*\{/);
  });

  it('keeps feedback corpus scripts out of API internals', () => {
    const cliSource = readFileSync('scripts/feedback-corpus-candidates.ts', 'utf8');
    const exportSource = readFileSync('scripts/export-feedback.ts', 'utf8');
    const reportSource = readFileSync('scripts/lib/feedback-corpus/report.ts', 'utf8');
    const typesSource = readFileSync('scripts/lib/feedback-corpus/types.ts', 'utf8');

    expect(cliSource).toContain('./lib/feedback-corpus/report');
    expect(cliSource).not.toContain('apps/api/src');
    expect(exportSource).toContain('./lib/feedback-corpus/report');
    expect(exportSource).not.toContain('./feedback-corpus-candidates');
    expect(reportSource).not.toContain('apps/api/src');
    expect(typesSource).toContain('@uiuc-course-search/query-types');
    expect(typesSource).not.toContain('apps/api/src');
  });

  it('keeps sync routes as adapters over sync application services', () => {
    const courseRoute = readFileSync('apps/api/src/routes/sync-course-routes.ts', 'utf8');
    const enrichmentRoute = readFileSync('apps/api/src/routes/sync-enrichment-routes.ts', 'utf8');
    const routeBarrel = readFileSync('apps/api/src/routes/sync.ts', 'utf8');

    expect(courseRoute).toMatch(/runSubjectSyncBatch|runManualTermSync|runActiveTermsSync/);
    expect(courseRoute).not.toMatch(/parallel-sync|upsertTermState|getTermState|readTermAggregateCounts|syncEmbeddingsEnabled/);
    expect(enrichmentRoute).toMatch(/runRmpAndScoringEnrichment|runScoringEnrichment|runGpaEnrichment/);
    expect(enrichmentRoute).not.toMatch(/coordinateRmpSync|coordinateEnrichment|enrichCoursesWithGpa|resumeGpaSync|resetGpaSync|processRmpBatch/);
    expect(routeBarrel).not.toMatch(/readTermAggregateCounts|resolveManualSyncTermStatus/);
  });

  it('keeps the web search session anchored to one canonical active request', () => {
    const controllerState = readFileSync('apps/web/src/pages/search/search-controller-state.ts', 'utf8');
    const sortingHook = readFileSync('apps/web/src/pages/search/useSearchSorting.ts', 'utf8');
    const paginationHook = readFileSync('apps/web/src/pages/search/useSearchPagination.ts', 'utf8');

    expect(controllerState).toContain('activeRequest: SearchRequestDto | null');
    expect(controllerState).toContain('activeRequestFromResponse');
    expect(controllerState).not.toMatch(/activeSearchText|activeAdvancedFilters/);
    expect(sortingHook).toContain('derived.activeAdvancedFilters');
    expect(paginationHook).toContain('derived.activeAdvancedFilters');
  });
});
