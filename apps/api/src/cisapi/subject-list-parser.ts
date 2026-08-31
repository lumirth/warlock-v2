import {
  descendantElements,
  elementAttr,
  elementText,
  parseXmlDocument,
} from './xml-utils.js';

export function parseSubjectsXml(xml: string): Array<{ id: string; href: string; label?: string }> {
  const document = parseXmlDocument(xml);
  return descendantElements(document, 'subject')
    .map((subject) => ({
      id: elementAttr(subject, 'id'),
      href: elementAttr(subject, 'href'),
      label: elementText(subject) || undefined,
    }))
    .filter((subject) => subject.id);
}
