import type { CISAPICourse, CISAPISubject } from './types.js';
import {
  descendantElements,
  elementAttr,
  elementText,
  parseXmlDocument,
} from './xml-utils.js';

export function parseSubjectsXml(xml: string): CISAPISubject[] {
  const document = parseXmlDocument(xml);
  return descendantElements(document, 'subject')
    .map((subject) => ({
      id: elementAttr(subject, 'id'),
      href: elementAttr(subject, 'href'),
      label: elementText(subject) || undefined,
    }))
    .filter((subject) => subject.id);
}

export function parseCoursesXml(xml: string, subjectId: string): CISAPICourse[] {
  const document = parseXmlDocument(xml);
  return descendantElements(document, 'course')
    .map((course) => ({
      id: elementAttr(course, 'id'),
      href: elementAttr(course, 'href'),
      label: elementText(course),
      subject: subjectId,
    }))
    .filter((course) => course.id);
}
