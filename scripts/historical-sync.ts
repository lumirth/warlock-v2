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
 */

// Configuration
const CONFIG = {
  CISAPI_BASE: 'https://courses.illinois.edu/cisapp/explorer',
  FRONTEND_BASE: 'https://courses.illinois.edu',
  FETCH_RETRIES: 3,
  FETCH_RETRY_DELAY_MS: 1000,
  RATE_LIMIT_DELAY_MS: 100,
  START_YEAR: 2015,
} as const;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://courses.illinois.edu/',
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
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      if (i === CONFIG.FETCH_RETRIES - 1) throw error;
      console.error(`Retry ${i + 1} for ${url}`);
      await new Promise(r => setTimeout(r, CONFIG.FETCH_RETRY_DELAY_MS * (i + 1)));
    }
  }
  throw new Error('Should not reach here');
}

async function getTerms(year: number): Promise<string[]> {
  const url = `${CONFIG.FRONTEND_BASE}/ajax/search/termlist/${year}`;
  const response = await fetch(url, { headers: BROWSER_HEADERS });
  if (!response.ok) return [];
  const data = await response.json() as Record<string, string>;
  return Object.values(data);
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

  // Parse courses
  const courseRegex = /<course id="(\d+)"[^>]*>[\s\S]*?<label>([^<]*)<\/label>[\s\S]*?(?:<description>([^<]*)<\/description>)?[\s\S]*?(?:<creditHours>([^<]*)<\/creditHours>)?[\s\S]*?<\/course>/g;
  let match;

  // Simplified parsing - extract course blocks
  const courseBlocks = xml.match(/<course id="[^"]*"[\s\S]*?<\/course>/g) || [];

  for (const block of courseBlocks) {
    const idMatch = block.match(/<course id="(\d+)"/);
    const labelMatch = block.match(/<label>([^<]*)<\/label>/);
    const descMatch = block.match(/<description>([^<]*)<\/description>/);
    const creditMatch = block.match(/<creditHours>([^<]*)<\/creditHours>/);
    const genedMatch = block.match(/<genEdCategory[^>]*id="([^"]+)"/);

    if (idMatch && labelMatch) {
      const courseId = `${subjectId}-${idMatch[1]}`;
      courses.push({
        id: idMatch[1],
        subject: subjectId,
        number: idMatch[1],
        title: labelMatch[1],
        description: descMatch ? descMatch[1] : null,
        creditHours: creditMatch ? creditMatch[1] : '0',
        gened: genedMatch ? genedMatch[1] : null,
      });

      // Parse sections for this course
      const courseSections: Section[] = [];
      const sectionBlocks = block.match(/<section id="[^"]*"[\s\S]*?<\/section>/g) || [];

      for (const sectionBlock of sectionBlocks) {
        const crnMatch = sectionBlock.match(/<section id="(\d+)"/);
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

async function syncYear(year: number): Promise<void> {
  console.error(`\n-- Syncing year ${year}`);
  const terms = await getTerms(year);

  for (const term of terms) {
    console.error(`-- Syncing ${year} ${term}`);
    const subjects = await getSubjects(year, term);
    console.error(`--   Found ${subjects.length} subjects`);

    let totalCourses = 0;
    let totalSections = 0;

    for (const subject of subjects) {
      try {
        const url = `${CONFIG.CISAPI_BASE}/schedule/${year}/${term}/${subject}.xml?mode=cascade`;
        const xml = await fetchWithRetry(url);
        const { courses, sections } = parseSubjectCascade(xml, subject);

        const now = Math.floor(Date.now() / 1000);

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

          // Output course INSERT
          console.log(`INSERT OR REPLACE INTO courses (id, subject, number, title, description, credit_hours, gened, year, term, primary_instructor, last_synced) VALUES (${escapeSQL(courseId)}, ${escapeSQL(subject)}, ${escapeSQL(course.number)}, ${escapeSQL(course.title)}, ${escapeSQL(course.description)}, ${creditHours ?? 'NULL'}, ${escapeSQL(course.gened)}, ${year}, ${escapeSQL(term)}, ${escapeSQL(primaryInstructorName)}, ${now});`);
          totalCourses++;

          // Output section INSERTs
          for (const section of courseSections) {
            const instructorName = section.instructors[0]
              ? `${section.instructors[0].lastName}${section.instructors[0].firstName ? `, ${section.instructors[0].firstName.charAt(0)}` : ''}`
              : null;
            const location = `${section.buildingName} ${section.roomNumber}`.trim() || null;

            console.log(`INSERT OR REPLACE INTO sections (crn, course_id, section_number, status, type, days, start_time, end_time, location, instructor, last_synced) VALUES (${escapeSQL(section.crn)}, ${escapeSQL(courseId)}, ${escapeSQL(section.sectionNumber)}, ${escapeSQL(section.enrollmentStatus)}, ${escapeSQL(section.type)}, ${escapeSQL(section.daysOfTheWeek)}, ${escapeSQL(section.startTime || null)}, ${escapeSQL(section.endTime || null)}, ${escapeSQL(location)}, ${escapeSQL(instructorName)}, ${now});`);
            totalSections++;
          }
        }

        // Rate limit: wait a bit between subjects
        await new Promise(r => setTimeout(r, CONFIG.RATE_LIMIT_DELAY_MS));
      } catch (error) {
        console.error(`--   Error syncing ${subject}: ${error}`);
      }
    }

    console.error(`--   Synced ${totalCourses} courses, ${totalSections} sections for ${year} ${term}`);

    // Update term_state
    const termId = `${year}-${term}`;
    const now = Math.floor(Date.now() / 1000);
    // Check if any enrollment status is not UNKNOWN to determine if active
    console.log(`INSERT OR REPLACE INTO term_state (term_id, year, term, status, last_checked, last_synced, subjects_count, courses_count, sections_count) VALUES (${escapeSQL(termId)}, ${year}, ${escapeSQL(term)}, 'historical', ${now}, ${now}, ${subjects.length}, ${totalCourses}, ${totalSections});`);
  }
}

async function main() {
  // Print SQL header
  console.log('-- Historical course data sync');
  console.log('-- Generated: ' + new Date().toISOString());
  console.log('BEGIN TRANSACTION;');

  // Sync years from START_YEAR to current
  const currentYear = new Date().getFullYear();
  for (let year = CONFIG.START_YEAR; year <= currentYear; year++) {
    await syncYear(year);
  }

  console.log('COMMIT;');
  console.error('\n-- Sync complete!');
}

main().catch(console.error);
