import { Parser } from 'htmlparser2';
import { convertTo24Hour } from './xml-utils.js';
import type {
  CourseExplorerCourse,
  CourseExplorerInstructor,
  CourseExplorerMeeting,
  CourseExplorerRequirementCategory,
  CourseExplorerSection,
} from './types.js';

// Subject cascade types and parser
interface ParsedSubjectMetadata {
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
  webSiteURL: string;
  collegeDepartmentDescription: string;
}

export interface ParsedSubjectCascade {
  subjectId: string;
  subjectLabel: string;
  subjectMetadata: ParsedSubjectMetadata;
  courses: CourseExplorerCourse[];
}

export async function parseSubjectCascadeXml(stream: ReadableStream<Uint8Array> | null): Promise<ParsedSubjectCascade> {
  if (!stream) throw new Error('No response body stream');

  const result: ParsedSubjectCascade = {
    subjectId: '',
    subjectLabel: '',
    subjectMetadata: {
      id: '', label: '', collegeCode: '', departmentCode: '', unitName: '',
      contactName: '', contactTitle: '', addressLine1: '', addressLine2: '',
      phoneNumber: '', webSiteURL: '', collegeDepartmentDescription: ''
    },
    courses: []
  };

  let currentCourse: CourseExplorerCourse | null = null;
  let currentSection: CourseExplorerSection | null = null;
  let currentMeeting: CourseExplorerMeeting | null = null;
  let currentInstructor: CourseExplorerInstructor | null = null;
  let currentGenEd: CourseExplorerRequirementCategory | null = null;
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
        currentCourse = {
          id: attrs.id || '',
          subjectId: result.subjectId,
          label: '',
          description: '',
          creditHours: '',
          courseSectionInformation: '',
          sectionDegreeAttributes: '',
          classScheduleInformation: '',
          sectionDateRange: '',
          sectionRegistrationNotes: '',
          sectionApprovalCode: '',
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
          sectionCappArea: '',
          sectionDateRange: '',
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
          typeCode: '',
          type: '',
          start: '',
          end: '',
          daysOfTheWeek: '',
          buildingName: '',
          roomNumber: '',
          meetingDateRange: '',
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
          description: '',
          attributes: []
        };
        currentCourse.genEdCategories.push(currentGenEd);
      }
      if ((name === 'attribute' || name === 'genEdAttribute' || name === 'ns2:genEdAttr') && currentGenEd && (attrs.code || attrs.id)) {
        currentGenEd.attributes.push({
            code: attrs.code || attrs.id || '',
            description: ''
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
        if (name === 'webSiteURL') result.subjectMetadata.webSiteURL = text;
        if (name === 'collegeDepartmentDescription') result.subjectMetadata.collegeDepartmentDescription = text;
      }

      // Course-level fields
      if (currentCourse && !currentSection && !currentGenEd) {
        if (name === 'label') currentCourse.label = text;
        if (name === 'description') currentCourse.description = text;
        if (name === 'creditHours') currentCourse.creditHours = text;
        if (name === 'courseSectionInformation') currentCourse.courseSectionInformation = text;
        if (name === 'sectionDegreeAttributes') currentCourse.sectionDegreeAttributes = text;
        if (name === 'classScheduleInformation') currentCourse.classScheduleInformation = text;
        if (name === 'sectionDateRange') currentCourse.sectionDateRange = text;
        if (name === 'sectionRegistrationNotes') currentCourse.sectionRegistrationNotes = text;
        if (name === 'sectionApprovalCode') currentCourse.sectionApprovalCode = text;
      }

      // GenEd Category fields
      if (currentGenEd) {
          if (name === 'description') currentGenEd.description = text;
          if (name === 'attribute' || name === 'genEdAttribute' || name === 'ns2:genEdAttr') {
              const lastAttr = currentGenEd.attributes[currentGenEd.attributes.length - 1];
              if (lastAttr) {
                  if (!lastAttr.description) lastAttr.description = text;
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
        if (name === 'sectionCappArea') currentSection.sectionCappArea = text;
        if (name === 'sectionDateRange') currentSection.sectionDateRange = text;
        if (name === 'partOfTerm') currentSection.partOfTerm = text;
        if (name === 'startDate') currentSection.startDate = text;
        if (name === 'endDate') currentSection.endDate = text;
        if (name === 'creditHours') currentSection.creditHours = text;
      }

      // Meeting-level fields
      if (currentMeeting && inMeeting) {
        if (name === 'type') currentMeeting.type = text;
        if (name === 'start') currentMeeting.start = convertTo24Hour(text);
        if (name === 'end') currentMeeting.end = convertTo24Hour(text);
        if (name === 'daysOfTheWeek') currentMeeting.daysOfTheWeek = text;
        if (name === 'buildingName') currentMeeting.buildingName = text;
        if (name === 'roomNumber') currentMeeting.roomNumber = text;
        if (name === 'meetingDateRange') currentMeeting.meetingDateRange = text;
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
