import type { D1Database } from "@cloudflare/workers-types";
import type { CourseGenedDto } from "@uiuc-course-search/query-types";
import { loadSearchResultGeneds } from "../dto/search-geneds.js";
import type { SearchRequestPagination } from "../http/search-request.js";
import type { SearchPipelineResult } from "./search-response.js";
import { getSearchTermSummary } from "./term-state.js";

export async function presentSearchDebugResponse(input: {
  db: D1Database;
  result: SearchPipelineResult;
  pagination: SearchRequestPagination;
}): Promise<{
  results: Array<{
    id: string;
    title: string;
    subject: string;
    number: string;
    avg_gpa: number | null;
    geneds: CourseGenedDto[];
    score: number;
  }>;
  meta: {
    query: SearchPipelineResult["meta"]["query"];
    fallback: SearchPipelineResult["meta"]["fallback"];
    term: Awaited<ReturnType<typeof getSearchTermSummary>>;
  };
  _debug: {
    extraction: SearchPipelineResult["meta"]["extraction"];
    compilerEvents: SearchPipelineResult["meta"]["compilerEvents"];
    plan: SearchPipelineResult["meta"]["plan"];
    retrievalPlan: SearchPipelineResult["meta"]["retrievalPlan"];
    retrievalPlans: SearchPipelineResult["meta"]["retrievalPlans"];
    budget: SearchPipelineResult["meta"]["budget"];
  };
}> {
  const { db, pagination, result } = input;
  const { limit, offset } = pagination;
  const pageResults = result.results.slice(offset, offset + limit);
  const [genedsByCourseId, term] = await Promise.all([
    loadSearchResultGeneds(
      db,
      pageResults.map((searchResult) => searchResult.course.id),
    ),
    getSearchTermSummary(db),
  ]);

  return {
    results: pageResults.map((searchResult) => ({
      id: searchResult.course.id,
      title: searchResult.course.title,
      subject: searchResult.course.subject,
      number: searchResult.course.number,
      avg_gpa: searchResult.course.avg_gpa,
      geneds: genedsByCourseId.get(searchResult.course.id) ?? [],
      score: searchResult.score,
    })),
    meta: {
      query: result.meta.query,
      fallback: result.meta.fallback,
      term,
    },
    _debug: {
      extraction: result.meta.extraction,
      compilerEvents: result.meta.compilerEvents,
      plan: result.meta.plan,
      retrievalPlan: result.meta.retrievalPlan,
      retrievalPlans: result.meta.retrievalPlans,
      budget: result.meta.budget,
    },
  };
}
