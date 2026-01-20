import type {
  CISAPISubject,
  CISAPICourse,
  CISAPICourseDetail,
  CISAPISection,
  CISAPIMeeting,
  CISAPIInstructor,
  CISAPIGenEd
} from './types.js';
import { Parser } from 'htmlparser2';

// Simple XML parser for Workers (no external dependencies)
// CISAPI returns well-formed XML, so we can use regex-based parsing

export function parseSubjectsXml(xml: string): CISAPISubject[] {
  const subjects: CISAPISubject[] = [];
  const subjectRegex = /<subject\s+id="([^"]+)"\s+href="([^"]+)"[^>]*>([^<]*)<\/subject>/g;

  let match;
  while ((match = subjectRegex.exec(xml)) !== null) {
    subjects.push({
      id: match[1],
      href: match[2],
      label: match[3] || undefined
    });
  }

  return subjects;
}

export function parseCoursesXml(xml: string, subjectId: string): CISAPICourse[] {
  const courses: CISAPICourse[] = [];
  const courseRegex = /<course\s+id="([^"]+)"\s+href="([^"]+)"[^>]*>([^<]*)<\/course>/g;

  let match;
  while ((match = courseRegex.exec(xml)) !== null) {
    courses.push({
      id: match[1],
      href: match[2],
      label: match[3],
      subject: subjectId
    });
  }

  return courses;
}

export function parseCourseDetailXml(xml: string): CISAPICourseDetail | null {
  // Extract basic course info
  const idMatch = xml.match(/<course\s+id="([^"]+)"/);
  const subjectMatch = xml.match(/<subject\s+id="([^"]+)"/);
  const labelMatch = xml.match(/<label>([^<]+)<\/label>/);
  const descMatch = xml.match(/<description>([^<]*)<\/description>/s);
  const creditMatch = xml.match(/<creditHours>([^<]*)<\/creditHours>/);

  if (!idMatch || !subjectMatch) return null;

  // Parse genEd categories
  const genEdCategories: CISAPIGenEd[] = [];
  const genEdRegex = /<genEdCategory\s+id="([^"]+)"[^>]*>([^<]*)<\/genEdCategory>/g;
  let genEdMatch;
  while ((genEdMatch = genEdRegex.exec(xml)) !== null) {
    genEdCategories.push({
      id: genEdMatch[1],
      description: genEdMatch[2]
    });
  }

  // Parse sections
  const sections = parseSectionsXml(xml);

  return {
    id: idMatch[1],
    subjectId: subjectMatch[1],
    label: labelMatch?.[1] ?? '',
    description: descMatch?.[1]?.trim() ?? '',
    creditHours: creditMatch?.[1] ?? '',
    courseSectionInformation: '',
    classScheduleInformation: '',
    genEdCategories,
    sections
  };
}

function parseSectionsXml(xml: string): CISAPISection[] {
  const sections: CISAPISection[] = [];

  // Match each section block
  const sectionBlockRegex = /<section\s+id="([^"]+)"[^>]*>[\s\S]*?<\/section>/g;
  let sectionMatch;

  while ((sectionMatch = sectionBlockRegex.exec(xml)) !== null) {
    const block = sectionMatch[0];
    const crn = sectionMatch[1];

    const sectionNumberMatch = block.match(/<sectionNumber>([^<]*)<\/sectionNumber>/);
    const statusCodeMatch = block.match(/<statusCode>([^<]*)<\/statusCode>/);
    const enrollmentStatusMatch = block.match(/<enrollmentStatus>([^<]*)<\/enrollmentStatus>/);
    const startDateMatch = block.match(/<startDate>([^<]*)<\/startDate>/);
    const endDateMatch = block.match(/<endDate>([^<]*)<\/endDate>/);
    const partOfTermMatch = block.match(/<partOfTerm>([^<]*)<\/partOfTerm>/);
    const sectionStatusCodeMatch = block.match(/<sectionStatusCode>([^<]*)<\/sectionStatusCode>/);

    const meetings = parseMeetingsXml(block);

    sections.push({
      crn,
      sectionNumber: sectionNumberMatch?.[1] ?? '',
      statusCode: statusCodeMatch?.[1] ?? '',
      enrollmentStatus: enrollmentStatusMatch?.[1] ?? 'Unknown',
      startDate: startDateMatch?.[1] ?? '',
      endDate: endDateMatch?.[1] ?? '',
      partOfTerm: partOfTermMatch?.[1] ?? '',
      sectionStatusCode: sectionStatusCodeMatch?.[1] ?? '',
      meetings
    });
  }

  return sections;
}

function parseMeetingsXml(sectionXml: string): CISAPIMeeting[] {
  const meetings: CISAPIMeeting[] = [];

  const meetingBlockRegex = /<meeting>[\s\S]*?<\/meeting>/g;
  let meetingMatch;

  while ((meetingMatch = meetingBlockRegex.exec(sectionXml)) !== null) {
    const block = meetingMatch[0];

    const typeMatch = block.match(/<type\s+code="([^"]*)"[^>]*>([^<]*)<\/type>/);
    const startMatch = block.match(/<start>([^<]*)<\/start>/);
    const endMatch = block.match(/<end>([^<]*)<\/end>/);
    const daysMatch = block.match(/<daysOfTheWeek>([^<]*)<\/daysOfTheWeek>/);
    const roomMatch = block.match(/<roomNumber>([^<]*)<\/roomNumber>/);
    const buildingMatch = block.match(/<buildingName>([^<]*)<\/buildingName>/);

    const instructors = parseInstructorsXml(block);

    meetings.push({
      type: typeMatch?.[2] ?? '',
      typeCode: typeMatch?.[1] ?? '',
      start: startMatch?.[1] ?? '',
      end: endMatch?.[1] ?? '',
      daysOfTheWeek: daysMatch?.[1] ?? '',
      roomNumber: roomMatch?.[1] ?? '',
      buildingName: buildingMatch?.[1] ?? '',
      instructors
    });
  }

  return meetings;
}

function parseInstructorsXml(meetingXml: string): CISAPIInstructor[] {
  const instructors: CISAPIInstructor[] = [];

  const instructorBlockRegex = /<instructor>[\s\S]*?<\/instructor>/g;
  let instructorMatch;

  while ((instructorMatch = instructorBlockRegex.exec(meetingXml)) !== null) {
    const block = instructorMatch[0];

    const firstNameMatch = block.match(/<firstName>([^<]*)<\/firstName>/);
    const lastNameMatch = block.match(/<lastName>([^<]*)<\/lastName>/);

    if (lastNameMatch) {
      instructors.push({
        firstName: firstNameMatch?.[1] ?? '',
        lastName: lastNameMatch[1]
      });
    }
  }

  return instructors;
}

// Convert time from "09:00 AM" to "09:00" (24h format)
export function convertTo24Hour(time12: string): string {
  if (!time12) return '';

  const match = time12.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return time12;

  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const period = match[3].toUpperCase();

  if (period === 'PM' && hours !== 12) {
    hours += 12;
  } else if (period === 'AM' && hours === 12) {
    hours = 0;
  }

  return `${hours.toString().padStart(2, '0')}:${minutes}`;
}

// Subject cascade types and parser
export interface ParsedSubjectCascade {
  subjectId: string;
  subjectLabel: string;
  courses: ParsedCascadeCourse[];
}

export interface ParsedCascadeCourse {
  id: string;
  subject: string;
  title: string;
  description: string;
  creditHours: string;
  genEdCategories: string[];
  sections: ParsedCascadeSection[];
}

export interface ParsedCascadeSection {
  crn: string;
  sectionNumber: string;
  enrollmentStatus: string;
  type: string;
  startTime: string;
  endTime: string;
  daysOfTheWeek: string;
  buildingName: string;
  roomNumber: string;
  instructors: { firstName: string; lastName: string }[];
}

export function parseSubjectCascadeXml(xml: string): ParsedSubjectCascade {
  const result: ParsedSubjectCascade = { subjectId: '', subjectLabel: '', courses: [] };
  let currentCourse: ParsedCascadeCourse | null = null;
  let currentSection: ParsedCascadeSection | null = null;
  let currentInstructor: { firstName: string; lastName: string } | null = null;
  let currentText = '';
  let inMeeting = false;

  const parser = new Parser({
    onopentag(name, attrs) {
      currentText = '';

      if (name === 'ns2:subject') {
        result.subjectId = attrs.id || '';
      }
      if (name === 'cascadingCourse') {
        const courseId = (attrs.id || '').split(' ').pop() ?? attrs.id;
        currentCourse = {
          id: courseId,
          subject: result.subjectId,
          title: '',
          description: '',
          creditHours: '',
          genEdCategories: [],
          sections: []
        };
        result.courses.push(currentCourse);
      }
      if (name === 'detailedSection' && currentCourse) {
        currentSection = {
          crn: attrs.id || '',
          sectionNumber: '',
          enrollmentStatus: '',
          type: '',
          startTime: '',
          endTime: '',
          daysOfTheWeek: '',
          buildingName: '',
          roomNumber: '',
          instructors: []
        };
        currentCourse.sections.push(currentSection);
      }
      if (name === 'meeting') {
        inMeeting = true;
      }
      if (name === 'instructor' && currentSection) {
        currentInstructor = { firstName: '', lastName: '' };
      }
      if (name === 'category' && currentCourse && attrs.id) {
        currentCourse.genEdCategories.push(attrs.id);
      }
    },
    ontext(text) {
      currentText += text;
    },
    onclosetag(name) {
      const text = currentText.trim();

      // Subject-level
      if (name === 'label' && !currentCourse) {
        result.subjectLabel = text;
      }

      // Course-level fields (when not in a section)
      if (currentCourse && !currentSection) {
        if (name === 'label') currentCourse.title = text;
        if (name === 'description') currentCourse.description = text;
        if (name === 'creditHours') currentCourse.creditHours = text;
      }

      // Section-level fields
      if (currentSection) {
        if (name === 'sectionNumber') currentSection.sectionNumber = text;
        if (name === 'enrollmentStatus') currentSection.enrollmentStatus = text;
      }

      // Meeting-level fields
      if (currentSection && inMeeting) {
        if (name === 'type') currentSection.type = text;
        if (name === 'start') currentSection.startTime = convertTo24Hour(text);
        if (name === 'end') currentSection.endTime = convertTo24Hour(text);
        if (name === 'daysOfTheWeek') currentSection.daysOfTheWeek = text;
        if (name === 'buildingName') currentSection.buildingName = text;
        if (name === 'roomNumber') currentSection.roomNumber = text;
      }

      // Instructor fields
      if (currentInstructor) {
        if (name === 'firstName') currentInstructor.firstName = text;
        if (name === 'lastName') currentInstructor.lastName = text;
        if (name === 'instructor' && currentSection) {
          if (currentInstructor.lastName) {
            currentSection.instructors.push(currentInstructor);
          }
          currentInstructor = null;
        }
      }

      if (name === 'meeting') inMeeting = false;
      if (name === 'detailedSection') currentSection = null;
      if (name === 'cascadingCourse') currentCourse = null;

      currentText = '';
    }
  }, { xmlMode: true });

  parser.write(xml);
  parser.end();

  if (!result.subjectId) {
    throw new Error('Invalid XML: missing subject id');
  }

  return result;
}
