import { parseSubjectsXml } from "../cisapi/parser.js";

type SubjectListDiagnostic =
  | {
      ok: true;
      url: string;
      status: number;
      subjectCount: number;
      subjects: string[];
      xmlLength: number;
      xmlSnippet: string;
      headers: Record<string, string>;
    }
  | {
      ok: false;
      url: string;
      status: number;
      statusText: string;
      headers: Record<string, string>;
    };

export async function inspectSubjectList(url: string): Promise<SubjectListDiagnostic> {
  const response = await fetch(url, {
    headers: { Accept: "application/xml" },
    redirect: "follow",
  });
  const headers = Object.fromEntries(response.headers.entries());

  if (!response.ok) {
    return {
      ok: false,
      url,
      status: response.status,
      statusText: response.statusText,
      headers,
    };
  }

  const xml = await response.text();
  const subjects = parseSubjectsXml(xml).map((subject) => subject.id);
  return {
    ok: true,
    url,
    status: response.status,
    subjectCount: subjects.length,
    subjects: subjects.slice(0, 10),
    xmlLength: xml.length,
    xmlSnippet: xml.substring(0, 500),
    headers,
  };
}
