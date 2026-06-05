import { Parser } from 'htmlparser2';
import { convertTo24Hour } from './xml-utils.js';

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
