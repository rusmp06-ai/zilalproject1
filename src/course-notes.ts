export type CourseNote = {
  courseId: string;
  courseTitle: string;
  topicId: string | null;
  text: string;
};
export function decodeCourseNote(body: string): CourseNote | null {
  try {
    const n = JSON.parse(body);
    if (
      n.studyhub_course_note !== 1 ||
      typeof n.courseId !== 'string' ||
      !n.courseId ||
      typeof n.courseTitle !== 'string' ||
      typeof n.text !== 'string' ||
      !(n.topicId === null || typeof n.topicId === 'string')
    )
      return null;
    return { courseId: n.courseId, courseTitle: n.courseTitle, topicId: n.topicId, text: n.text };
  } catch {
    return null;
  }
}
export function encodeCourseNote(n: CourseNote) {
  return JSON.stringify({ studyhub_course_note: 1, ...n });
}
