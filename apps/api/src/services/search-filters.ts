import type { SearchFilters } from "@uiuc-course-search/query-types/search-planner";
import {
  WORKLOAD_FILTER_THRESHOLDS,
  effectiveRequirementFilter,
} from "@uiuc-course-search/query-types";
import { canonicalGenedCode, canonicalGenedCodes } from "./gened-codes.js";

export const TIME_RANGES: Record<string, { start?: string; end?: string }> = {
  early: { end: "09:00" },
  morning: { end: "12:00" },
  midday: { start: "10:00", end: "14:00" },
  afternoon: { start: "12:00", end: "17:00" },
  evening: { start: "17:00" },
};

const STATUS_VALUES: Record<string, string[]> = {
  open: ["Open"],
  available: ["Open", "Restricted"],
  closed: ["Closed"],
};

const DAY_ALIASES: Record<string, string> = {
  monday: "M",
  mon: "M",
  m: "M",
  tuesday: "T",
  tue: "T",
  tues: "T",
  t: "T",
  wednesday: "W",
  wed: "W",
  w: "W",
  thursday: "R",
  thu: "R",
  thur: "R",
  thurs: "R",
  r: "R",
  friday: "F",
  fri: "F",
  f: "F",
};

export interface FilterClauseResult {
  joins: string[];
  where: string[];
  params: (string | number)[];
  groupBy?: string;
  having?: string;
  havingParams?: (string | number)[];
}

export function buildFilterClauses(
  filters: SearchFilters,
): FilterClauseResult {
  const joinsSet = new Set<string>();
  const where: string[] = [];
  const params: (string | number)[] = [];
  const havingParams: (string | number)[] = [];

  if (filters.subject) {
    where.push("c.subject = ?");
    params.push(filters.subject);
  }

  if (filters.number) {
    where.push("c.number = ?");
    params.push(filters.number);
  }

  if (filters.credits !== undefined) {
    where.push("c.credit_hours = ?");
    params.push(filters.credits);
  }

  if (filters.year !== undefined) {
    where.push("c.year = ?");
    params.push(filters.year);
  }

  if (filters.term) {
    where.push("c.term = ?");
    params.push(filters.term);
  }

  if (filters.level !== undefined) {
    const levelExpression = "CAST(SUBSTR(c.number, 1, 1) AS INTEGER) * 100";
    where.push(
      filters.level >= 500
        ? `${levelExpression} >= ?`
        : `${levelExpression} = ?`,
    );
    params.push(filters.level);
  }

  const requirement = effectiveRequirementFilter(filters);
  if (requirement?.mode === "single") {
    const requirementCode = canonicalGenedCode(requirement.codes[0]);
    if (requirementCode) {
      joinsSet.add("JOIN course_gened cg ON cg.course_id = c.id");
      where.push(`(cg.category_id = ? OR ${canonicalAttributeCodeSql("cg")} = ?)`);
      params.push(requirementCode, requirementCode);
    }
  }

  if (requirement?.mode === "any") {
    const requirementCodes = canonicalGenedCodes(requirement.codes);
    if (requirementCodes.length > 0) {
      joinsSet.add("JOIN course_gened cg ON cg.course_id = c.id");
      const placeholders = requirementCodes.map(() => "?").join(",");
      where.push(`(cg.category_id IN (${placeholders}) OR ${canonicalAttributeCodeSql("cg")} IN (${placeholders}))`);
      params.push(...requirementCodes, ...requirementCodes);
    }
  }

  if (requirement?.mode === "all") {
    canonicalGenedCodes(requirement.codes).forEach((gened, index) => {
      const alias = `cg_all_${index}`;
      where.push(`EXISTS (
        SELECT 1 FROM course_gened ${alias}
        WHERE ${alias}.course_id = c.id
          AND (${alias}.category_id = ? OR ${canonicalAttributeCodeSql(alias)} = ?)
      )`);
      params.push(gened, gened);
    });
  }

  if (filters.partOfTerm) {
    joinsSet.add("JOIN sections s ON s.course_id = c.id");
    where.push("s.part_of_term = ?");
    params.push(filters.partOfTerm);
  }

  if (filters.instructor_ids?.length) {
    joinsSet.add("JOIN sections s ON s.course_id = c.id");
    joinsSet.add("JOIN meetings m ON m.section_id = s.id");
    joinsSet.add("JOIN meeting_instructors mi ON mi.meeting_id = m.id");
    const placeholders = filters.instructor_ids.map(() => "?").join(",");
    where.push(`mi.instructor_id IN (${placeholders})`);
    params.push(...filters.instructor_ids);
  }

  if (filters.days) {
    joinsSet.add("JOIN sections s ON s.course_id = c.id");
    joinsSet.add("JOIN meetings m ON m.section_id = s.id");
    where.push("m.days = ?");
    params.push(filters.days);
  }

  if (filters.time) {
    const range = TIME_RANGES[filters.time];
    if (range) {
      joinsSet.add("JOIN sections s ON s.course_id = c.id");
      joinsSet.add("JOIN meetings m ON m.section_id = s.id");
      if (range.start) {
        where.push("m.start_time >= ?");
        params.push(range.start);
      }
      if (range.end) {
        where.push("m.start_time < ?");
        params.push(range.end);
      }
    }
  }

  if (filters.online !== undefined) {
    joinsSet.add("JOIN sections s ON s.course_id = c.id");
    joinsSet.add("JOIN meetings m ON m.section_id = s.id");
    if (filters.online) {
      where.push("(m.building_name = '' OR m.building_name IS NULL OR LOWER(m.building_name) LIKE '%online%')");
    } else {
      where.push("m.building_name != '' AND m.building_name IS NOT NULL AND LOWER(m.building_name) NOT LIKE '%online%'");
    }
  }

  if (filters.status) {
    joinsSet.add("JOIN sections s ON s.course_id = c.id");
    const statuses = STATUS_VALUES[filters.status] ?? ["Open"];
    const placeholders = statuses.map(() => "?").join(",");
    where.push(`s.status IN (${placeholders})`);
    params.push(...statuses);
  }

  if (filters.difficulty) {
    const thresholds = WORKLOAD_FILTER_THRESHOLDS[filters.difficulty];

    if ("min_workload" in thresholds) {
      where.push("(c.difficulty_score >= ? OR (c.difficulty_score IS NULL AND c.avg_gpa <= ?))");
      params.push(thresholds.min_workload, thresholds.fallback_max_gpa);
    }
    if ("max_workload" in thresholds) {
      where.push("(c.difficulty_score <= ? OR (c.difficulty_score IS NULL AND c.avg_gpa >= ?))");
      params.push(thresholds.max_workload, thresholds.fallback_min_gpa);
    }
  }

  if (filters.not) {
    if (filters.not.time?.length) {
      for (const timeNeg of filters.not.time) {
        const range = TIME_RANGES[timeNeg];
        if (range) {
          if (range.start && range.end) {
            where.push(`NOT EXISTS (
              SELECT 1 FROM sections s2
              JOIN meetings m2 ON m2.section_id = s2.id
              WHERE s2.course_id = c.id
                AND m2.start_time >= ?
                AND m2.start_time < ?
            )`);
            params.push(range.start, range.end);
          } else if (range.end) {
            where.push(`NOT EXISTS (
              SELECT 1 FROM sections s2
              JOIN meetings m2 ON m2.section_id = s2.id
              WHERE s2.course_id = c.id
                AND m2.start_time < ?
            )`);
            params.push(range.end);
          } else if (range.start) {
            where.push(`NOT EXISTS (
              SELECT 1 FROM sections s2
              JOIN meetings m2 ON m2.section_id = s2.id
              WHERE s2.course_id = c.id
                AND m2.start_time >= ?
            )`);
            params.push(range.start);
          }
        }
      }
    }

    if (filters.not.days?.length) {
      for (const daysNeg of filters.not.days) {
        const dayCode = normalizeDayToken(daysNeg);
        if (dayCode.length === 1) {
          where.push(`NOT EXISTS (
            SELECT 1 FROM sections s2
            JOIN meetings m2 ON m2.section_id = s2.id
            WHERE s2.course_id = c.id
              AND m2.days LIKE ?
          )`);
          params.push(`%${dayCode}%`);
        } else {
          where.push(`NOT EXISTS (
            SELECT 1 FROM sections s2
            JOIN meetings m2 ON m2.section_id = s2.id
            WHERE s2.course_id = c.id
              AND m2.days = ?
          )`);
          params.push(dayCode);
        }
      }
    }

    if (filters.not.instructor_ids?.length) {
      const placeholders = filters.not.instructor_ids.map(() => "?").join(",");
      where.push(`NOT EXISTS (
        SELECT 1 FROM sections s2
        JOIN meetings m2 ON m2.section_id = s2.id
        JOIN meeting_instructors mi2 ON mi2.meeting_id = m2.id
        WHERE s2.course_id = c.id
          AND mi2.instructor_id IN (${placeholders})
      )`);
      params.push(...filters.not.instructor_ids);
    }

    if (filters.not.subjects?.length) {
      const subjects = [...new Set(filters.not.subjects.map(subject => subject.toUpperCase()))];
      const placeholders = subjects.map(() => "?").join(",");
      where.push(`c.subject NOT IN (${placeholders})`);
      params.push(...subjects);
    }

    if (filters.not.geneds?.length) {
      const geneds = canonicalGenedCodes(filters.not.geneds);
      if (geneds.length > 0) {
        const placeholders = geneds.map(() => "?").join(",");
        where.push(`NOT EXISTS (
          SELECT 1 FROM course_gened cg_neg
          WHERE cg_neg.course_id = c.id
            AND (cg_neg.category_id IN (${placeholders}) OR ${canonicalAttributeCodeSql("cg_neg")} IN (${placeholders}))
        )`);
        params.push(...geneds, ...geneds);
      }
    }

    if (filters.not.keywords?.length) {
      for (const keyword of filters.not.keywords) {
        const normalized = keyword.toLowerCase().trim();
        if (!normalized) continue;
        const likeValue = `%${normalized}%`;
        where.push(`LOWER(
          COALESCE(c.subject, '') || ' ' ||
          COALESCE(c.title, '') || ' ' ||
          COALESCE(c.description, '') || ' ' ||
          COALESCE(c.course_info, '') || ' ' ||
          COALESCE(c.degree_attributes, '')
        ) NOT LIKE ?`);
        params.push(likeValue);
      }
    }
  }

  return {
    joins: Array.from(joinsSet),
    where,
    params,
    havingParams,
  };
}

function canonicalAttributeCodeSql(alias: string): string {
  return `CASE WHEN ${alias}.attribute_code LIKE '1%' THEN SUBSTR(${alias}.attribute_code, 2) ELSE ${alias}.attribute_code END`;
}

function normalizeDayToken(day: string): string {
  const normalized = day.trim().toLowerCase();
  return DAY_ALIASES[normalized] ?? day.trim().toUpperCase();
}
