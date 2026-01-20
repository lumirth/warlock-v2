export interface CISAPISubject {
  id: string;           // "CS"
  href: string;         // Full URL to subject endpoint
  label?: string;       // "Computer Science" (from some endpoints)
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
  statusCode: string;
  partOfTerm: string;
  sectionStatusCode: string;
  enrollmentStatus: string;
  startDate: string;
  endDate: string;
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
  genEdCategories: CISAPIGenEd[];
  sections: CISAPISection[];
}

export interface CISAPIGenEd {
  id: string;
  description: string;
}
