import { Parser } from 'htmlparser2';
import { convertTo24Hour } from './xml-utils.js';

type Instructor = { firstName: string; lastName: string };
type Meeting = {
  type: string; typeCode: string; start: string; end: string;
  daysOfTheWeek: string; roomNumber: string; buildingName: string;
  meetingDateRange: string; instructors: Instructor[];
};
type Section = {
  crn: string; sectionNumber: string; sectionTitle: string; statusCode: string;
  sectionStatusCode: string; enrollmentStatus: string; sectionText: string;
  sectionNotes: string; sectionCappArea: string; sectionDateRange: string;
  partOfTerm: string; startDate: string; endDate: string; creditHours: string;
  meetings: Meeting[];
};
type Requirement = {
  id: string; description: string;
  attributes: { code: string; description: string }[];
};
export type CourseExplorerCourse = {
  id: string; subjectId: string; label: string; description: string;
  creditHours: string; courseSectionInformation: string;
  classScheduleInformation: string; sectionDegreeAttributes: string;
  sectionDateRange: string; sectionRegistrationNotes: string;
  sectionApprovalCode: string; genEdCategories: Requirement[]; sections: Section[];
};
export type ParsedSubjectCascade = {
  subjectId: string; subjectLabel: string;
  courses: CourseExplorerCourse[];
};

const courseFields = new Set<keyof CourseExplorerCourse>([
  'label', 'description', 'creditHours', 'courseSectionInformation',
  'classScheduleInformation', 'sectionDegreeAttributes', 'sectionDateRange',
  'sectionRegistrationNotes', 'sectionApprovalCode',
]);
const sectionFields = new Set<keyof Section>([
  'sectionNumber', 'sectionTitle', 'statusCode', 'sectionStatusCode',
  'enrollmentStatus', 'sectionText', 'sectionNotes', 'sectionCappArea',
  'sectionDateRange', 'partOfTerm', 'startDate', 'endDate', 'creditHours',
]);

export async function parseSubjectCascadeXml(
  stream: ReadableStream<Uint8Array> | null,
): Promise<ParsedSubjectCascade> {
  if (!stream) throw new Error('No response body stream');
  const result = emptyCascade();
  let course: CourseExplorerCourse | undefined;
  let section: Section | undefined;
  let meeting: Meeting | undefined;
  let instructor: Instructor | undefined;
  let requirement: Requirement | undefined;
  let attribute: Requirement['attributes'][number] | undefined;
  let text = '';

  const open: Record<string, (attrs: Record<string, string>) => void> = {
    subject: attrs => {
      if (result.subjectId) return;
      result.subjectId = attrs.id ?? '';
    },
    cascadingCourse: attrs => {
      course = emptyCourse(attrs.id ?? '', result.subjectId);
      result.courses.push(course);
    },
    detailedSection: attrs => {
      if (course) course.sections.push(section = emptySection(attrs.id ?? ''));
    },
    meeting: () => {
      if (section) section.meetings.push(meeting = emptyMeeting());
    },
    instructor: attrs => {
      if (meeting) instructor = { firstName: attrs.firstName ?? '', lastName: attrs.lastName ?? '' };
    },
    genEdCategory: attrs => { addRequirement(attrs.id); },
    category: attrs => { addRequirement(attrs.id); },
    attribute: attrs => { addAttribute(attrs.code ?? attrs.id); },
    genEdAttribute: attrs => { addAttribute(attrs.code ?? attrs.id); },
    genEdAttr: attrs => { addAttribute(attrs.code ?? attrs.id); },
    type: attrs => { if (meeting) meeting.typeCode = attrs.code ?? ''; },
  };

  const capture = [
    (name: string, value: string) => write(attribute, attributeNames.has(name) && 'description', value),
    captureInstructor,
    (name: string, value: string) => {
      if (!meeting) return false;
      assignMeeting(meeting, name, value);
      return true;
    },
    (name: string, value: string) => write(section, sectionFields.has(name as keyof Section) && name, value),
    (name: string, value: string) => write(requirement, name === 'description' && name, value),
    (name: string, value: string) => write(course, courseFields.has(name as keyof CourseExplorerCourse) && name, value),
    (name: string, value: string) => write(course ? undefined : result, name === 'label' && 'subjectLabel', value),
  ];
  function addRequirement(id?: string): void {
    if (course && id) course.genEdCategories.push(requirement = { id, description: '', attributes: [] });
  }
  function addAttribute(code?: string): void {
    if (requirement && code) requirement.attributes.push(attribute = { code, description: '' });
  }
  function captureInstructor(name: string, value: string): boolean {
    if (!instructor || (name !== 'firstName' && name !== 'lastName')) return false;
    if (!instructor[name]) instructor[name] = value;
    return true;
  }
  const finishInstructor = () => {
    if (!instructor || !meeting) return;
    if (!instructor.firstName && !instructor.lastName) {
      const [lastName = '', firstName = ''] = text.trim().split(',').map(part => part.trim());
      instructor = { firstName, lastName };
    }
    if (instructor.lastName) meeting.instructors.push(instructor);
    instructor = undefined;
  };
  const close: Record<string, () => void> = {
    instructor: finishInstructor,
    meeting: () => { meeting = undefined; },
    detailedSection: () => { section = undefined; },
    cascadingCourse: () => { course = undefined; },
    genEdCategory: () => { requirement = undefined; },
    category: () => { requirement = undefined; },
    attribute: () => { attribute = undefined; },
    genEdAttribute: () => { attribute = undefined; },
    genEdAttr: () => { attribute = undefined; },
  };

  const parser = new Parser({
    onopentag(rawName, attrs) {
      text = '';
      open[localName(rawName)]?.(attrs);
    },
    ontext(value) { text += value; },
    onclosetag(rawName) {
      const name = localName(rawName);
      const value = text.trim();
      capture.some(handler => handler(name, value));
      close[name]?.();
      text = '';
    },
  }, { xmlMode: true });

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      parser.write(decoder.decode(chunk.value, { stream: true }));
    }
    parser.write(decoder.decode());
    parser.end();
  } finally {
    reader.releaseLock();
  }
  if (!result.subjectId) throw new Error('Invalid XML: missing subject id');
  return result;
}

function emptyCascade(): ParsedSubjectCascade {
  return { subjectId: '', subjectLabel: '', courses: [] };
}
function emptyCourse(id: string, subjectId: string): CourseExplorerCourse {
  return {
    id, subjectId, label: '', description: '', creditHours: '',
    courseSectionInformation: '', classScheduleInformation: '',
    sectionDegreeAttributes: '', sectionDateRange: '', sectionRegistrationNotes: '',
    sectionApprovalCode: '', genEdCategories: [], sections: [],
  };
}
function emptySection(crn: string): Section {
  return {
    crn, sectionNumber: '', sectionTitle: '', statusCode: '', sectionStatusCode: '',
    enrollmentStatus: '', sectionText: '', sectionNotes: '', sectionCappArea: '',
    sectionDateRange: '', partOfTerm: '', startDate: '', endDate: '', creditHours: '',
    meetings: [],
  };
}
function emptyMeeting(): Meeting {
  return {
    type: '', typeCode: '', start: '', end: '', daysOfTheWeek: '', roomNumber: '',
    buildingName: '', meetingDateRange: '', instructors: [],
  };
}
function assignMeeting(meeting: Meeting, name: string, value: string): void {
  if (name === 'type') meeting.type = value;
  else if (name === 'start' || name === 'end') meeting[name] = convertTo24Hour(value);
  else if (name === 'daysOfTheWeek' || name === 'buildingName'
    || name === 'roomNumber' || name === 'meetingDateRange') setString(meeting, name, value);
}
function setString<T extends object>(target: T, key: string, value: string): void {
  (target as Record<string, unknown>)[key] = value;
}
function write(target: object | undefined, key: string | false, value: string): boolean {
  if (!target || !key) return false;
  setString(target, key, value);
  return true;
}
function localName(name: string): string { return name.slice(name.lastIndexOf(':') + 1); }
const attributeNames = new Set(['attribute', 'genEdAttribute', 'genEdAttr']);
