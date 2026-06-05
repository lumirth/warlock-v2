import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

  it('keeps permissive search request coercion distinct from strict query decoding', () => {
    const contractSource = readFileSync('packages/query-types/search-contract.ts', 'utf8');
    const codecSource = readFileSync('packages/query-types/search-request-codec.ts', 'utf8');

    expect(contractSource).toContain('coerceSearchRequestDto');
    expect(`${contractSource}\n${codecSource}`).not.toContain('normalizeSearchRequestDto');
    expect(codecSource).toContain('decodeSearchRequestQuery');
    expect(codecSource).toMatch(/parseSearchSortParams[\s\S]*sort must be one of/);
    expect(codecSource).toMatch(/parseSearchScopeParam[\s\S]*scope must be one of/);
    expect(codecSource).toMatch(/parseSearchLevelParam[\s\S]*level must be one of/);
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
    expect(readFileSync('apps/api/src/services/search-retrieval-section-lanes.ts', 'utf8')).not.toMatch(/join\.includes|\.includes\("JOIN/);
  });

  it('does not expose the search subsystem through a broad services/search barrel', () => {
    expect(existsSync('apps/api/src/services/search.ts')).toBe(false);

    const checkedFiles = sourceFiles('apps/api/src')
      .filter(file => !file.includes('/routes/__tests__/search.test.ts'));

    for (const file of checkedFiles) {
      const imports = importSpecifiers(readFileSync(file, 'utf8'));
      expect(imports, file).not.toContain('../search.js');
      expect(imports, file).not.toContain('./search.js');
      expect(imports, file).not.toContain('../../services/search.js');
      expect(imports, file).not.toContain('../services/search.js');
    }
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
    expect(debugRouteSource).not.toMatch(/loadSearchResult(?:Geneds|Requirements)|getSearchTermSummary|_debug:\s*\{/);
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

  it('keeps root operational scripts from importing API internals except named workflow adapters', () => {
    const allowedApiImporters = new Set([
      'scripts/workflows/historical-sync-workflow.ts',
      'scripts/__tests__/historical-sync.test.ts',
    ]);
    const checkedFiles = sourceFiles('scripts')
      .filter(file => !allowedApiImporters.has(file))
      .filter(file => file !== 'scripts/__tests__/architecture-boundaries.test.ts');

    for (const file of checkedFiles) {
      const imports = importSpecifiers(readFileSync(file, 'utf8'));
      expect(imports, file).not.toEqual(
        expect.arrayContaining([
          expect.stringMatching(/apps\/api\/src/),
        ]),
      );
    }
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

    const activeRequestHelper = controllerState.match(/function activeRequestFromResponse[\s\S]*?^}/m)?.[0] ?? '';
    expect(activeRequestHelper).not.toContain('appliedSort');
    expect(activeRequestHelper).not.toContain('requestSort');
    expect(activeRequestHelper).toContain('response.meta?.nextRequest');
  });

  it('keeps search presentation from conflating executable continuation with display interpretation', () => {
    const presenterSource = readFileSync('apps/api/src/services/search-response-presenter.ts', 'utf8');
    const controllerState = readFileSync('apps/web/src/pages/search/search-controller-state.ts', 'utf8');
    const viewModel = readFileSync('apps/web/src/pages/search/search-view-model.ts', 'utf8');

    expect(presenterSource).toContain('effectiveRequest');
    expect(presenterSource).toContain('const nextRequest = coerceSearchRequestDto(effectiveRequest)');
    expect(presenterSource).toContain('const interpretedRequest = buildInterpretedSearchRequest');
    expect(presenterSource).toContain('nextRequest,');
    expect(presenterSource).toContain('interpretedRequest,');
    expect(presenterSource).toMatch(/buildSearchUiPlan\([\s\S]*normalizedInterpretedRequest[\s\S]*\)/);
    expect(presenterSource).not.toMatch(/const\s+nextRequest\s*=\s*buildInterpretedSearchRequest/);
    expect(presenterSource).not.toContain('coerceSearchRequestDto(nextRequest)');
    expect(controllerState).not.toMatch(/sort:\s*response\.meta\?\.appliedSort\s*\?\?/);
    expect(viewModel).toContain('meta?.interpretedRequest');
  });

  it('keeps requirement filters mode-aware in the public search contract', () => {
    const contract = readFileSync('packages/query-types/search-contract.ts', 'utf8');
    const policy = readFileSync('packages/query-types/course-policy.ts', 'utf8');
    const interpretedRequest = readFileSync('apps/api/src/services/search-interpreted-request.ts', 'utf8');
    const requestMapper = readFileSync('apps/api/src/services/search-request.ts', 'utf8');

    expect(policy).toContain('export type RequirementFilter');
    expect(policy).toContain('codes: string[]');
    expect(policy).toContain('mode: RequirementFilterMode');
    expect(contract).toContain('requirement?: RequirementFilter');
    expect(contract).not.toContain('requirement?: string');
    expect(interpretedRequest).toContain('effectiveRequirementFilter(filters)');
    expect(interpretedRequest).not.toMatch(/codes\[0\]|singleRequirementFilter\(/);
    expect(requestMapper).not.toMatch(/singleRequirementFilter|requirement:\s*requestFilters\.requirement\.codes\[0\]/);
  });

  it('keeps fallback execution provenance attached to executable fallback plans', () => {
    const planningTypes = readFileSync('apps/api/src/services/search-planning-types.ts', 'utf8');
    const intentPasses = readFileSync('apps/api/src/services/search-plan-intent-passes.ts', 'utf8');
    const executor = readFileSync('apps/api/src/services/search-executor.ts', 'utf8');

    expect(planningTypes).toContain('export type SearchFallbackPlan');
    expect(planningTypes).toContain('constraintsRelaxed: string[]');
    expect(intentPasses).toContain('constraintsRelaxed:');
    expect(executor).toContain('for (const fallback of fallbackPlans)');
    expect(executor).toContain('fallback.constraintsRelaxed');
    expect(executor).toContain('fallback.plan');
  });

  it('keeps exact course recall inside the shared filtered-course query envelope', () => {
    const courseLaneSource = readFileSync('apps/api/src/services/search-retrieval-course-lanes.ts', 'utf8');
    const exactBlock = courseLaneSource.match(/if \(filters\.subject && filters\.number[\s\S]*?if \(exactResult\.results\.length > 0\)/)?.[0] ?? '';

    expect(exactBlock).toContain('buildFilteredCourseQuery(filters)');
    expect(exactBlock).toContain('filtered.whereSql()');
    expect(exactBlock).not.toMatch(/WHERE\s+subject\s*=\s*\?\s+AND\s+number\s*=\s*\?/);
  });

  it('keeps search pagination honest about lower-bound counts', () => {
    const contract = readFileSync('packages/query-types/search-response-dto.ts', 'utf8');
    const presenter = readFileSync('apps/api/src/services/search-response-presenter.ts', 'utf8');
    const viewModel = readFileSync('apps/web/src/pages/search/search-view-model.ts', 'utf8');

    expect(contract).toContain('resultCountLowerBound: number');
    expect(contract).not.toContain('total: number');
    expect(presenter).toContain('resultCountLowerBound:');
    expect(viewModel).toContain('at least');
  });

  it('keeps advanced search state structurally separate from filters', () => {
    const contract = readFileSync('packages/query-types/search-contract.ts', 'utf8');
    const filterModel = readFileSync('apps/web/src/pages/search/search-filter-model.ts', 'utf8');
    const advancedFields = readFileSync('apps/web/src/pages/search/AdvancedSearchFields.tsx', 'utf8');

    expect(contract).toMatch(/export type AdvancedSearchStateDto = \{\s*filters: SearchRequestFiltersDto;\s*scope\?: SearchScope;\s*\};/);
    expect(contract).not.toContain('AdvancedSearchStateDto = SearchRequestFiltersDto');
    expect(filterModel).toContain('state.filters');
    expect(filterModel).toContain('state.scope');
    expect(advancedFields).toContain('const filters = advancedDraft.filters');
    expect(advancedFields).toContain('advancedDraft.scope');
    expect(advancedFields).not.toMatch(/advancedDraft\.(subject|number|instructor|requirement|workload|status|level)\b/);
    expect(advancedFields).not.toContain("onAdvancedDraftChange('scope'");
  });

  it('keeps requirement as the contract vocabulary while student-facing copy says GenEd', () => {
    const dto = readFileSync('packages/query-types/course-dto.ts', 'utf8');
    const policy = readFileSync('packages/query-types/course-policy.ts', 'utf8');
    const apiCourseDto = readFileSync('apps/api/src/dto/course.ts', 'utf8');
    const apiPresenter = readFileSync('apps/api/src/services/search-response-presenter.ts', 'utf8');
    const hintLabels = readFileSync('apps/api/src/services/search-hint-labels.ts', 'utf8');
    const chipPresenter = readFileSync('apps/api/src/services/search-chip-presenter.ts', 'utf8');
    const resultPresentation = readFileSync('apps/api/src/services/search-result-presentation.ts', 'utf8');
    const advancedFields = readFileSync('apps/web/src/pages/search/AdvancedSearchFields.tsx', 'utf8');
    const searchForm = readFileSync('apps/web/src/pages/search/SearchForm.tsx', 'utf8');
    const searchOptions = readFileSync('apps/web/src/pages/search/search-options.ts', 'utf8');
    const resultModel = readFileSync('apps/web/src/pages/search/search-result-model.ts', 'utf8');
    const coursePage = readFileSync('apps/web/src/pages/CoursePage.tsx', 'utf8');

    expect(dto).toContain('export type CourseRequirementDto');
    expect(dto).toContain('requirements: CourseRequirementDto[]');
    expect(dto).not.toContain('CourseGenedDto');
    expect(apiCourseDto).toContain('requirements?: CourseRequirementDto[]');
    expect(apiCourseDto).not.toMatch(/geneds\?:|\.geneds\b/);
    expect(apiPresenter).toContain('loadSearchResultRequirements');
    expect(apiPresenter).not.toContain('search-geneds');
    expect(`${resultModel}\n${coursePage}`).toMatch(/requirementLabel|courseRequirementLabels/);
    expect(`${resultModel}\n${coursePage}`).not.toMatch(/genedLabel|courseGenedLabels|CourseGenedDto/);

    expect(policy).toContain('GENED_DISPLAY_NAME = "GenEd"');
    expect(policy).toContain('ANY_GENED_DISPLAY_LABEL = "Any GenEd"');
    expect(hintLabels).toContain('formatGenEdDisplayLabel');
    expect(chipPresenter).toContain('ANY_GENED_DISPLAY_LABEL');
    expect(resultPresentation).toContain('GenEd evidence came from structured mappings.');
    expect(advancedFields).toContain('GENED_DISPLAY_NAME');
    expect(advancedFields).toContain('ANY_GENED_DISPLAY_LABEL');
    expect(searchForm).toContain('professor, GenEd, or time');
    expect(searchOptions).toContain('cultural studies gen ed');
    expect(`${advancedFields}\n${searchForm}\n${searchOptions}`).not.toMatch(/Requirement codes|Requirement match|professor, requirement|cultural studies requirement|humanities requirement/);
  });

  it('keeps course fact groups honest instead of hiding them under registration', () => {
    const dto = readFileSync('packages/query-types/course-dto.ts', 'utf8');
    const apiCourseDto = readFileSync('apps/api/src/dto/course.ts', 'utf8');
    const coursePage = readFileSync('apps/web/src/pages/CoursePage.tsx', 'utf8');

    expect(dto).toContain('export type CourseCatalogDto');
    expect(dto).toContain('export type CourseScheduleNotesDto');
    expect(dto).toContain('export type CourseRegistrationDto');
    expect(dto).toContain('catalog: CourseCatalogDto');
    expect(dto).toContain('scheduleNotes: CourseScheduleNotesDto');
    expect(apiCourseDto).toContain('catalog:');
    expect(apiCourseDto).toContain('scheduleNotes:');
    expect(coursePage).toContain('course.catalog.');
    expect(coursePage).toContain('course.scheduleNotes.');
    expect(coursePage).not.toMatch(/course\.registration\.(courseInfo|degreeAttributes|classScheduleInfo|dateRangeText)/);
  });

  it('keeps section presentation behind nested public DTO groups and availability policy', () => {
    const dto = readFileSync('packages/query-types/course-dto.ts', 'utf8');
    const apiCourseDto = readFileSync('apps/api/src/dto/course.ts', 'utf8');
    const availabilityPolicy = readFileSync('apps/api/src/services/section-availability-policy.ts', 'utf8');
    const sectionsTable = readFileSync('apps/web/src/components/SectionsTable.tsx', 'utf8');
    const sectionDisplay = readFileSync('apps/web/src/components/section-display-model.ts', 'utf8');

    expect(dto).toContain('availability: CourseSectionAvailabilityDto');
    expect(dto).toContain('schedule: CourseSectionScheduleDto');
    expect(dto).toContain('instructors: CourseSectionInstructorsDto');
    expect(dto).toContain('sourceFacts: CourseSectionSourceFactsDto');
    expect(dto).toContain('links: CourseSectionLinksDto');
    expect(apiCourseDto).toContain('normalizeSectionAvailability');
    expect(availabilityPolicy).toContain('open');
    expect(availabilityPolicy).toContain('restricted');
    expect(availabilityPolicy).toContain('waitlisted');
    expect(sectionDisplay).toContain('sectionAvailabilityTone');
    expect(sectionDisplay).toContain('CourseSectionAvailabilityStatus');
    expect(sectionsTable).not.toMatch(/section\.(status|type|days|startTime|endTime|location|instructor|rmpRating|avgGpa|courseExplorerUrl|sectionTitle|sectionText|sectionNotes|partOfTerm|dateRangeText|startDate|endDate|creditHours|meetings)\b/);
    expect(sectionsTable).not.toMatch(/includes\(['"](open|closed|restricted|wait)['"]\)/i);
  });

  it('keeps filtered lane SQL fragments ordered without dormant HAVING plumbing', () => {
    const filters = readFileSync('apps/api/src/services/search-filters.ts', 'utf8');
    const builder = readFileSync('apps/api/src/services/search-lane-query-builder.ts', 'utf8');
    const laneSources = [
      'apps/api/src/services/search-retrieval-course-lanes.ts',
      'apps/api/src/services/search-retrieval-section-lanes.ts',
      'apps/api/src/services/search-retrieval-requirement-lanes.ts',
      'apps/api/src/services/search-retrieval-alias-lanes.ts',
      'apps/api/src/services/search-retrieval-workload-lanes.ts',
    ].map(file => readFileSync(file, 'utf8')).join('\n');

    expect(`${filters}\n${builder}\n${laneSources}`).not.toMatch(/havingSql|havingParams|having\?:|groupBy\?:/);
    expect(builder).toContain('bindParams(...paramGroups)');
    expect(builder).not.toContain('...filtered.havingParams');
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
