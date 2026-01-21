export interface CISAPISubject {
  id: string;           // "CS"
  href: string;         // Full URL to subject endpoint
  label?: string;       // "Computer Science" (from some endpoints)
}

export interface CISAPISubjectDetail {
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

export interface CISAPICourse {
  id: string;           // "225"
  href: string;
  label: string;        // "Data Structures"
  subject: string;      // "CS" (added during parsing)
}

export interface CISAPISection {
  crn: string;
  sectionNumber: string;
  sectionTitle: string;           // NEW - for topics courses
  statusCode: string;
  sectionStatusCode: string;
  enrollmentStatus: string;
  sectionText: string;            // NEW
  sectionNotes: string;           // NEW
  sectionCappArea: string;        // NEW
  sectionDateRange: string;       // NEW
  partOfTerm: string;
  startDate: string;
  endDate: string;
  creditHours: string;            // NEW - section-level override
  meetings: CISAPIMeeting[];
}

export interface CISAPIMeeting {
  type: string;
  typeCode: string;
  start: string;        // "09:00 AM"
  end: string;          // "09:50 AM"
  daysOfTheWeek: string;
  roomNumber: string;
  buildingName: string;
  meetingDateRange: string;       // NEW
  instructors: CISAPIInstructor[];
}

export interface CISAPIInstructor {
  firstName: string;
  lastName: string;
}

export interface CISAPICourseDetail {
  id: string;
  subjectId: string;
  label: string;
  description: string;
  creditHours: string;
  courseSectionInformation: string;
  classScheduleInformation: string;
  sectionDegreeAttributes: string;      // NEW
  sectionDateRange: string;             // NEW
  sectionRegistrationNotes: string;     // NEW
  sectionApprovalCode: string;          // NEW
  genEdCategories: CISAPIGenEd[];
  sections: CISAPISection[];
}

export interface CISAPIGenEd {
  id: string;
  description: string;
  attributes: CISAPIGenEdAttribute[];   // NEW
}

export interface CISAPIGenEdAttribute {
  code: string;
  description: string;
}
