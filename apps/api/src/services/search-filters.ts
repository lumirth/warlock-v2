import type { SearchFilters } from "./search-planner-types.js";
import {
  canonicalRequirementCode,
  canonicalRequirementCodes,
} from "@uiuc-course-search/query-types";
import { WORKLOAD_FILTER_THRESHOLDS } from "./ranking/ranking-policy.js";
import { rawSectionStatusesForSearchFilter } from "./section-availability-policy.js";

export const TIME_RANGES: Record<string, { start?: string; end?: string }> = {
  early: { end: "09:00" },
  morning: { end: "12:00" },
  midday: { start: "10:00", end: "14:00" },
  afternoon: { start: "12:00", end: "17:00" },
  evening: { start: "17:00" },
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
  joins: FilterJoinKey[];
  where: string[];
  params: (string | number)[];
}

export type FilterJoinKey =
  | "courseGened"
  | "sections"
  | "meetings"
  | "meetingInstructors";

const FILTER_JOIN_SQL: Record<FilterJoinKey, string> = {
  courseGened: "JOIN course_gened cg ON cg.course_id = c.id",
  sections: "JOIN sections s ON s.course_id = c.id",
  meetings: "JOIN meetings m ON m.section_id = s.id",
  meetingInstructors: "JOIN meeting_instructors mi ON mi.meeting_id = m.id",
};

export function buildFilterClauses(
  filters: SearchFilters,
): FilterClauseResult {
  const joinKeys = new Set<FilterJoinKey>();
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (filters.subject) {
    where.push("c.subject = ?");
    params.push(filters.subject);
  }

  if (filters.number) {
    where.push("c.number = ?");
    params.push(filters.number);
  }

  if (filters.crn) {
    joinKeys.add("sections");
    where.push("s.crn = ?");
    params.push(filters.crn);
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

  const requirement = filters.requirement;
  if (requirement?.mode === "single") {
    const requirementCode = canonicalRequirementCode(requirement.codes[0]);
    if (requirementCode) {
      joinKeys.add("courseGened");
      where.push(`(cg.category_id = ? OR ${canonicalAttributeCodeSql("cg")} = ?)`);
      params.push(requirementCode, requirementCode);
    }
  }

  if (requirement?.mode === "any") {
    const requirementCodes = canonicalRequirementCodes(requirement.codes);
    if (requirementCodes.length > 0) {
      joinKeys.add("courseGened");
      const placeholders = requirementCodes.map(() => "?").join(",");
      where.push(`(cg.category_id IN (${placeholders}) OR ${canonicalAttributeCodeSql("cg")} IN (${placeholders}))`);
      params.push(...requirementCodes, ...requirementCodes);
    }
  }

  if (requirement?.mode === "all") {
    canonicalRequirementCodes(requirement.codes).forEach((requirement, index) => {
      const alias = `cg_all_${index}`;
      where.push(`EXISTS (
        SELECT 1 FROM course_gened ${alias}
        WHERE ${alias}.course_id = c.id
          AND (${alias}.category_id = ? OR ${canonicalAttributeCodeSql(alias)} = ?)
      )`);
      params.push(requirement, requirement);
    });
  }

  if (filters.partOfTerm) {
    joinKeys.add("sections");
    where.push("s.part_of_term = ?");
    params.push(filters.partOfTerm);
  }

  if (filters.compressedTerm) {
    joinKeys.add("sections");
    where.push("s.part_of_term IS NOT NULL AND s.part_of_term != '' AND s.part_of_term != '1'");
  }

  if (filters.instructor_ids) {
    if (filters.instructor_ids.length === 0) {
      where.push("0");
    } else {
      joinKeys.add("sections");
      joinKeys.add("meetings");
      joinKeys.add("meetingInstructors");
      const placeholders = filters.instructor_ids.map(() => "?").join(",");
      where.push(`mi.instructor_id IN (${placeholders})`);
      params.push(...filters.instructor_ids);
    }
  }

  if (filters.days) {
    joinKeys.add("sections");
    joinKeys.add("meetings");
    for (const dayCode of selectedDayCodes(filters.days)) {
      where.push("m.days LIKE ?");
      params.push(`%${dayCode}%`);
    }
  }

  if (filters.time) {
    const range = TIME_RANGES[filters.time];
    if (range) {
      joinKeys.add("sections");
      joinKeys.add("meetings");
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

  if (filters.startAfterMinutes !== undefined) {
    joinKeys.add("sections");
    joinKeys.add("meetings");
    where.push("m.start_time >= ?");
    params.push(minutesToTime(filters.startAfterMinutes));
  }

  if (filters.startBeforeMinutes !== undefined) {
    joinKeys.add("sections");
    joinKeys.add("meetings");
    where.push("m.start_time < ?");
    params.push(minutesToTime(filters.startBeforeMinutes));
  }

  if (filters.online !== undefined) {
    joinKeys.add("sections");
    joinKeys.add("meetings");
    if (filters.online) {
      where.push(onlineEvidenceSql());
    } else {
      where.push(`NOT ${onlineEvidenceSql()} AND ${physicalLocationEvidenceSql()}`);
    }
  }

  if (filters.status) {
    joinKeys.add("sections");
    const statuses = rawSectionStatusesForSearchFilter(filters.status);
    const placeholders = statuses.map(() => "?").join(",");
    where.push(`s.status IN (${placeholders})`);
    params.push(...statuses);
  }

  if (filters.workload) {
    const thresholds = WORKLOAD_FILTER_THRESHOLDS[filters.workload];

    if ("minScoreExclusive" in thresholds) {
      where.push(
        "(c.difficulty_score > ? OR (c.difficulty_score IS NULL AND c.avg_gpa <= ?))",
      );
      params.push(thresholds.minScoreExclusive, thresholds.fallbackMaxGpa);
    }
    if ("maxScoreInclusive" in thresholds) {
      where.push(
        "(c.difficulty_score <= ? OR (c.difficulty_score IS NULL AND c.avg_gpa >= ?))",
      );
      params.push(thresholds.maxScoreInclusive, thresholds.fallbackMinGpa);
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

    if (filters.not.requirementCodes?.length) {
      const requirementCodes = canonicalRequirementCodes(filters.not.requirementCodes);
      if (requirementCodes.length > 0) {
        const placeholders = requirementCodes.map(() => "?").join(",");
        where.push(`NOT EXISTS (
          SELECT 1 FROM course_gened cg_neg
          WHERE cg_neg.course_id = c.id
            AND (cg_neg.category_id IN (${placeholders}) OR ${canonicalAttributeCodeSql("cg_neg")} IN (${placeholders}))
        )`);
        params.push(...requirementCodes, ...requirementCodes);
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
    joins: Array.from(joinKeys),
    where,
    params,
  };
}

export function filterJoinSql(
  joinKeys: readonly FilterJoinKey[],
  excludedKeys: readonly FilterJoinKey[] = [],
): string {
  const excluded = new Set(excludedKeys);
  return joinKeys
    .filter((key) => !excluded.has(key))
    .map((key) => FILTER_JOIN_SQL[key])
    .join(" ");
}

function canonicalAttributeCodeSql(alias: string): string {
  return `CASE WHEN ${alias}.attribute_code LIKE '1%' THEN SUBSTR(${alias}.attribute_code, 2) ELSE ${alias}.attribute_code END`;
}

function normalizeDayToken(day: string): string {
  const normalized = day.trim().toLowerCase();
  return DAY_ALIASES[normalized] ?? day.trim().toUpperCase();
}

function selectedDayCodes(days: string): string[] {
  return [...new Set(normalizeDayToken(days).split(""))]
    .filter((day) => /^[MTWRFSU]$/.test(day));
}

function minutesToTime(minutes: number): string {
  const bounded = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  const hours = Math.floor(bounded / 60);
  const remainder = bounded % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function onlineEvidenceSql(): string {
  return `(LOWER(COALESCE(m.type_name, '')) LIKE '%online%'
    OR LOWER(COALESCE(m.type_code, '')) LIKE '%online%'
    OR LOWER(COALESCE(m.building_name, '')) LIKE '%online%'
    OR LOWER(COALESCE(m.room_number, '')) LIKE '%online%'
    OR LOWER(COALESCE(s.location, '')) LIKE '%online%')`;
}

function physicalLocationEvidenceSql(): string {
  return "NULLIF(TRIM(COALESCE(NULLIF(m.building_name, ''), s.location, '')), '') IS NOT NULL";
}
