import { GRADING } from '../config/constants'

export function getLetterGrade(score: number): string {
  if (score >= GRADING.THRESHOLDS.A_PLUS) return 'A+'
  if (score >= GRADING.THRESHOLDS.A) return 'A'
  if (score >= GRADING.THRESHOLDS.A_MINUS) return 'A-'
  if (score >= GRADING.THRESHOLDS.B_PLUS) return 'B+'
  if (score >= GRADING.THRESHOLDS.B) return 'B'
  if (score >= GRADING.THRESHOLDS.B_MINUS) return 'B-'
  if (score >= GRADING.THRESHOLDS.C_PLUS) return 'C+'
  if (score >= GRADING.THRESHOLDS.C) return 'C'
  if (score >= GRADING.THRESHOLDS.C_MINUS) return 'C-'
  if (score >= GRADING.THRESHOLDS.D_PLUS) return 'D+'
  if (score >= GRADING.THRESHOLDS.D) return 'D'
  if (score >= GRADING.THRESHOLDS.D_MINUS) return 'D-'
  return 'F'
}

export function getGradeColor(grade: string): string {
  if (grade === 'N/A') return 'gray'
  if (grade.startsWith('A')) return 'teal'
  if (grade.startsWith('B')) return 'blue'
  if (grade.startsWith('C')) return 'yellow'
  if (grade.startsWith('D')) return 'orange'
  return 'red'
}
