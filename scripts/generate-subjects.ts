#!/usr/bin/env npx tsx

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Configuration
const CONFIG = {
  DB_NAME: 'course-search-db',
  OUTPUT_PATH: 'apps/api/src/services/data/valid-subjects.ts',
  // Subjects that are also common English words - unsafe for lowercase matching
  UNSAFE_LOWERCASE_SUBJECTS: new Set([
    "IS", "UP", "ME", "IT", "ON", "OR", "AS", "IF", "IN", "BY", "AN", "AT",
    "DO", "GO", "HE", "HI", "ID", "MY", "NO", "OF", "OH", "OK", "SO", "TO",
    "US", "WE", "AM", "BE", "LAW", "ART", "BUS", "ENG", "HIS", "HUM", "SAME",
    "SE", "ONE", "TWO", "SIX", "TEN", "THE", "A", "I"
  ]),
  // Subjects that MUST be allowed in lowercase because they are extremely common search terms
  // and unlikely to be used as normal words in a course search context
  SAFE_LOWERCASE_SUBJECTS: new Set([
    "CS", "MATH", "ECE", "STAT", "PHYS", "BIO", "CHEM", "ECON", "ADV", "PSYC",
    "PHIL", "HIST", "ENGL", "ASTR", "ANTH", "SOC", "POL", "GEOL", "LING", "MUS",
    "FIN", "BADM", "NRES", "CHBE", "JOUR", "ARCH", "DANCE", "THEA"
  ])
};

interface D1Result {
  results: { id: string }[];
  success: boolean;
  meta: any;
}

function fetchSubjectsFromD1(): string[] {
  console.log(`Fetching subjects from D1 database (${CONFIG.DB_NAME})...`);
  try {
    // Execute SQL query via Wrangler
    const cmd = `npx wrangler d1 execute ${CONFIG.DB_NAME} --command="SELECT DISTINCT id FROM subjects ORDER BY id" --json --remote`;
    const output = execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

    const parsed = JSON.parse(output) as D1Result[];

    if (!parsed || parsed.length === 0 || !parsed[0].success) {
      throw new Error('D1 query failed or returned no results');
    }

    return parsed[0].results.map(row => row.id);
  } catch (error) {
    console.error('Failed to fetch subjects from D1:', error);
    return [];
  }
}

async function fetchSubjectsFromCisApi(): Promise<string[]> {
  console.log('Fetching subjects from CISAPI (fallback)...');
  const year = new Date().getFullYear();
  // Actually, better to fetch all terms for current year?
  // For simplicity/robustness, let's just fetch the current valid XML I found earlier.
  // https://courses.illinois.edu/cisapp/explorer/schedule/2026/spring.xml

  // Dynamic current term determination
  const terms = ['spring', 'fall', 'summer', 'winter'];
  const subjects = new Set<string>();

  // Try to fetch current and next year to be safe
  const years = [year, year + 1];

  for (const y of years) {
    for (const t of terms) {
      try {
        const url = `https://courses.illinois.edu/cisapp/explorer/schedule/${y}/${t}.xml`;
        const response = await fetch(url);
        if (!response.ok) continue;

        const text = await response.text();
        const regex = /<subject id="([^"]+)"/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
          subjects.add(match[1]);
        }
      } catch {
        // Ignore errors for future terms that don't exist
      }
    }
  }

  if (subjects.size === 0) {
     // Fallback to hardcoded list if EVERYTHING fails (network offline)
     console.warn('CISAPI fetch failed. Using fallback list.');
     return [
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
  }

  return Array.from(subjects).sort();
}

function generateFileContent(subjects: string[]): string {
  const timestamp = new Date().toISOString();

  // Convert Sets to arrays for JSON stringification
  const unsafeList = Array.from(CONFIG.UNSAFE_LOWERCASE_SUBJECTS).sort();
  const safeList = Array.from(CONFIG.SAFE_LOWERCASE_SUBJECTS).map(s => s.toLowerCase()).sort();

  return `// Auto-generated by scripts/generate-subjects.ts
// Generated at: ${timestamp}
// Excludes common words that are also subject codes (IS, UP, ME, etc.)
// These "unsafe" codes are only matched if uppercase or part of a clear course code (e.g. "IS 500")

export const VALID_SUBJECTS = new Set([
${subjects.map(s => `  "${s}"`).join(',\n')}
]);

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

function main() {
  let subjects = fetchSubjectsFromD1();

  if (subjects.length === 0) {
    // If D1 fails (e.g. no auth), fallback to CISAPI
    // This allows build to succeed in CI/CD without D1 tokens
    import('node:process').then(async () => {
       subjects = await fetchSubjectsFromCisApi();
       finish(subjects);
    });
  } else {
    finish(subjects);
  }
}

function finish(subjects: string[]) {
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

main();
