export interface CISAPISubject {
  id: string;           // "CS"
  href: string;         // Full URL to subject endpoint
  label?: string;       // "Computer Science" (from some endpoints)
}

export interface CourseExplorerSection {
  crn: string;
  sectionNumber: string;
  sectionTitle: string;
  statusCode: string;
  sectionStatusCode: string;
  enrollmentStatus: string;
  sectionText: string;
  sectionNotes: string;
  sectionCappArea: string;
  sectionDateRange: string;
  partOfTerm: string;
  startDate: string;
  endDate: string;
  creditHours: string;
  meetings: CourseExplorerMeeting[];
}

export interface CourseExplorerMeeting {
  type: string;
  typeCode: string;
  start: string;        // "09:00 AM"
  end: string;          // "09:50 AM"
  daysOfTheWeek: string;
  roomNumber: string;
  buildingName: string;
  meetingDateRange: string;
  instructors: CourseExplorerInstructor[];
}

export interface CourseExplorerInstructor {
  firstName: string;
  lastName: string;
}

export interface CourseExplorerCourse {
  id: string;
  subjectId: string;
  label: string;
  description: string;
  creditHours: string;
  courseSectionInformation: string;
  classScheduleInformation: string;
  sectionDegreeAttributes: string;
  sectionDateRange: string;
  sectionRegistrationNotes: string;
  sectionApprovalCode: string;
  genEdCategories: CourseExplorerRequirementCategory[];
  sections: CourseExplorerSection[];
}

export interface CourseExplorerRequirementCategory {
  id: string;
  description: string;
  attributes: CourseExplorerRequirementAttribute[];
}

interface CourseExplorerRequirementAttribute {
  code: string;
  description: string;
}
