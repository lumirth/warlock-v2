// Auto-generated from CISAPI Explorer Spring 2026
// Excludes common words that are also subject codes (IS, UP, ME, IT, ON, OR, AS, IF, IN, BY, AN, AT, DO, GO, HE, HI, ID, MY, NO, OF, OH, OK, SO, TO, US, WE)
// These "unsafe" codes are only matched if uppercase or part of a clear course code (e.g. "IS 500")

export const VALID_SUBJECTS = new Set([
  "AAS", "ABE", "ACCY", "ACE", "ACES", "ADV", "AE", "AFAS", "AFRO", "AFST",
  "AGCM", "AGED", "AHS", "AIS", "ALEC", "ANSC", "ANTH", "ARAB", "ARCH", "ART",
  "ARTD", "ARTE", "ARTF", "ARTH", "ARTJ", "ARTS", "ASRM", "ASST", "ASTR", "ATMS",
  "BADM", "BASQ", "BCOG", "BCS", "BDI", "BIOC", "BIOE", "BIOP", "BSE", "BTW",
  "BUS", "CAS", "CB", "CDB", "CEE", "CGGE", "CHBE", "CHEM", "CHIN", "CHP",
  "CI", "CIC", "CLCV", "CLE", "CMN", "CPSC", "CS", "CSE", "CW", "CWL",
  "DANC", "DTX", "EALC", "ECE", "ECON", "EDPR", "EDUC", "EIL", "ENG", "ENGL",
  "ENSU", "ENT", "ENVS", "EPOL", "EPSY", "ERAM", "ESE", "ESL", "ETMA", "EURO",
  "EXP", "FAA", "FIN", "FLTE", "FR", "FSHN", "GC", "GEOL", "GER", "GGIS",
  "GLBL", "GMC", "GRK", "GRKM", "GSD", "GWS", "HBSE", "HDFS", "HEBR", "HIST",
  "HK", "HNDI", "HORT", "HT", "HUM", "IB", "IE", "INFO", "IS", "ITAL",
  "JAPN", "JOUR", "JS", "KOR", "LA", "LAS", "LAST", "LAT", "LAW", "LCTL",
  "LEAD", "LER", "LING", "LLS", "MACS", "MATH", "MBA", "MCB", "MDIA", "MDVL",
  "ME", "MICR", "MILS", "MIP", "MSE", "MUS", "MUSC", "MUSE", "NE", "NEUR",
  "NPRE", "NRES", "NS", "NUTR", "PATH", "PERS", "PHIL", "PHYS", "PLPA", "POL",
  "PORT", "PS", "PSM", "PSYC", "QUEC", "REES", "REL", "RHET", "RMLG", "RST",
  "RUSS", "SAME", "SBC", "SCAN", "SE", "SHS", "SLAV", "SLCL", "SOC", "SOCW",
  "SPAN", "SPED", "STAT", "SWAH", "TAM", "TE", "THEA", "TMGT", "TRST", "TURK",
  "UKR", "UP", "VCM", "VM", "WLOF", "WRIT", "YDSH"
]);

// Subjects that are also common English words - unsafe for lowercase matching
export const UNSAFE_LOWERCASE_SUBJECTS = new Set([
  "IS",  // "is"
  "UP",  // "up"
  "ME",  // "me"
  "IT",  // "it"
  "ON",  // "on"
  "OR",  // "or"
  "AS",  // "as"
  "IF",  // "if"
  "IN",  // "in"
  "BY",  // "by"
  "AN",  // "an"
  "AT",  // "at"
  "DO",  // "do"
  "GO",  // "go"
  "HE",  // "he"
  "HI",  // "hi"
  "ID",  // "id"
  "MY",  // "my"
  "NO",  // "no"
  "OF",  // "of"
  "OH",  // "oh"
  "OK",  // "ok"
  "SO",  // "so"
  "TO",  // "to"
  "US",  // "us"
  "WE",  // "we"
  "AM",  // "am"
  "BE",  // "be"
  "LAW", // "law" - actually maybe safe? "law" implies the subject usually. Keeping safe for now.
  "ART", // "art" - safe? "art history" vs "art". strict: "art" is a word.
  "BUS", // "bus" - vehicle
  "ENG", // "eng" - ???
  "HIS", // "his" - pronoun (though HIST is the code usually, checking list... HIST is valid, HIS is not in list)
  "HUM", // "hum" - noise
  "SAME", // "same" - adjective
  "SE",   // "se" - standard error?
  "ONE",  // "one"
  "TWO",  // "two"
  "SIX",  // "six"
  "TEN",  // "ten"
  "THE",  // "the" - not in list but "THEA" is
  "A",    // "a" - article
  "I",    // "i" - pronoun
]);

// Subjects that MUST be allowed in lowercase because they are extremely common search terms
// and unlikely to be used as normal words in a course search context (or the ambiguity is acceptable)
export const SAFE_LOWERCASE_SUBJECTS = new Set([
  "cs", "math", "ece", "stat", "phys", "bio", "chem", "econ", "adv", "psyc",
  "phil", "hist", "engl", "astr", "anth", "soc", "pol", "geol", "ling", "mus",
  "fin", "badm", "nres", "chbe", "jour", "arch", "dance", "thea"
]);
