import type { D1Database } from "@cloudflare/workers-types";
import type { CourseRequirementDto } from "@uiuc-course-search/query-types";
import type { SearchRequestPaginationDto } from "@uiuc-course-search/query-types";
import type { SearchPipelineResult } from "./search-pipeline-result.js";
import { getSearchTermSummary } from "./term-state.js";

export async function presentSearchDebugResponse(input: {
  db: D1Database;
  result: SearchPipelineResult;
  pagination: SearchRequestPaginationDto;
}): Promise<{
  results: Array<{
    id: string;
    title: string;
    subject: string;
    number: string;
    avg_gpa: number | null;
    requirements: CourseRequirementDto[];
    score: number;
  }>;
  meta: {
    query: SearchPipelineResult["meta"]["query"];
    term: Awaited<ReturnType<typeof getSearchTermSummary>>;
  };
  _debug: {
    extraction: SearchPipelineResult["meta"]["extraction"];
    compilerEvents: SearchPipelineResult["meta"]["compilerEvents"];
    plan: SearchPipelineResult["meta"]["plan"];
    retrievalPlan: SearchPipelineResult["meta"]["retrievalPlan"];
    retrievalExecution: SearchPipelineResult["meta"]["retrievalExecution"];
  };
}> {
  const { db, pagination, result } = input;
  const { limit, offset } = pagination;
  const pageResults = result.results.slice(offset, offset + limit);
  const term = await getSearchTermSummary(db);

  return {
    results: pageResults.map((searchResult) => ({
      id: searchResult.course.id,
      title: searchResult.course.title,
      subject: searchResult.course.subject,
      number: searchResult.course.number,
      avg_gpa: searchResult.course.avg_gpa,
      requirements: searchResult.requirements ?? [],
      score: searchResult.score,
    })),
    meta: {
      query: result.meta.query,
      term,
    },
    _debug: {
      extraction: result.meta.extraction,
      compilerEvents: result.meta.compilerEvents,
      plan: result.meta.plan,
      retrievalPlan: result.meta.retrievalPlan,
      retrievalExecution: result.meta.retrievalExecution,
    },
  };
}
