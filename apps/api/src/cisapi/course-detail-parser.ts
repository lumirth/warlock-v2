import type {
  CourseExplorerCourse,
  CourseExplorerInstructor,
  CourseExplorerMeeting,
  CourseExplorerRequirementCategory,
  CourseExplorerSection,
} from './types.js';
import {
  convertTo24Hour,
  descendantElements,
  elementAttr,
  elementText,
  firstDescendantElement,
  firstDescendantText,
  localName,
  parseXmlDocument,
  type XmlElement,
} from './xml-utils.js';

export function parseCourseDetailXml(xml: string): CourseExplorerCourse | null {
  const document = parseXmlDocument(xml);
  const course = firstDescendantElement(document, 'course');
  const subject = firstDescendantElement(course, 'subject');

  if (!course || !subject) return null;

  return {
    id: elementAttr(course, 'id'),
    subjectId: elementAttr(subject, 'id'),
    label: firstDescendantText(course, 'label'),
    description: firstDescendantText(course, 'description'),
    creditHours: firstDescendantText(course, 'creditHours'),
    courseSectionInformation: firstDescendantText(course, 'courseSectionInformation'),
    classScheduleInformation: firstDescendantText(course, 'classScheduleInformation'),
    sectionDegreeAttributes: firstDescendantText(course, 'sectionDegreeAttributes'),
    sectionDateRange: firstDescendantText(course, 'sectionDateRange'),
    sectionRegistrationNotes: firstDescendantText(course, 'sectionRegistrationNotes'),
    sectionApprovalCode: firstDescendantText(course, 'sectionApprovalCode'),
    genEdCategories: parseGenEdCategories(course),
    sections: parseSections(course),
  };
}

function parseGenEdCategories(course: XmlElement): CourseExplorerRequirementCategory[] {
  return descendantElements(course, 'genEdCategory')
    .map((category) => {
      const id = elementAttr(category, 'id');
      return {
        id,
        description: firstDescendantText(category, 'description'),
        attributes: parseGenEdAttributes(category),
      };
    })
    .filter((category) => category.id || category.description || category.attributes.length);
}

function parseGenEdAttributes(category: XmlElement): CourseExplorerRequirementCategory['attributes'] {
  const attributeNames = new Set(['genEdAttribute', 'genEdAttr', 'attribute']);
  return descendantElements(category)
    .filter((element) => attributeNames.has(localName(element)))
    .map((attribute) => ({
      code: elementAttr(attribute, 'code') || elementAttr(attribute, 'id'),
      description: firstDescendantText(attribute, 'description') || elementText(attribute),
    }))
    .filter((attribute) => attribute.code || attribute.description);
}

function parseSections(course: XmlElement): CourseExplorerSection[] {
  const seenCrns = new Set<string>();
  return descendantElements(course)
    .filter((element) => {
      const name = localName(element);
      return (name === 'detailedSection' || name === 'section') && elementAttr(element, 'id');
    })
    .flatMap((section) => {
      const crn = elementAttr(section, 'id');
      if (seenCrns.has(crn)) return [];
      seenCrns.add(crn);
      return [{
        crn,
        sectionNumber: firstDescendantText(section, 'sectionNumber'),
        sectionTitle: firstDescendantText(section, 'sectionTitle'),
        statusCode: firstDescendantText(section, 'statusCode'),
        sectionStatusCode: firstDescendantText(section, 'sectionStatusCode'),
        enrollmentStatus: firstDescendantText(section, 'enrollmentStatus') || 'Unknown',
        sectionText: firstDescendantText(section, 'sectionText'),
        sectionNotes: firstDescendantText(section, 'sectionNotes'),
        sectionCappArea: firstDescendantText(section, 'sectionCappArea'),
        sectionDateRange: firstDescendantText(section, 'sectionDateRange'),
        startDate: firstDescendantText(section, 'startDate'),
        endDate: firstDescendantText(section, 'endDate'),
        partOfTerm: firstDescendantText(section, 'partOfTerm'),
        creditHours: firstDescendantText(section, 'creditHours'),
        meetings: parseMeetings(section),
      }];
    });
}

function parseMeetings(section: XmlElement): CourseExplorerMeeting[] {
  return descendantElements(section, 'meeting').map((meeting) => {
    const type = firstDescendantElement(meeting, 'type');
    return {
      type: elementText(type),
      typeCode: elementAttr(type, 'code'),
      start: convertTo24Hour(firstDescendantText(meeting, 'start')),
      end: convertTo24Hour(firstDescendantText(meeting, 'end')),
      daysOfTheWeek: firstDescendantText(meeting, 'daysOfTheWeek'),
      roomNumber: firstDescendantText(meeting, 'roomNumber'),
      buildingName: firstDescendantText(meeting, 'buildingName'),
      meetingDateRange: firstDescendantText(meeting, 'meetingDateRange'),
      instructors: parseInstructors(meeting),
    };
  });
}

function parseInstructors(meeting: XmlElement): CourseExplorerInstructor[] {
  return descendantElements(meeting, 'instructor')
    .map((instructor) => ({
      firstName: elementAttr(instructor, 'firstName') || firstDescendantText(instructor, 'firstName'),
      lastName: elementAttr(instructor, 'lastName') || firstDescendantText(instructor, 'lastName'),
    }))
    .filter((instructor) => instructor.lastName);
}
