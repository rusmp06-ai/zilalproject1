import { CourseScenery, courseTheme } from './CourseScenery';
import { StudyIcon } from './StudyIcon';
import type { Course } from './types';
export function CourseCover({
  course,
  groupName,
  teacher,
  busy,
  onRefresh,
}: {
  course: Course;
  groupName: string;
  teacher: boolean;
  busy: boolean;
  onRefresh: () => void;
}) {
  const theme = courseTheme(course.id);
  return (
    <header className={'course-hero course-cover cover-' + theme}>
      <div className="course-cover-copy">
        <div className="eyebrow">
          {teacher ? 'ПРЕПОДАВАНИЕ' : 'ДИСЦИПЛИНА'}
          {groupName ? ' · ' + groupName : ''}
        </div>
        <h2>{course.title}</h2>
      </div>
      <CourseScenery />
      <button
        className="course-refresh"
        aria-label="Обновить дисциплину"
        title="Обновить дисциплину"
        disabled={busy}
        onClick={onRefresh}
      >
        <StudyIcon name="refresh" />
        <span>Обновить</span>
      </button>
    </header>
  );
}
