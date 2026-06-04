#!/usr/bin/env npx tsx

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'node:url';

// Configuration
const CONFIG = {
  DB_NAME: 'course-search-db',
  OUTPUT_PATH: 'apps/api/src/services/data/valid-subjects.ts',
  // Subjects that are also common English words - unsafe for lowercase matching
  UNSAFE_LOWERCASE_SUBJECTS: new Set([
    "IS", "UP", "ME", "IT", "ON", "OR", "AS", "IF", "IN", "BY", "AN", "AT",
    "DO", "GO", "HE", "HI", "ID", "MY", "NO", "OF", "OH", "OK", "SO", "TO",
    "US", "WE", "AM", "BE", "LAW", "ART", "BUS", "ENG", "HIS", "HUM", "SAME",
    "SE", "ONE", "TWO", "SIX", "TEN", "THE", "LAST", "LEAD", "PATH", "PORT",
    "SCAN", "A", "I"
  ]),
  // Subjects that MUST be allowed in lowercase because they are extremely common search terms
  // and unlikely to be used as normal words in a course search context
  SAFE_LOWERCASE_SUBJECTS: new Set([
    "CS", "MATH", "ECE", "STAT", "PHYS", "BIO", "CHEM", "ECON", "ADV", "PSYC",
    "PHIL", "HIST", "ENGL", "ASTR", "ANTH", "SOC", "POL", "GEOL", "LING", "MUS",
    "FIN", "BADM", "NRES", "CHBE", "JOUR", "ARCH", "DANCE", "THEA"
  ])
};

const HARDCODED_FALLBACK_SUBJECT_IDS = [
  "AAS", "ABE", "ACCY", "ACE", "ACES", "ADV", "AE", "AFAS", "AFRO", "AFST",
  "AGCM", "AGED", "AHS", "AIS", "ALEC", "ANSC", "ANTH", "ARAB", "ARCH", "ART",
  "ARTD", "ARTE", "ARTF", "ARTH", "ARTJ", "ARTS", "ASRM", "ASST", "ASTR", "ATMS",
  "BADM", "BASQ", "BCOG", "BCS", "BDI", "BIOC", "BIOE", "BIOP", "BSE", "BTW",
  "BUS", "CAS", "CB", "CDB", "CEE", "CGGE", "CHBE", "CHEM", "CHIN", "CHP",
  "CI", "CIC", "CLCV", "CLE", "CMN", "CPSC", "CS", "CSE", "CW", "CWL",
  "DANC", "DTX", "EALC", "ECE", "ECON", "EDPR", "EDUC", "EIL", "ENG", "ENGL",
  "ENSU", "ENT", "ENVS", "EPOL", "EPSY", "ERAM", "ESE", "ESL", "ETMA", "EURO",
  "EXP", "FAA", "FIN", "FLTE", "FR", "FSHN", "GC", "GEOL", "GER", "GGIS",
  "GLBL", "GMC", "GRK", "GRKM", "GSD", "GWS", "HBSE", "HDFS", "HEBR", "HIST",
  "HK", "HNDI", "HORT", "HT", "HUM", "IB", "IE", "INFO", "IS", "ITAL",
  "JAPN", "JOUR", "JS", "KOR", "LA", "LAS", "LAST", "LAT", "LAW", "LCTL",
  "LEAD", "LER", "LING", "LLS", "MACS", "MATH", "MBA", "MCB", "MDIA", "MDVL",
  "ME", "MICR", "MILS", "MIP", "MSE", "MUS", "MUSC", "MUSE", "NE", "NEUR",
  "NPRE", "NRES", "NS", "NUTR", "PATH", "PERS", "PHIL", "PHYS", "PLPA", "POL",
  "PORT", "PS", "PSM", "PSYC", "QUEC", "REES", "REL", "RHET", "RMLG", "RST",
  "RUSS", "SAME", "SBC", "SCAN", "SE", "SHS", "SLAV", "SLCL", "SOC", "SOCW",
  "SPAN", "SPED", "STAT", "SWAH", "TAM", "TE", "THEA", "TMGT", "TRST", "TURK",
  "UKR", "UP", "VCM", "VM", "WLOF", "WRIT", "YDSH"
];

type GenerateSubjectsArgs = {
  allowHardcodedFallback: boolean;
};

interface D1Result {
  results: SubjectRow[];
  success: boolean;
  meta: unknown;
}

interface SubjectRow {
  id: string;
  name: string;
}

function normalizeSubjectAlias(value: string): string {
  return value
    .replace(/&amp;/g, ' and ')
    .replace(/&/g, ' and ')
    .replace(/[-/_,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

const EXTRA_SUBJECT_ALIASES: Record<string, string[]> = {
  ANTH: ['anthro'],
  CS: ['comp sci', 'comp-sci'],
  ECE: ['electrical computer engineering', 'elec comp eng'],
  MCB: ['molecular cellular biology', 'molecular cell bio'],
  PS: ['poli sci', 'poly sci', 'political sci'],
  PSYC: ['psych'],
  STAT: ['stats'],
};

function subjectAliases(subject: SubjectRow): string[] {
  const normalizedName = normalizeSubjectAlias(subject.name);
  const aliases = new Set<string>();
  const unsafeSubjectCode = CONFIG.UNSAFE_LOWERCASE_SUBJECTS.has(subject.id);
  const isOneWordName = normalizedName.split(/\s+/).length === 1;

  if (!(unsafeSubjectCode && isOneWordName)) {
    aliases.add(normalizedName);
  }

  if (!unsafeSubjectCode) {
    aliases.add(subject.id.toLowerCase());
  }

  if (normalizedName.includes(' and ')) {
    aliases.add(normalizedName.replace(/\band\b/g, ' ').replace(/\s+/g, ' ').trim());
  }

  if (normalizedName.endsWith(' courses')) {
    const withoutSuffix = normalizedName.replace(/\s+courses$/, '');
    if (!(unsafeSubjectCode && withoutSuffix.split(/\s+/).length === 1)) {
      aliases.add(withoutSuffix);
    }
  }

  for (const alias of EXTRA_SUBJECT_ALIASES[subject.id] ?? []) {
    aliases.add(normalizeSubjectAlias(alias));
  }

  return uniqueSorted(Array.from(aliases));
}

export function fetchSubjectsFromD1(
  runCommand: typeof execSync = execSync
): SubjectRow[] {
  console.log(`Fetching subjects from D1 database (${CONFIG.DB_NAME})...`);
  try {
    // Execute SQL query via Wrangler
    const cmd = `npx wrangler d1 execute ${CONFIG.DB_NAME} --command="SELECT DISTINCT id, COALESCE(name, id) AS name FROM subjects ORDER BY id" --json --remote`;
    const output = String(runCommand(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }));

    const parsed = JSON.parse(output) as D1Result[];

    if (!parsed || parsed.length === 0 || !parsed[0].success) {
      throw new Error('D1 query failed or returned no results');
    }

    return parsed[0].results.map(row => ({ id: row.id, name: row.name || row.id }));
  } catch (error) {
    console.error('Failed to fetch subjects from D1:', error);
    return [];
  }
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export async function fetchSubjectsFromCisApi(
  fetcher: typeof fetch = fetch
): Promise<SubjectRow[]> {
  console.log('Fetching subjects from CISAPI (fallback)...');
  const year = new Date().getFullYear();
  // Actually, better to fetch all terms for current year?
  // For simplicity/robustness, let's just fetch the current valid XML I found earlier.
  // https://courses.illinois.edu/cisapp/explorer/schedule/2026/spring.xml

  // Dynamic current term determination
  const terms = ['spring', 'fall', 'summer', 'winter'];
  const subjects = new Map<string, string>();

  // Try to fetch current and next year to be safe
  const years = [year, year + 1];

  for (const y of years) {
    for (const t of terms) {
      try {
        const url = `https://courses.illinois.edu/cisapp/explorer/schedule/${y}/${t}.xml`;
        const response = await fetcher(url);
        if (!response.ok) continue;

        const text = await response.text();
        const regex = /<subject id="([^"]+)"[^>]*>([^<]+)<\/subject>/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
          subjects.set(match[1], decodeXmlText(match[2]));
        }
      } catch {
        // Ignore errors for future terms that don't exist
      }
    }
  }

  if (subjects.size === 0) {
     console.warn('CISAPI fetch returned no subjects.');
     return [];
  }

  return Array.from(subjects.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function hardcodedFallbackSubjects(): SubjectRow[] {
  return HARDCODED_FALLBACK_SUBJECT_IDS.map(id => ({ id, name: id }));
}

function generateFileContent(subjects: SubjectRow[]): string {
  const timestamp = new Date().toISOString();
  const subjectIds = subjects.map(subject => subject.id);
  const subjectNames = Object.fromEntries(subjects.map(subject => [subject.id, subject.name]));
  const subjectAliasEntries = subjects.map(subject => ({
    subject: subject.id,
    aliases: subjectAliases(subject),
  }));

  // Convert Sets to arrays for JSON stringification
  const unsafeList = Array.from(CONFIG.UNSAFE_LOWERCASE_SUBJECTS).sort();
  const safeList = Array.from(CONFIG.SAFE_LOWERCASE_SUBJECTS).map(s => s.toLowerCase()).sort();

  return `// Auto-generated by scripts/generate-subjects.ts
// Generated at: ${timestamp}
// Excludes common words that are also subject codes (IS, UP, ME, etc.)
// These "unsafe" codes are only matched if uppercase or part of a clear course code (e.g. "IS 500")

export const VALID_SUBJECTS = new Set([
${subjectIds.map(s => `  "${s}"`).join(',\n')}
]);

export const SUBJECT_NAMES: Record<string, string> = ${JSON.stringify(subjectNames, null, 2)};

export const SUBJECT_ALIASES: Array<{ subject: string; aliases: string[] }> = ${JSON.stringify(subjectAliasEntries, null, 2)};

// Subjects that are also common English words - unsafe for lowercase matching
export const UNSAFE_LOWERCASE_SUBJECTS = new Set([
${unsafeList.map(s => `  "${s}"`).join(',\n')}
]);

// Subjects that MUST be allowed in lowercase because they are extremely common search terms
// and unlikely to be used as normal words in a course search context (or the ambiguity is acceptable)
export const SAFE_LOWERCASE_SUBJECTS = new Set([
${safeList.map(s => `  "${s}"`).join(',\n')}
]);
`;
}

export function parseGenerateSubjectsArgs(argv: string[]): GenerateSubjectsArgs {
  return {
    allowHardcodedFallback: argv.includes('--allow-hardcoded-fallback'),
  };
}

export async function resolveSubjects(options: {
  fetchFromCisApi?: () => Promise<SubjectRow[]>;
  fetchFromD1?: () => SubjectRow[];
  allowHardcodedFallback?: boolean;
} = {}): Promise<SubjectRow[]> {
  const subjectsFromCisApi = await (options.fetchFromCisApi ?? fetchSubjectsFromCisApi)();
  if (subjectsFromCisApi.length > 0) {
    return subjectsFromCisApi;
  }

  const subjectsFromD1 = (options.fetchFromD1 ?? fetchSubjectsFromD1)();
  if (subjectsFromD1.length > 0) {
    return subjectsFromD1;
  }

  if (options.allowHardcodedFallback) {
    console.warn('Using explicit hardcoded subject fallback.');
    return hardcodedFallbackSubjects();
  }

  throw new Error('No authoritative subject source returned data. Refusing to overwrite generated subjects.');
}

async function main() {
  const args = parseGenerateSubjectsArgs(process.argv.slice(2));
  const subjects = await resolveSubjects({
    allowHardcodedFallback: args.allowHardcodedFallback,
  });

  finish(subjects);
}

function finish(subjects: SubjectRow[]) {
  console.log(`Found ${subjects.length} subjects.`);

  const content = generateFileContent(subjects);

  // Ensure directory exists
  const outputDir = path.dirname(CONFIG.OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(CONFIG.OUTPUT_PATH, content);
  console.log(`Generated ${CONFIG.OUTPUT_PATH}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
