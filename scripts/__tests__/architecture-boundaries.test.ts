import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(root: string): string[] {
  return readdirSync(root)
    .flatMap((entry) => {
      const path = join(root, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) return sourceFiles(path);
      return /\.(ts|tsx)$/.test(entry) ? [path] : [];
    });
}

function importSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(/\bimport\b(?:[\s\S]*?\bfrom\s*)?['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bexport\b[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g),
  ].map(match => match[1]);
}

describe('architecture boundaries', () => {
  it('keeps public packages and web code from importing API internals', () => {
    const checkedFiles = [
      ...sourceFiles('packages/query-types'),
      ...sourceFiles('apps/web/src'),
    ].filter(file => !file.includes('node_modules'));

    for (const file of checkedFiles) {
      const imports = importSpecifiers(readFileSync(file, 'utf8'));
      expect(imports, file).not.toEqual(
        expect.arrayContaining([
          expect.stringMatching(/apps\/api\/src|^\.\.\/\.\.\/apps\/api|^\.\.\/\.\.\/\.\.\/apps\/api/),
        ]),
      );
    }
  });

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

  it('keeps retrieval plans executable instead of carrying full planner state', () => {
    const planSource = readFileSync('apps/api/src/services/search-retrieval-plan.ts', 'utf8');
    const executorSource = readFileSync('apps/api/src/services/search-retrieval-lane-executors.ts', 'utf8');
    const hybridSource = readFileSync('apps/api/src/services/search-hybrid.ts', 'utf8');
    const retrievalPlanType = planSource.match(/export type RetrievalPlan = \{[\s\S]*?\n\};/)?.[0] ?? '';
    const laneSources = [
      'apps/api/src/services/search-retrieval-course-lanes.ts',
      'apps/api/src/services/search-retrieval-section-lanes.ts',
      'apps/api/src/services/search-retrieval-requirement-lanes.ts',
      'apps/api/src/services/search-retrieval-alias-lanes.ts',
      'apps/api/src/services/search-retrieval-workload-lanes.ts',
    ].map(file => readFileSync(file, 'utf8'));

    expect(planSource).toContain('inputs: RetrievalPlanInputs');
    expect(retrievalPlanType).not.toContain('SearchPlan');
    expect(executorSource).not.toContain('retrievalPlan.plan');
    expect(hybridSource).toContain('rankingPlan: SearchPlan');
    for (const source of laneSources) {
      expect(source).not.toMatch(/type\s+\{[^}]*SearchPlan|SearchPlan\b/);
    }
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
    const searchCommand = readFileSync('apps/web/src/pages/search/search-command.ts', 'utf8');
    const refinementActions = readFileSync('apps/web/src/pages/search/useSearchRefinements.ts', 'utf8');
    const sortingHook = readFileSync('apps/web/src/pages/search/useSearchSorting.ts', 'utf8');
    const paginationHook = readFileSync('apps/web/src/pages/search/useSearchPagination.ts', 'utf8');

    expect(controllerState).toContain('activeRequest: SearchRequestDto | null');
    expect(controllerState).toContain('activeRequestFromResponse');
    expect(controllerState).not.toMatch(/activeSearchText|activeAdvancedFilters/);
    expect(searchCommand).toContain("type: 'request'");
    expect(sortingHook).toContain('request: state.session.activeRequest');
    expect(paginationHook).toContain('request: state.session.activeRequest');
    expect(refinementActions).toContain("type: 'request'");
    expect(sortingHook).not.toContain('derived.activeAdvancedFilters');
    expect(paginationHook).not.toContain('derived.activeAdvancedFilters');
  });

  it('keeps parser and historical-sync entrypoints as facades over owned modules', () => {
    const parserFacade = readFileSync('apps/api/src/cisapi/parser.ts', 'utf8');
    const parserCascade = readFileSync('apps/api/src/cisapi/subject-cascade-parser.ts', 'utf8');
    const historicalCli = readFileSync('scripts/historical-sync.ts', 'utf8');
    const historicalWorkflow = readFileSync('scripts/workflows/historical-sync-workflow.ts', 'utf8');

    expect(parserFacade).not.toMatch(/new Parser|parseCourseDetailXml\(xml: string\)/);
    expect(parserFacade).toContain('course-detail-parser');
    expect(parserFacade).toContain('subject-cascade-parser');
    expect(parserCascade).not.toMatch(/parseCourseDetailXml|parseSubjectsXml|parseCoursesXml/);
    expect(historicalCli).toContain('runHistoricalSyncCli');
    expect(historicalCli).not.toMatch(/discoverHistoricalTerms|CoordinatedRateLimitFetcher|subjectSnapshotSqlStatements/);
    expect(historicalWorkflow).toContain('../lib/historical-sync-config');
    expect(historicalWorkflow).toContain('../lib/historical-sync-sql-output');
  });

  it('keeps historical sync runtime state scoped to a single CLI invocation', () => {
    const historicalWorkflow = readFileSync('scripts/workflows/historical-sync-workflow.ts', 'utf8');
    const moduleScope = historicalWorkflow.split('function createHistoricalSyncRuntime')[0];

    expect(moduleScope).not.toMatch(/let\s+(sqlWriter|logWriter)|new HistoricalSyncCheckpointStore|new CoordinatedRateLimitFetcher|const\s+stats\s*=\s*createSyncStats\(\)/);
    expect(historicalWorkflow).toContain('function createHistoricalSyncRuntime');
    expect(historicalWorkflow).toContain('const stats = createSyncStats()');
    expect(historicalWorkflow).toContain('const checkpointStore = new HistoricalSyncCheckpointStore');
    expect(historicalWorkflow).toContain('const historicalFetcher = new CoordinatedRateLimitFetcher');
  });

  it('keeps CISAPI XML parsing structured at parser call sites', () => {
    const listParser = readFileSync('apps/api/src/cisapi/course-list-parser.ts', 'utf8');
    const detailParser = readFileSync('apps/api/src/cisapi/course-detail-parser.ts', 'utf8');
    const parallelSync = readFileSync('apps/api/src/services/parallel-sync.ts', 'utf8');
    const termDiscovery = readFileSync('apps/api/src/services/term-discovery.ts', 'utf8');
    const debugRoute = readFileSync('apps/api/src/routes/debug.ts', 'utf8');

    expect(listParser).toContain('parseXmlDocument');
    expect(detailParser).toContain('parseXmlDocument');
    expect(`${listParser}\n${detailParser}`).not.toMatch(/new RegExp|\.match\(|\.exec\(/);
    expect(parallelSync).toContain('parseSubjectsXml');
    expect(termDiscovery).toContain('parseSubjectsXml');
    expect(debugRoute).toContain('parseSubjectsXml');
    expect(`${parallelSync}\n${termDiscovery}\n${debugRoute}`).not.toMatch(/<subject id=|matchAll\(/);
  });

  it('keeps operational term maintenance plumbing in script libraries', () => {
    const coverage = readFileSync('scripts/term-coverage-plan.ts', 'utf8');
    const retention = readFileSync('scripts/term-retention-plan.ts', 'utf8');
    const maintenance = readFileSync('scripts/lib/term-maintenance.ts', 'utf8');

    expect(coverage).toContain('./lib/term-maintenance');
    expect(retention).toContain('./lib/term-maintenance');
    expect(maintenance).toContain('discoverAvailableTerms');
    expect(`${coverage}\n${retention}`).not.toMatch(/ajax\/search\/termlist|readFile\(input|response\.json\(\)\.catch/);
  });

  it('keeps ranking policy values in the ranking policy owner', () => {
    const policy = readFileSync('apps/api/src/services/ranking/ranking-policy.ts', 'utf8');
    const requirement = readFileSync('apps/api/src/services/ranking/requirement-components.ts', 'utf8');
    const negative = readFileSync('apps/api/src/services/ranking/negative-preferences.ts', 'utf8');
    const gateway = readFileSync('apps/api/src/services/ranking/gateway-components.ts', 'utf8');

    expect(policy).toContain('requirementIntent');
    expect(policy).toContain('negativePreferences');
    expect(policy).toContain('introductoryGateway');
    expect(requirement).not.toMatch(/0\.9|0\.25|-0\.25/);
    expect(negative).not.toMatch(/-0\.7|-0\.55|-0\.45/);
    expect(gateway).not.toMatch(/const INTRODUCTORY_GATEWAY_NUMBERS|2\.0|-0\.75/);
  });
});
