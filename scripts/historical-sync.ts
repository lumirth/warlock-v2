#!/usr/bin/env npx tsx
/**
 * Historical Sync Script
 *
 * Fetches all historical course data from CISAPI and writes SQL inserts
 * that can be executed against D1.
 *
 * Usage:
 *   npx tsx scripts/historical-sync.ts > historical-data.sql
 *   wrangler d1 execute course-search-db --remote --file=historical-data.sql
 *
 * Options:
 *   --start-year=YYYY  Start year (default: 2015)
 *   --end-year=YYYY    End year (default: current year)
 *   --term=TERM        Only sync specific term (e.g., spring, fall)
 *   --dry-run          Don't output SQL, just show what would be synced
 */

// Configuration
const CONFIG = {
  CISAPI_BASE: 'https://courses.illinois.edu/cisapp/explorer',
  FRONTEND_BASE: 'https://courses.illinois.edu',
  FETCH_RETRIES: 5,
  FETCH_RETRY_DELAY_MS: 2000,
  // WAF limit: 500 requests per 5 minutes = 1.67 req/sec
  // With PARALLEL_BATCH_SIZE requests in parallel, we need to wait
  // (PARALLEL_BATCH_SIZE / 1.67) seconds between batches
  PARALLEL_BATCH_SIZE: 5,
  // Delay between batches to stay under rate limit: 5 requests / 1.67 req/sec = 3 seconds
  BATCH_DELAY_MS: 3000,
  // Backoff when rate limited (403/429) - wait 60s, then 120s, etc.
  RATE_LIMIT_BACKOFF_MS: 60000,
  START_YEAR: 2004,  // CISAPI data goes back to 2004
} as const;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://courses.illinois.edu/',
};

// Parse command line arguments
interface Args {
  startYear: number;
  endYear: number;
  termFilter: string | null;
  dryRun: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const currentYear = new Date().getFullYear();

  let startYear = CONFIG.START_YEAR;
  let endYear = currentYear;
  let termFilter: string | null = null;
  let dryRun = false;

  for (const arg of args) {
    if (arg.startsWith('--start-year=')) {
      startYear = parseInt(arg.split('=')[1], 10);
      if (isNaN(startYear)) {
        console.error(`Invalid --start-year value: ${arg}`);
        process.exit(1);
      }
    } else if (arg.startsWith('--end-year=')) {
      endYear = parseInt(arg.split('=')[1], 10);
      if (isNaN(endYear)) {
        console.error(`Invalid --end-year value: ${arg}`);
        process.exit(1);
      }
    } else if (arg.startsWith('--term=')) {
      termFilter = arg.split('=')[1].toLowerCase();
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Historical Sync Script

Usage:
  npx tsx scripts/historical-sync.ts [options] > historical-data.sql

Options:
  --start-year=YYYY  Start year (default: ${CONFIG.START_YEAR})
  --end-year=YYYY    End year (default: ${currentYear})
  --term=TERM        Only sync specific term (e.g., spring, fall, summer, winter)
  --dry-run          Don't output SQL, just show what would be synced
  --help, -h         Show this help message

Examples:
  npx tsx scripts/historical-sync.ts > all-data.sql
  npx tsx scripts/historical-sync.ts --start-year=2020 > recent-data.sql
  npx tsx scripts/historical-sync.ts --term=fall --start-year=2023 > fall-2023.sql
  npx tsx scripts/historical-sync.ts --dry-run
`);
      process.exit(0);
    }
  }

  if (startYear > endYear) {
    console.error(`Error: --start-year (${startYear}) cannot be greater than --end-year (${endYear})`);
    process.exit(1);
  }

  return { startYear, endYear, termFilter, dryRun };
}

// Statistics tracking
interface SyncStats {
  totalYears: number;
  totalTerms: number;
  totalSubjects: number;
  totalCourses: number;
  totalSections: number;
  failedSubjects: string[];
  retriedRequests: number;
  termStats: Map<string, { courses: number; sections: number; subjects: number }>;
}

const stats: SyncStats = {
  totalYears: 0,
  totalTerms: 0,
  totalSubjects: 0,
  totalCourses: 0,
  totalSections: 0,
  failedSubjects: [],
  retriedRequests: 0,
  termStats: new Map(),
};

interface Course {
  id: string;
  subject: string;
  number: string;
  title: string;
  description: string | null;
  creditHours: string;
  gened: string | null;
}

interface Section {
  crn: string;
  sectionNumber: string;
  type: string;
  enrollmentStatus: string;
  startTime: string;
  endTime: string;
  daysOfTheWeek: string;
  buildingName: string;
  roomNumber: string;
  instructors: { firstName: string; lastName: string }[];
}

async function fetchWithRetry(url: string): Promise<string> {
  for (let i = 0; i < CONFIG.FETCH_RETRIES; i++) {
    try {
      const response = await fetch(url, { headers: BROWSER_HEADERS });

      // Check for rate limit / WAF block
      if (response.status === 403 || response.status === 429) {
        const waitTime = CONFIG.RATE_LIMIT_BACKOFF_MS * (i + 1);
        console.error(`[RATE LIMITED] ${response.status} - waiting ${waitTime / 1000}s before retry`);
        stats.retriedRequests++;
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      if (i === CONFIG.FETCH_RETRIES - 1) throw error;
      stats.retriedRequests++;
      console.error(`[RETRY ${i + 1}/${CONFIG.FETCH_RETRIES}] ${url}`);
      await new Promise(r => setTimeout(r, CONFIG.FETCH_RETRY_DELAY_MS * (i + 1)));
    }
  }
  throw new Error('Should not reach here');
}

async function getTerms(year: number): Promise<string[]> {
  // Try AJAX endpoint first (faster, but may be blocked)
  const ajaxUrl = `${CONFIG.FRONTEND_BASE}/ajax/search/termlist/${year}`;
  try {
    const response = await fetch(ajaxUrl, { headers: BROWSER_HEADERS });
    if (response.ok) {
      const data = await response.json() as Record<string, string>;
      const terms = Object.values(data);
      if (terms.length > 0) return terms;
    }
  } catch {
    // Fall through to XML approach
  }

  // Fallback: try known term patterns via XML API
  const possibleTerms = ['winter', 'spring', 'summer', 'fall'];
  const validTerms: string[] = [];

  for (const term of possibleTerms) {
    try {
      const url = `${CONFIG.CISAPI_BASE}/schedule/${year}/${term}.xml`;
      const response = await fetch(url, { headers: BROWSER_HEADERS });
      if (response.ok) {
        const text = await response.text();
        // Check if it's a valid XML response (not HTML error)
        if (text.includes('<subject') || text.includes('<ns2:')) {
          validTerms.push(term);
        }
      }
      await new Promise(r => setTimeout(r, CONFIG.RATE_LIMIT_DELAY_MS));
    } catch {
      // Term doesn't exist for this year
    }
  }

  return validTerms;
}

async function getSubjects(year: number, term: string): Promise<string[]> {
  const url = `${CONFIG.CISAPI_BASE}/schedule/${year}/${term}.xml`;
  try {
    const xml = await fetchWithRetry(url);
    const subjects: string[] = [];
    const regex = /<subject id="([^"]+)"/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      subjects.push(match[1]);
    }
    return subjects;
  } catch {
    return [];
  }
}

function parseSubjectCascade(xml: string, subjectId: string): { courses: Course[]; sections: Map<string, Section[]> } {
  const courses: Course[] = [];
  const sections = new Map<string, Section[]>();

  // Extract cascadingCourse blocks (the API uses this element name in cascade mode)
  const courseBlocks = xml.match(/<cascadingCourse id="[^"]*"[\s\S]*?<\/cascadingCourse>/g) || [];

  for (const block of courseBlocks) {
    // cascadingCourse id is like "CS 101" - extract course number from it
    const cascadeIdMatch = block.match(/<cascadingCourse id="[A-Z]+\s*(\d+[A-Z]*)"/i);
    const labelMatch = block.match(/<label>([^<]*)<\/label>/);
    const descMatch = block.match(/<description>([^<]*)<\/description>/);
    const creditMatch = block.match(/<creditHours>([^<]*)<\/creditHours>/);
    const genedMatch = block.match(/<category id="([^"]+)"/);

    if (cascadeIdMatch && labelMatch) {
      const courseNumber = cascadeIdMatch[1];
      const courseId = `${subjectId}-${courseNumber}`;
      courses.push({
        id: courseNumber,
        subject: subjectId,
        number: courseNumber,
        title: labelMatch[1],
        description: descMatch ? descMatch[1] : null,
        creditHours: creditMatch ? creditMatch[1] : '0',
        gened: genedMatch ? genedMatch[1] : null,
      });

      // Parse sections for this course (API uses detailedSection in cascade mode)
      const courseSections: Section[] = [];
      const sectionBlocks = block.match(/<detailedSection id="[^"]*"[\s\S]*?<\/detailedSection>/g) || [];

      for (const sectionBlock of sectionBlocks) {
        const crnMatch = sectionBlock.match(/<detailedSection id="(\d+)"/);
        const sectionNumMatch = sectionBlock.match(/<sectionNumber>([^<]*)<\/sectionNumber>/);
        const typeMatch = sectionBlock.match(/<type[^>]*>([^<]*)<\/type>/);
        const statusMatch = sectionBlock.match(/<enrollmentStatus>([^<]*)<\/enrollmentStatus>/);
        const startMatch = sectionBlock.match(/<start>([^<]*)<\/start>/);
        const endMatch = sectionBlock.match(/<end>([^<]*)<\/end>/);
        const daysMatch = sectionBlock.match(/<daysOfTheWeek>([^<]*)<\/daysOfTheWeek>/);
        const buildingMatch = sectionBlock.match(/<buildingName>([^<]*)<\/buildingName>/);
        const roomMatch = sectionBlock.match(/<roomNumber>([^<]*)<\/roomNumber>/);

        // Parse instructors
        const instructors: { firstName: string; lastName: string }[] = [];
        const instructorBlocks = sectionBlock.match(/<instructor>[\s\S]*?<\/instructor>/g) || [];
        for (const instBlock of instructorBlocks) {
          const firstMatch = instBlock.match(/<firstName>([^<]*)<\/firstName>/);
          const lastMatch = instBlock.match(/<lastName>([^<]*)<\/lastName>/);
          if (firstMatch && lastMatch) {
            instructors.push({ firstName: firstMatch[1], lastName: lastMatch[1] });
          }
        }

        if (crnMatch) {
          courseSections.push({
            crn: crnMatch[1],
            sectionNumber: sectionNumMatch ? sectionNumMatch[1] : '',
            type: typeMatch ? typeMatch[1] : '',
            enrollmentStatus: statusMatch ? statusMatch[1] : 'UNKNOWN',
            startTime: startMatch ? startMatch[1] : '',
            endTime: endMatch ? endMatch[1] : '',
            daysOfTheWeek: daysMatch ? daysMatch[1] : '',
            buildingName: buildingMatch ? buildingMatch[1] : '',
            roomNumber: roomMatch ? roomMatch[1] : '',
            instructors,
          });
        }
      }

      sections.set(courseId, courseSections);
    }
  }

  return { courses, sections };
}

function escapeSQL(str: string | null): string {
  if (str === null) return 'NULL';
  return `'${str.replace(/'/g, "''")}'`;
}

function makeCourseId(subject: string, number: string, year: number, term: string): string {
  return `${subject}-${number}-${year}-${term}`;
}

async function syncTerm(year: number, term: string, dryRun: boolean): Promise<{ courses: number; sections: number; subjects: number }> {
  const termId = `${year}-${term}`;
  console.error(`[TERM] ${termId} - fetching subjects...`);

  const subjects = await getSubjects(year, term);
  console.error(`[TERM] ${termId} - found ${subjects.length} subjects`);

  let totalCourses = 0;
  let totalSections = 0;

  // Process subjects in parallel batches
  for (let batchStart = 0; batchStart < subjects.length; batchStart += CONFIG.PARALLEL_BATCH_SIZE) {
    const batch = subjects.slice(batchStart, batchStart + CONFIG.PARALLEL_BATCH_SIZE);
    const batchNum = Math.floor(batchStart / CONFIG.PARALLEL_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(subjects.length / CONFIG.PARALLEL_BATCH_SIZE);

    // Process batch in parallel
    const results = await Promise.all(batch.map(async (subject, idx) => {
      const globalIdx = batchStart + idx + 1;
      const progress = `[${globalIdx}/${subjects.length}]`;

      try {
        const url = `${CONFIG.CISAPI_BASE}/schedule/${year}/${term}/${subject}.xml?mode=cascade`;
        const xml = await fetchWithRetry(url);
        const { courses, sections } = parseSubjectCascade(xml, subject);

        const now = Math.floor(Date.now() / 1000);
        const sqlStatements: string[] = [];

        for (const course of courses) {
          const courseId = makeCourseId(subject, course.number, year, term);
          const courseSections = sections.get(`${subject}-${course.number}`) || [];

          // Get primary instructor from first lecture section
          const lectureSection = courseSections.find(s =>
            s.type.toLowerCase().includes('lecture') || s.type.toLowerCase().includes('lec')
          ) || courseSections[0];
          const primaryInstructor = lectureSection?.instructors[0];
          const primaryInstructorName = primaryInstructor
            ? `${primaryInstructor.lastName}${primaryInstructor.firstName ? `, ${primaryInstructor.firstName.charAt(0)}` : ''}`
            : null;

          const creditHours = parseInt(course.creditHours) || null;

          // Collect SQL statements
          if (!dryRun) {
            sqlStatements.push(`INSERT OR REPLACE INTO courses (id, subject, number, title, description, credit_hours, gened, year, term, primary_instructor, last_synced) VALUES (${escapeSQL(courseId)}, ${escapeSQL(subject)}, ${escapeSQL(course.number)}, ${escapeSQL(course.title)}, ${escapeSQL(course.description)}, ${creditHours ?? 'NULL'}, ${escapeSQL(course.gened)}, ${year}, ${escapeSQL(term)}, ${escapeSQL(primaryInstructorName)}, ${now});`);
          }

          for (const section of courseSections) {
            const instructorName = section.instructors[0]
              ? `${section.instructors[0].lastName}${section.instructors[0].firstName ? `, ${section.instructors[0].firstName.charAt(0)}` : ''}`
              : null;
            const location = `${section.buildingName} ${section.roomNumber}`.trim() || null;

            if (!dryRun) {
              sqlStatements.push(`INSERT OR REPLACE INTO sections (crn, course_id, section_number, status, type, days, start_time, end_time, location, instructor, last_synced) VALUES (${escapeSQL(section.crn)}, ${escapeSQL(courseId)}, ${escapeSQL(section.sectionNumber)}, ${escapeSQL(section.enrollmentStatus)}, ${escapeSQL(section.type)}, ${escapeSQL(section.daysOfTheWeek)}, ${escapeSQL(section.startTime || null)}, ${escapeSQL(section.endTime || null)}, ${escapeSQL(location)}, ${escapeSQL(instructorName)}, ${now});`);
            }
          }
        }

        return {
          subject,
          progress,
          success: true,
          coursesCount: courses.length,
          sectionsCount: sections.size,
          sqlStatements
        };
      } catch (error) {
        const errorMsg = `${year}/${term}/${subject}: ${error}`;
        stats.failedSubjects.push(errorMsg);
        return {
          subject,
          progress,
          success: false,
          coursesCount: 0,
          sectionsCount: 0,
          sqlStatements: [],
          error: String(error)
        };
      }
    }));

    // Output results in order (to maintain deterministic SQL output)
    for (const result of results) {
      if (result.success) {
        for (const sql of result.sqlStatements) {
          console.log(sql);
        }
        totalCourses += result.coursesCount;
        totalSections += result.sectionsCount;
        console.error(`${result.progress} ${result.subject}: ${result.coursesCount} courses, ${result.sectionsCount} with sections`);
      } else {
        console.error(`${result.progress} [ERROR] ${result.subject}: ${result.error}`);
      }
    }

    // Rate limit: wait between batches (not between individual requests)
    if (batchStart + CONFIG.PARALLEL_BATCH_SIZE < subjects.length) {
      console.error(`  [batch ${batchNum}/${totalBatches}] waiting ${CONFIG.BATCH_DELAY_MS}ms for rate limit...`);
      await new Promise(r => setTimeout(r, CONFIG.BATCH_DELAY_MS));
    }
  }

  // Output term_state INSERT (idempotent)
  const now = Math.floor(Date.now() / 1000);
  if (!dryRun) {
    console.log(`INSERT OR REPLACE INTO term_state (term_id, year, term, status, last_checked, last_synced, subjects_count, courses_count, sections_count) VALUES (${escapeSQL(termId)}, ${year}, ${escapeSQL(term)}, 'historical', ${now}, ${now}, ${subjects.length}, ${totalCourses}, ${totalSections});`);
  }

  console.error(`[TERM] ${termId} - COMPLETE: ${totalCourses} courses, ${totalSections} sections`);

  return { courses: totalCourses, sections: totalSections, subjects: subjects.length };
}

async function syncYear(year: number, termFilter: string | null, dryRun: boolean): Promise<void> {
  console.error(`\n${'='.repeat(60)}`);
  console.error(`[YEAR] ${year} - discovering terms...`);

  let terms = await getTerms(year);

  if (termFilter) {
    terms = terms.filter(t => t.toLowerCase() === termFilter);
    if (terms.length === 0) {
      console.error(`[YEAR] ${year} - no matching term for filter "${termFilter}"`);
      return;
    }
  }

  console.error(`[YEAR] ${year} - syncing ${terms.length} terms: ${terms.join(', ')}`);
  stats.totalYears++;

  for (const term of terms) {
    stats.totalTerms++;
    const termStats = await syncTerm(year, term, dryRun);

    stats.totalSubjects += termStats.subjects;
    stats.totalCourses += termStats.courses;
    stats.totalSections += termStats.sections;
    stats.termStats.set(`${year}-${term}`, termStats);
  }
}

function printSummary(args: Args, startTime: Date): void {
  const endTime = new Date();
  const durationMs = endTime.getTime() - startTime.getTime();
  const durationMin = (durationMs / 1000 / 60).toFixed(2);

  console.error(`\n${'='.repeat(60)}`);
  console.error(`HISTORICAL SYNC SUMMARY`);
  console.error(`${'='.repeat(60)}`);
  console.error(`\nConfiguration:`);
  console.error(`  Start Year:    ${args.startYear}`);
  console.error(`  End Year:      ${args.endYear}`);
  console.error(`  Term Filter:   ${args.termFilter || '(all terms)'}`);
  console.error(`  Dry Run:       ${args.dryRun}`);

  console.error(`\nResults:`);
  console.error(`  Years Synced:      ${stats.totalYears}`);
  console.error(`  Terms Synced:      ${stats.totalTerms}`);
  console.error(`  Subjects Synced:   ${stats.totalSubjects}`);
  console.error(`  Courses Synced:    ${stats.totalCourses}`);
  console.error(`  Sections Synced:   ${stats.totalSections}`);
  console.error(`  Retried Requests:  ${stats.retriedRequests}`);
  console.error(`  Failed Subjects:   ${stats.failedSubjects.length}`);

  console.error(`\nTiming:`);
  console.error(`  Started:    ${startTime.toISOString()}`);
  console.error(`  Completed:  ${endTime.toISOString()}`);
  console.error(`  Duration:   ${durationMin} minutes`);

  if (stats.failedSubjects.length > 0) {
    console.error(`\n[WARNING] Failed subjects (${stats.failedSubjects.length}):`);
    for (const failure of stats.failedSubjects) {
      console.error(`  - ${failure}`);
    }
  }

  console.error(`\nPer-Term Breakdown:`);
  for (const [termId, termStats] of stats.termStats) {
    console.error(`  ${termId}: ${termStats.subjects} subjects, ${termStats.courses} courses, ${termStats.sections} sections`);
  }

  // Final status
  console.error(`\n${'='.repeat(60)}`);
  if (stats.failedSubjects.length === 0) {
    console.error(`✓ SYNC COMPLETE - All data fetched successfully`);
  } else {
    console.error(`⚠ SYNC COMPLETE WITH ERRORS - ${stats.failedSubjects.length} subjects failed`);
    console.error(`  Consider re-running with specific term to retry failed subjects`);
  }
  console.error(`${'='.repeat(60)}\n`);
}

async function main() {
  const args = parseArgs();
  const startTime = new Date();

  console.error(`\nHistorical Sync Starting...`);
  console.error(`  Range: ${args.startYear} - ${args.endYear}`);
  console.error(`  Term Filter: ${args.termFilter || '(all)'}`);
  console.error(`  Dry Run: ${args.dryRun}`);

  // Print SQL header (idempotent - INSERT OR REPLACE handles duplicates)
  if (!args.dryRun) {
    console.log('-- Historical course data sync');
    console.log('-- Generated: ' + new Date().toISOString());
    console.log(`-- Range: ${args.startYear} - ${args.endYear}`);
    console.log(`-- Term Filter: ${args.termFilter || 'all'}`);
    console.log('-- NOTE: Uses INSERT OR REPLACE for idempotency (safe to re-run)');
    console.log('BEGIN TRANSACTION;');
  }

  // Sync years
  for (let year = args.startYear; year <= args.endYear; year++) {
    await syncYear(year, args.termFilter, args.dryRun);
  }

  if (!args.dryRun) {
    console.log('COMMIT;');
  }

  // Print comprehensive summary
  printSummary(args, startTime);
}

main().catch(error => {
  console.error(`\n[FATAL ERROR] ${error}`);
  process.exit(1);
});
