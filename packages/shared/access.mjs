/** Pure specification model, not a substitute for database authorization. */
export function canAccess({
  owner = false,
  userBlocked = false,
  groupBlocked = false,
  member = false,
  denied = false,
}) {
  if (userBlocked) return false;
  if (owner) return true;
  return member && !groupBlocked && !denied;
}
export function canManageLibrary({
  owner = false,
  leader = false,
  authorId,
  userId,
  accessible = false,
}) {
  return accessible && (owner || (leader && authorId === userId));
}
export function canManageCourse({
  owner = false,
  leaderGroupIds = [],
  teacherCourseIds = [],
  course,
  accessible = false,
}) {
  return (
    accessible &&
    (owner || leaderGroupIds.includes(course.groupId) || teacherCourseIds.includes(course.id))
  );
}
export function canGrade({ owner = false, teacherCourseIds = [], courseId, accessible = false }) {
  return accessible && (owner || teacherCourseIds.includes(courseId));
}
