import {
  descendantElements,
  elementText,
  parseXmlDocument,
} from './xml-utils.js';

export function parseEnrollmentStatusesXml(xml: string): string[] {
  const document = parseXmlDocument(xml);
  return descendantElements(document, 'enrollmentStatus')
    .map(elementText)
    .filter(Boolean);
}
