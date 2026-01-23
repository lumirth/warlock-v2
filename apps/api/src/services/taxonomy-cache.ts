import type { D1Database } from '@cloudflare/workers-types';

export interface SubjectInfo {
  id: string;
  name: string;
}

export interface GenedInfo {
  code: string;
  name?: string;
}

export interface TaxonomyCache {
  subjects: {
    byCode: Map<string, SubjectInfo>;
    byAlias: Map<string, string>;  // lowercase alias → code
  };
  geneds: {
    byCode: Map<string, GenedInfo>;
    byAlias: Map<string, string>;  // lowercase alias → code
  };
  topics: Map<string, string>;  // abbreviation → expansion
  loadedAt: number;

  // Helper methods
  resolveSubject(input: string): string | null;
  resolveGened(input: string): string | null;
  expandTopic(input: string): string | null;
  findSubjectInText(text: string): { code: string; match: string; index: number } | null;
}

export async function loadTaxonomyCache(db: D1Database): Promise<TaxonomyCache> {
  // Load subjects
  const subjectsResult = await db.prepare('SELECT id, name FROM subjects').all<{ id: string; name: string }>();
  const subjectAliasesResult = await db.prepare('SELECT subject_id, alias FROM subject_aliases').all<{ subject_id: string; alias: string }>();

  // Load geneds
  const genedAliasesResult = await db.prepare('SELECT gened_code, alias FROM gened_aliases').all<{ gened_code: string; alias: string }>();

  // Load topics
  const topicAliasesResult = await db.prepare('SELECT abbreviation, expansion FROM topic_aliases').all<{ abbreviation: string; expansion: string }>();

  // Build subject maps
  const subjectsByCode = new Map<string, SubjectInfo>();
  const subjectsByAlias = new Map<string, string>();

  for (const subject of subjectsResult.results) {
    subjectsByCode.set(subject.id, subject);
    // Also add the code itself as an alias (lowercase)
    subjectsByAlias.set(subject.id.toLowerCase(), subject.id);
    // And the full name
    subjectsByAlias.set(subject.name.toLowerCase(), subject.id);
  }

  for (const alias of subjectAliasesResult.results) {
    subjectsByAlias.set(alias.alias.toLowerCase(), alias.subject_id);
  }

  // Build gened maps
  const genedsByCode = new Map<string, GenedInfo>();
  const genedsByAlias = new Map<string, string>();

  for (const alias of genedAliasesResult.results) {
    if (!genedsByCode.has(alias.gened_code)) {
      genedsByCode.set(alias.gened_code, { code: alias.gened_code });
    }
    genedsByAlias.set(alias.alias.toLowerCase(), alias.gened_code);
    // Also add the code itself
    genedsByAlias.set(alias.gened_code.toLowerCase(), alias.gened_code);
  }

  // Build topic map
  const topics = new Map<string, string>();
  for (const topic of topicAliasesResult.results) {
    topics.set(topic.abbreviation.toLowerCase(), topic.expansion);
  }

  const cache: TaxonomyCache = {
    subjects: { byCode: subjectsByCode, byAlias: subjectsByAlias },
    geneds: { byCode: genedsByCode, byAlias: genedsByAlias },
    topics,
    loadedAt: Date.now(),

    resolveSubject(input: string): string | null {
      const normalized = input.toLowerCase().trim();
      return this.subjects.byAlias.get(normalized) || null;
    },

    resolveGened(input: string): string | null {
      const normalized = input.toLowerCase().trim();
      return this.geneds.byAlias.get(normalized) || null;
    },

    expandTopic(input: string): string | null {
      const normalized = input.toLowerCase().trim();
      return this.topics.get(normalized) || null;
    },

    findSubjectInText(text: string): { code: string; match: string; index: number } | null {
      const normalized = text.toLowerCase();

      // Sort aliases by length (longest first) to match "computer science" before "cs"
      const sortedAliases = [...this.subjects.byAlias.entries()]
        .sort((a, b) => b[0].length - a[0].length);

      for (const [alias, code] of sortedAliases) {
        // Match as whole word
        const regex = new RegExp(`\\b${escapeRegex(alias)}\\b`, 'i');
        const match = regex.exec(normalized);
        if (match) {
          return { code, match: match[0], index: match.index };
        }
      }

      return null;
    }
  };

  return cache;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Global cache instance
let globalCache: TaxonomyCache | null = null;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;  // 6 hours

export async function getTaxonomyCache(db: D1Database): Promise<TaxonomyCache> {
  if (globalCache && (Date.now() - globalCache.loadedAt) < CACHE_TTL_MS) {
    return globalCache;
  }

  globalCache = await loadTaxonomyCache(db);
  return globalCache;
}

export function clearTaxonomyCache(): void {
  globalCache = null;
}
