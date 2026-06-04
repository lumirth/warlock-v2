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

function decodeXmlText(value: string | undefined): string {
  if (!value) return '';

  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code: string) => {
    const normalizedCode = code.toLowerCase();
    if (normalizedCode === 'amp') return '&';
    if (normalizedCode === 'lt') return '<';
    if (normalizedCode === 'gt') return '>';
    if (normalizedCode === 'quot') return '"';
    if (normalizedCode === 'apos') return "'";
    if (normalizedCode.startsWith('#x')) {
      return String.fromCodePoint(parseInt(normalizedCode.slice(2), 16));
    }
    if (normalizedCode.startsWith('#')) {
      return String.fromCodePoint(parseInt(normalizedCode.slice(1), 10));
    }
    return entity;
  });
}

function tagText(xml: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<(?:[\\w]+:)?${escaped}[^>]*>([\\s\\S]*?)<\\/(?:[\\w]+:)?${escaped}>`).exec(xml);
  return decodeXmlText(match?.[1]).trim();
}

function textWithoutTags(xml: string): string {
  return decodeXmlText(xml.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function xmlAttribute(openTagAttributes: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\b${escaped}="([^"]*)"`).exec(openTagAttributes);
  return decodeXmlText(match?.[1]).trim();
}

export function parseSubjectsXml(xml: string): CISAPISubject[] {
  const subjects: CISAPISubject[] = [];
  const subjectRegex = /<subject\s+id="([^"]+)"\s+href="([^"]+)"[^>]*>([^<]*)<\/subject>/g;

  let match;
  while ((match = subjectRegex.exec(xml)) !== null) {
    subjects.push({
      id: match[1],
      href: match[2],
      label: decodeXmlText(match[3]) || undefined
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
      label: decodeXmlText(match[3]),
      subject: subjectId
    });
  }

  return courses;
}

export function parseCourseDetailXml(xml: string): CISAPICourseDetail | null {
  // Extract basic course info
  // Handle optional namespaces (e.g. ns2:course) and attributes in any order
  const idMatch = xml.match(/<(?:[\w]+:)?course[^>]*\s+id="([^"]+)"/);
  const subjectMatch = xml.match(/<(?:[\w]+:)?subject[^>]*\s+id="([^"]+)"/);

  if (!idMatch || !subjectMatch) return null;

  // Parse genEd categories
  const genEdCategories: CISAPIGenEd[] = [];
  const genEdRegex = /<(?:[\w]+:)?genEdCategory[^>]*\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w]+:)?genEdCategory>/g;
  let genEdMatch;
  while ((genEdMatch = genEdRegex.exec(xml)) !== null) {
    const id = genEdMatch[1];
    const content = genEdMatch[2];
    const descMatch = content.match(/<(?:[\w]+:)?description>([^<]*)<\/(?:[\w]+:)?description>/);
    genEdCategories.push({
      id: id,
      description: decodeXmlText(descMatch?.[1]),
      attributes: parseGenEdAttributesXml(content)
    });
  }

  // Parse sections
  const sections = parseSectionsXml(xml);

  return {
    id: idMatch[1],
    subjectId: subjectMatch[1],
    label: tagText(xml, 'label'),
    description: tagText(xml, 'description'),
    creditHours: tagText(xml, 'creditHours'),
    courseSectionInformation: tagText(xml, 'courseSectionInformation'),
    classScheduleInformation: tagText(xml, 'classScheduleInformation'),
    sectionDegreeAttributes: tagText(xml, 'sectionDegreeAttributes'),
    sectionDateRange: tagText(xml, 'sectionDateRange'),
    sectionRegistrationNotes: tagText(xml, 'sectionRegistrationNotes'),
    sectionApprovalCode: tagText(xml, 'sectionApprovalCode'),
    genEdCategories,
    sections
  };
}

function parseGenEdAttributesXml(genEdCategoryXml: string): CISAPIGenEd['attributes'] {
  const attributes: CISAPIGenEd['attributes'] = [];
  const attributeRegex = /<(?:[\w]+:)?(?:genEdAttribute|genEdAttr|attribute)\b([^>]*)>([\s\S]*?)<\/(?:[\w]+:)?(?:genEdAttribute|genEdAttr|attribute)>/g;
  let attributeMatch;

  while ((attributeMatch = attributeRegex.exec(genEdCategoryXml)) !== null) {
    const openTagAttributes = attributeMatch[1];
    const content = attributeMatch[2];
    const code = xmlAttribute(openTagAttributes, 'code') || xmlAttribute(openTagAttributes, 'id');
    const description = tagText(content, 'description') || textWithoutTags(content);

    if (code || description) {
      attributes.push({ code, description });
    }
  }

  return attributes;
}

function parseSectionsXml(xml: string): CISAPISection[] {
  const sections: CISAPISection[] = [];

  // Match each section block
  // Updated to handle both <section> and <detailedSection> tags, and optional namespaces
  const sectionBlockRegex = /<(?:[\w]+:)?(?:detailedSection|section)[^>]*\s+id="([^"]+)"[^>]*>[\s\S]*?<\/(?:[\w]+:)?(?:detailedSection|section)>/g;
  let sectionMatch;

  while ((sectionMatch = sectionBlockRegex.exec(xml)) !== null) {
    const block = sectionMatch[0];
    const crn = sectionMatch[1];

    const meetings = parseMeetingsXml(block);

    sections.push({
      crn,
      sectionNumber: tagText(block, 'sectionNumber'),
      sectionTitle: tagText(block, 'sectionTitle'),
      statusCode: tagText(block, 'statusCode'),
      sectionStatusCode: tagText(block, 'sectionStatusCode'),
      enrollmentStatus: tagText(block, 'enrollmentStatus') || 'Unknown',
      sectionText: tagText(block, 'sectionText'),
      sectionNotes: tagText(block, 'sectionNotes'),
      sectionCappArea: tagText(block, 'sectionCappArea'),
      sectionDateRange: tagText(block, 'sectionDateRange'),
      startDate: tagText(block, 'startDate'),
      endDate: tagText(block, 'endDate'),
      partOfTerm: tagText(block, 'partOfTerm'),
      creditHours: tagText(block, 'creditHours'),
      meetings
    });
  }

  return sections;
}

function parseMeetingsXml(sectionXml: string): CISAPIMeeting[] {
  const meetings: CISAPIMeeting[] = [];

  // Handle meetings with attributes (e.g. id="0")
  const meetingBlockRegex = /<(?:[\w]+:)?meeting[^>]*>[\s\S]*?<\/(?:[\w]+:)?meeting>/g;
  let meetingMatch;

  while ((meetingMatch = meetingBlockRegex.exec(sectionXml)) !== null) {
    const block = meetingMatch[0];

    const typeMatch = block.match(/<(?:[\w]+:)?type([^>]*)>([\s\S]*?)<\/(?:[\w]+:)?type>/);
    const typeCodeMatch = typeMatch?.[1].match(/\bcode="([^"]*)"/);

    const instructors = parseInstructorsXml(block);

    meetings.push({
      type: decodeXmlText(typeMatch?.[2]),
      typeCode: decodeXmlText(typeCodeMatch?.[1]),
      start: convertTo24Hour(tagText(block, 'start')),
      end: convertTo24Hour(tagText(block, 'end')),
      daysOfTheWeek: tagText(block, 'daysOfTheWeek'),
      roomNumber: tagText(block, 'roomNumber'),
      buildingName: tagText(block, 'buildingName'),
      meetingDateRange: tagText(block, 'meetingDateRange'),
      instructors
    });
  }

  return meetings;
}

function parseInstructorsXml(meetingXml: string): CISAPIInstructor[] {
  const instructors: CISAPIInstructor[] = [];

  // Regex to match <instructor> tags, ensuring we don't match <instructors>
  // Matches <instructor> or <instructor ...>
  const instructorBlockRegex = /<(?:[\w]+:)?instructor(?:\s+[^>]*|)>[\s\S]*?<\/(?:[\w]+:)?instructor>/g;
  let instructorMatch;

  while ((instructorMatch = instructorBlockRegex.exec(meetingXml)) !== null) {
    const block = instructorMatch[0];
    const openTag = block.match(/<(?:[\w]+:)?instructor([^>]*)>/)?.[1] || '';

    // Try attributes first (newer API format)
    const firstNameAttr = openTag.match(/firstName="([^"]*)"/);
    const lastNameAttr = openTag.match(/lastName="([^"]*)"/);

    if (lastNameAttr) {
      instructors.push({
        firstName: decodeXmlText(firstNameAttr?.[1]),
        lastName: decodeXmlText(lastNameAttr[1])
      });
      continue;
    }

    // Fallback to child tags (older API format)
    const firstNameMatch = block.match(/<(?:[\w]+:)?firstName>([^<]*)<\/(?:[\w]+:)?firstName>/);
    const lastNameMatch = block.match(/<(?:[\w]+:)?lastName>([^<]*)<\/(?:[\w]+:)?lastName>/);

    if (lastNameMatch) {
      instructors.push({
        firstName: decodeXmlText(firstNameMatch?.[1]),
        lastName: decodeXmlText(lastNameMatch[1])
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
export interface ParsedSubjectMetadata {
  id: string;
  label: string;
  collegeCode: string;
  departmentCode: string;
  unitName: string;
  contactName: string;
  contactTitle: string;
  addressLine1: string;
  addressLine2: string;
  phoneNumber: string;
  websiteUrl: string;
  description: string;
}

export interface ParsedSubjectCascade {
  subjectId: string;
  subjectLabel: string;
  subjectMetadata: ParsedSubjectMetadata;
  courses: ParsedCascadeCourse[];
}

export interface ParsedGenEdCategory {
  id: string;
  name: string;
  attributes: { code: string; name: string }[];
}

export interface ParsedMeeting {
  index: number;
  typeCode: string;
  typeName: string;
  startTime: string;
  endTime: string;
  days: string;
  buildingName: string;
  roomNumber: string;
  dateRangeText: string;
  instructors: { firstName: string; lastName: string }[];
}

export interface ParsedCascadeSection {
  crn: string;
  sectionNumber: string;
  sectionTitle: string;
  enrollmentStatus: string;
  statusCode: string;
  sectionStatusCode: string;
  sectionText: string;
  sectionNotes: string;
  cappArea: string;
  dateRangeText: string;
  partOfTerm: string;
  startDate: string;
  endDate: string;
  creditHours: string;
  meetings: ParsedMeeting[];
}

export interface ParsedCascadeCourse {
  id: string;
  subject: string;
  title: string;
  description: string;
  creditHours: string;
  courseInfo: string;
  degreeAttributes: string;
  classScheduleInfo: string;
  dateRangeText: string;
  registrationNotes: string;
  approvalCode: string;
  genEdCategories: ParsedGenEdCategory[];
  sections: ParsedCascadeSection[];
}

export async function parseSubjectCascadeXml(stream: ReadableStream<Uint8Array> | null): Promise<ParsedSubjectCascade> {
  if (!stream) throw new Error('No response body stream');

  const result: ParsedSubjectCascade = {
    subjectId: '',
    subjectLabel: '',
    subjectMetadata: {
      id: '', label: '', collegeCode: '', departmentCode: '', unitName: '',
      contactName: '', contactTitle: '', addressLine1: '', addressLine2: '',
      phoneNumber: '', websiteUrl: '', description: ''
    },
    courses: []
  };

  let currentCourse: ParsedCascadeCourse | null = null;
  let currentSection: ParsedCascadeSection | null = null;
  let currentMeeting: ParsedMeeting | null = null;
  let currentInstructor: { firstName: string; lastName: string } | null = null;
  let currentGenEd: ParsedGenEdCategory | null = null;
  let currentText = '';

  let inMeeting = false;
  let inSubject = false;

  const parser = new Parser({
    onopentag(name, attrs) {
      currentText = '';

      if (name === 'ns2:subject') {
        result.subjectId = attrs.id || '';
        result.subjectMetadata.id = attrs.id || '';
        inSubject = true;
      }
      if (name === 'cascadingCourse') {
        const courseId = (attrs.id || '').split(' ').pop() ?? attrs.id;
        currentCourse = {
          id: courseId,
          subject: result.subjectId,
          title: '',
          description: '',
          creditHours: '',
          courseInfo: '',
          degreeAttributes: '',
          classScheduleInfo: '',
          dateRangeText: '',
          registrationNotes: '',
          approvalCode: '',
          genEdCategories: [],
          sections: []
        };
        result.courses.push(currentCourse);
      }
      if (name === 'detailedSection' && currentCourse) {
        currentSection = {
          crn: attrs.id || '',
          sectionNumber: '',
          sectionTitle: '',
          enrollmentStatus: '',
          statusCode: '',
          sectionStatusCode: '',
          sectionText: '',
          sectionNotes: '',
          cappArea: '',
          dateRangeText: '',
          partOfTerm: '',
          startDate: '',
          endDate: '',
          creditHours: '',
          meetings: []
        };
        currentCourse.sections.push(currentSection);
      }
      if (name === 'meeting' && currentSection) {
        inMeeting = true;
        currentMeeting = {
          index: currentSection.meetings.length,
          typeCode: '',
          typeName: '',
          startTime: '',
          endTime: '',
          days: '',
          buildingName: '',
          roomNumber: '',
          dateRangeText: '',
          instructors: []
        };
        currentSection.meetings.push(currentMeeting);
      }
      if (name === 'type' && currentMeeting) {
          currentMeeting.typeCode = attrs.code || '';
      }
      if (name === 'instructor' && currentMeeting) {
        currentInstructor = {
          firstName: attrs.firstName || '',
          lastName: attrs.lastName || ''
        };
      }
      if ((name === 'genEdCategory' || name === 'category') && currentCourse && attrs.id) {
        currentGenEd = {
          id: attrs.id,
          name: '',
          attributes: []
        };
        currentCourse.genEdCategories.push(currentGenEd);
      }
      if ((name === 'attribute' || name === 'genEdAttribute' || name === 'ns2:genEdAttr') && currentGenEd && (attrs.code || attrs.id)) {
        currentGenEd.attributes.push({
            code: attrs.code || attrs.id || '',
            name: ''
        });
      }
    },
    ontext(text) {
      currentText += text;
    },
    onclosetag(name) {
      const text = currentText.trim();

      // Subject Metadata
      if (inSubject && !currentCourse) {
        if (name === 'label') result.subjectLabel = text;
        if (name === 'collegeCode') result.subjectMetadata.collegeCode = text;
        if (name === 'departmentCode') result.subjectMetadata.departmentCode = text;
        if (name === 'unitName') result.subjectMetadata.unitName = text;
        if (name === 'contactName') result.subjectMetadata.contactName = text;
        if (name === 'contactTitle') result.subjectMetadata.contactTitle = text;
        if (name === 'addressLine1') result.subjectMetadata.addressLine1 = text;
        if (name === 'addressLine2') result.subjectMetadata.addressLine2 = text;
        if (name === 'phoneNumber') result.subjectMetadata.phoneNumber = text;
        if (name === 'webSiteURL') result.subjectMetadata.websiteUrl = text;
        if (name === 'collegeDepartmentDescription') result.subjectMetadata.description = text;
      }

      // Course-level fields
      if (currentCourse && !currentSection && !currentGenEd) {
        if (name === 'label') currentCourse.title = text;
        if (name === 'description') currentCourse.description = text;
        if (name === 'creditHours') currentCourse.creditHours = text;
        if (name === 'courseSectionInformation') currentCourse.courseInfo = text;
        if (name === 'sectionDegreeAttributes') currentCourse.degreeAttributes = text;
        if (name === 'classScheduleInformation') currentCourse.classScheduleInfo = text;
        if (name === 'sectionDateRange') currentCourse.dateRangeText = text;
        if (name === 'sectionRegistrationNotes') currentCourse.registrationNotes = text;
        if (name === 'sectionApprovalCode') currentCourse.approvalCode = text;
      }

      // GenEd Category fields
      if (currentGenEd) {
          if (name === 'description') currentGenEd.name = text;
          if (name === 'attribute' || name === 'genEdAttribute' || name === 'ns2:genEdAttr') {
              const lastAttr = currentGenEd.attributes[currentGenEd.attributes.length - 1];
              if (lastAttr) {
                  if (!lastAttr.name) lastAttr.name = text;
              }
          }
      }

      // Section-level fields
      if (currentSection && !inMeeting) {
        if (name === 'sectionNumber') currentSection.sectionNumber = text;
        if (name === 'sectionTitle') currentSection.sectionTitle = text;
        if (name === 'enrollmentStatus') currentSection.enrollmentStatus = text;
        if (name === 'statusCode') currentSection.statusCode = text;
        if (name === 'sectionStatusCode') currentSection.sectionStatusCode = text;
        if (name === 'sectionText') currentSection.sectionText = text;
        if (name === 'sectionNotes') currentSection.sectionNotes = text;
        if (name === 'sectionCappArea') currentSection.cappArea = text;
        if (name === 'sectionDateRange') currentSection.dateRangeText = text;
        if (name === 'partOfTerm') currentSection.partOfTerm = text;
        if (name === 'startDate') currentSection.startDate = text;
        if (name === 'endDate') currentSection.endDate = text;
        if (name === 'creditHours') currentSection.creditHours = text;
      }

      // Meeting-level fields
      if (currentMeeting && inMeeting) {
        if (name === 'type') currentMeeting.typeName = text;
        if (name === 'start') currentMeeting.startTime = convertTo24Hour(text);
        if (name === 'end') currentMeeting.endTime = convertTo24Hour(text);
        if (name === 'daysOfTheWeek') currentMeeting.days = text;
        if (name === 'buildingName') currentMeeting.buildingName = text;
        if (name === 'roomNumber') currentMeeting.roomNumber = text;
        if (name === 'meetingDateRange') currentMeeting.dateRangeText = text;
      }

      // Instructor fields
      if (currentInstructor) {
        if (name === 'firstName' && !currentInstructor.firstName) currentInstructor.firstName = text;
        if (name === 'lastName' && !currentInstructor.lastName) currentInstructor.lastName = text;
        if (name === 'instructor' && currentMeeting) {
          if (!currentInstructor.firstName && !currentInstructor.lastName) {
              // Try parsing the text content if attributes were empty
              const parts = text.split(',').map(p => p.trim());
              if (parts.length >= 2) {
                  currentInstructor.lastName = parts[0];
                  currentInstructor.firstName = parts[1];
              } else {
                  currentInstructor.lastName = text;
              }
          }
          if (currentInstructor.lastName) {
            currentMeeting.instructors.push(currentInstructor);
          }
          currentInstructor = null;
        }
      }

      if (name === 'meeting') {
          inMeeting = false;
          currentMeeting = null;
      }
      if (name === 'detailedSection') currentSection = null;
      if (name === 'cascadingCourse') currentCourse = null;
      if (name === 'genEdCategory' || name === 'category') currentGenEd = null;
      if (name === 'ns2:subject') inSubject = false;

      currentText = '';
    }
  }, { xmlMode: true });

  const reader = stream.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.write(decoder.decode(value, { stream: true }));
    }
    // Flush any remaining bytes
    parser.write(decoder.decode(new Uint8Array(), { stream: false }));
  } finally {
    reader.releaseLock();
  }

  parser.end();

  if (!result.subjectId) {
    throw new Error('Invalid XML: missing subject id');
  }

  if (!result.subjectMetadata.label) {
      result.subjectMetadata.label = result.subjectLabel;
  }
  if (!result.subjectMetadata.id) {
      result.subjectMetadata.id = result.subjectId;
  }

  return result;
}

export function stringToXmlStream(xml: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(xml));
      controller.close();
    }
  });
}

export function parseSubjectCascadeXmlFromString(xml: string): Promise<ParsedSubjectCascade> {
  return parseSubjectCascadeXml(stringToXmlStream(xml));
}
