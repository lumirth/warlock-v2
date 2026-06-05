import type {
  CISAPICourseDetail,
  CISAPIGenEd,
  CISAPIInstructor,
  CISAPIMeeting,
  CISAPISection,
} from './types.js';
import {
  convertTo24Hour,
  decodeXmlText,
  tagText,
  textWithoutTags,
  xmlAttribute,
} from './xml-utils.js';

export function parseCourseDetailXml(xml: string): CISAPICourseDetail | null {
  const idMatch = xml.match(/<(?:[\w]+:)?course[^>]*\s+id="([^"]+)"/);
  const subjectMatch = xml.match(/<(?:[\w]+:)?subject[^>]*\s+id="([^"]+)"/);

  if (!idMatch || !subjectMatch) return null;

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
    genEdCategories: parseGenEdCategoriesXml(xml),
    sections: parseSectionsXml(xml),
  };
}

function parseGenEdCategoriesXml(xml: string): CISAPIGenEd[] {
  const genEdCategories: CISAPIGenEd[] = [];
  const genEdRegex = /<(?:[\w]+:)?genEdCategory[^>]*\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w]+:)?genEdCategory>/g;
  let genEdMatch;

  while ((genEdMatch = genEdRegex.exec(xml)) !== null) {
    const id = genEdMatch[1];
    const content = genEdMatch[2];
    const descMatch = content.match(/<(?:[\w]+:)?description>([^<]*)<\/(?:[\w]+:)?description>/);
    genEdCategories.push({
      id,
      description: decodeXmlText(descMatch?.[1]),
      attributes: parseGenEdAttributesXml(content),
    });
  }

  return genEdCategories;
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
  const sectionBlockRegex = /<(?:[\w]+:)?(?:detailedSection|section)[^>]*\s+id="([^"]+)"[^>]*>[\s\S]*?<\/(?:[\w]+:)?(?:detailedSection|section)>/g;
  let sectionMatch;

  while ((sectionMatch = sectionBlockRegex.exec(xml)) !== null) {
    const block = sectionMatch[0];
    const crn = sectionMatch[1];

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
      meetings: parseMeetingsXml(block),
    });
  }

  return sections;
}

function parseMeetingsXml(sectionXml: string): CISAPIMeeting[] {
  const meetings: CISAPIMeeting[] = [];
  const meetingBlockRegex = /<(?:[\w]+:)?meeting[^>]*>[\s\S]*?<\/(?:[\w]+:)?meeting>/g;
  let meetingMatch;

  while ((meetingMatch = meetingBlockRegex.exec(sectionXml)) !== null) {
    const block = meetingMatch[0];
    const typeMatch = block.match(/<(?:[\w]+:)?type([^>]*)>([\s\S]*?)<\/(?:[\w]+:)?type>/);
    const typeCodeMatch = typeMatch?.[1].match(/\bcode="([^"]*)"/);

    meetings.push({
      type: decodeXmlText(typeMatch?.[2]),
      typeCode: decodeXmlText(typeCodeMatch?.[1]),
      start: convertTo24Hour(tagText(block, 'start')),
      end: convertTo24Hour(tagText(block, 'end')),
      daysOfTheWeek: tagText(block, 'daysOfTheWeek'),
      roomNumber: tagText(block, 'roomNumber'),
      buildingName: tagText(block, 'buildingName'),
      meetingDateRange: tagText(block, 'meetingDateRange'),
      instructors: parseInstructorsXml(block),
    });
  }

  return meetings;
}

function parseInstructorsXml(meetingXml: string): CISAPIInstructor[] {
  const instructors: CISAPIInstructor[] = [];
  const instructorBlockRegex = /<(?:[\w]+:)?instructor(?:\s+[^>]*|)>[\s\S]*?<\/(?:[\w]+:)?instructor>/g;
  let instructorMatch;

  while ((instructorMatch = instructorBlockRegex.exec(meetingXml)) !== null) {
    const block = instructorMatch[0];
    const openTag = block.match(/<(?:[\w]+:)?instructor([^>]*)>/)?.[1] || '';
    const firstNameAttr = openTag.match(/firstName="([^"]*)"/);
    const lastNameAttr = openTag.match(/lastName="([^"]*)"/);

    if (lastNameAttr) {
      instructors.push({
        firstName: decodeXmlText(firstNameAttr?.[1]),
        lastName: decodeXmlText(lastNameAttr[1]),
      });
      continue;
    }

    const firstNameMatch = block.match(/<(?:[\w]+:)?firstName>([^<]*)<\/(?:[\w]+:)?firstName>/);
    const lastNameMatch = block.match(/<(?:[\w]+:)?lastName>([^<]*)<\/(?:[\w]+:)?lastName>/);

    if (lastNameMatch) {
      instructors.push({
        firstName: decodeXmlText(firstNameMatch?.[1]),
        lastName: decodeXmlText(lastNameMatch[1]),
      });
    }
  }

  return instructors;
}
