export function decodeXmlText(value: string | undefined): string {
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

export function tagText(xml: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<(?:[\\w]+:)?${escaped}[^>]*>([\\s\\S]*?)<\\/(?:[\\w]+:)?${escaped}>`).exec(xml);
  return decodeXmlText(match?.[1]).trim();
}

export function textWithoutTags(xml: string): string {
  return decodeXmlText(xml.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function xmlAttribute(openTagAttributes: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\b${escaped}="([^"]*)"`).exec(openTagAttributes);
  return decodeXmlText(match?.[1]).trim();
}

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
