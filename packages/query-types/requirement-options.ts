export type GenEdRequirementOptionKind = "category" | "subcategory";

export type GenEdRequirementOptionDto = {
  code: string;
  label: string;
  kind: GenEdRequirementOptionKind;
  parentCode?: string;
  parentLabel?: string;
  aliases: readonly string[];
};

export type GenEdRequirementSuboptionDto = Omit<
  GenEdRequirementOptionDto,
  "kind" | "parentCode" | "parentLabel"
>;

export type GenEdRequirementGroupDto = {
  code: string;
  label: string;
  options: GenEdRequirementSuboptionDto[];
};

export const GENED_REQUIREMENT_GROUPS = [
  {
    code: "COMP1",
    label: "Composition I",
    options: [],
  },
  {
    code: "ACP",
    label: "Advanced Composition",
    options: [],
  },
  {
    code: "CS",
    label: "Cultural Studies",
    options: [
      {
        code: "US",
        label: "US Minority Cultures",
        aliases: ["us minority", "minority cultures", "us minority cultures"],
      },
      {
        code: "NW",
        label: "Non-Western Cultures",
        aliases: ["non-western", "non western", "nonwestern"],
      },
      {
        code: "WCC",
        label: "Western/Comparative Cultures",
        aliases: ["western", "comparative", "western comparative"],
      },
    ],
  },
  {
    code: "HUM",
    label: "Humanities & the Arts",
    options: [
      {
        code: "HP",
        label: "Historical & Philosophical Perspectives",
        aliases: ["historical", "philosophical", "history", "philosophy"],
      },
      {
        code: "LA",
        label: "Literature & the Arts",
        aliases: ["literature", "lit", "literature and the arts"],
      },
    ],
  },
  {
    code: "NAT",
    label: "Natural Sciences & Technology",
    options: [
      {
        code: "LS",
        label: "Life Sciences",
        aliases: ["life sciences", "life sci", "bio", "biology"],
      },
      {
        code: "PS",
        label: "Physical Sciences",
        aliases: ["physical sciences", "physical"],
      },
    ],
  },
  {
    code: "QR",
    label: "Quantitative Reasoning",
    options: [
      {
        code: "QR1",
        label: "Quantitative Reasoning I",
        aliases: ["qr1", "qr 1", "quant 1", "quantitative reasoning 1", "qri"],
      },
      {
        code: "QR2",
        label: "Quantitative Reasoning II",
        aliases: ["qr2", "qr 2", "quant 2", "quantitative reasoning 2", "qrii"],
      },
    ],
  },
  {
    code: "SBS",
    label: "Social & Behavioral Sciences",
    options: [
      {
        code: "SS",
        label: "Social Sciences",
        aliases: ["social science", "social sciences", "soc sci"],
      },
    ],
  },
] as const satisfies readonly GenEdRequirementGroupDto[];

export const GENED_REQUIREMENT_CATEGORY_CODES = GENED_REQUIREMENT_GROUPS
  .map((group) => group.code);

export const GENED_REQUIREMENT_OPTIONS: GenEdRequirementOptionDto[] =
  GENED_REQUIREMENT_GROUPS.flatMap((group) => [
    {
      code: group.code,
      label: group.label,
      kind: "category" as const,
      aliases: categoryAliases(group.code),
    },
    ...group.options.map((option) => ({
      ...option,
      kind: "subcategory" as const,
      parentCode: group.code,
      parentLabel: group.label,
    })),
  ]);

export const GENED_REQUIREMENT_LABELS: Record<string, string> =
  Object.fromEntries(
    GENED_REQUIREMENT_OPTIONS.map((option) => [option.code, option.label]),
  );

export const GENERIC_GENED_REQUIREMENT_CODES = [
  ...GENED_REQUIREMENT_CATEGORY_CODES,
];

const REQUIREMENT_CODE_ALIASES: Record<string, string> = {
  BSC: "SBS",
  CMP: "COMP1",
};

const GENED_REQUIREMENT_CODE_SET = new Set(
  GENED_REQUIREMENT_OPTIONS.map((option) => option.code),
);

export function canonicalRequirementCode(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return null;

  const withoutSourcePrefix = /^1[A-Z0-9]+$/.test(normalized)
    ? normalized.slice(1)
    : normalized;
  return REQUIREMENT_CODE_ALIASES[withoutSourcePrefix] ?? withoutSourcePrefix;
}

export function canonicalRequirementCodes(values: readonly string[] | undefined): string[] {
  const codes = new Set<string>();
  for (const value of values ?? []) {
    const normalized = canonicalRequirementCode(value);
    if (normalized) codes.add(normalized);
  }
  return [...codes];
}

export function isKnownRequirementCode(value: string | null | undefined): boolean {
  const code = canonicalRequirementCode(value);
  return Boolean(code && GENED_REQUIREMENT_CODE_SET.has(code));
}

export function isGenericAnyGenEdRequirementFilter(
  values: readonly string[] | undefined,
): boolean {
  if (!values?.length) return false;

  const normalized = new Set(canonicalRequirementCodes(values));
  return GENERIC_GENED_REQUIREMENT_CODES.every((code) => normalized.has(code));
}

function categoryAliases(code: string): string[] {
  if (code === "COMP1") {
    return ["comp 1", "composition", "writing", "rhet 105", "freshman comp", "comp1"];
  }
  if (code === "ACP") {
    return ["adv comp", "advanced composition", "advanced comp", "writing intensive"];
  }
  if (code === "CS") return ["cultural studies", "cultural"];
  if (code === "HUM") return ["humanities", "humanities and the arts", "arts"];
  if (code === "NAT") return ["nat sci", "natural sciences", "science"];
  if (code === "QR") return ["quantitative", "quant", "quantitative reasoning"];
  if (code === "SBS") {
    return ["social science", "behavioral science", "social and behavioral"];
  }
  return [];
}
