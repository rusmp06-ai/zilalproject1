export function courseTheme(id: string) {
  return ['ocean', 'slate', 'copper'][
    [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 3
  ];
}

export function CourseScenery() {
  return (
    <span className="discipline-scenery" aria-hidden="true">
      <svg viewBox="0 0 320 120" preserveAspectRatio="none">
        <path
          d="M0 120V82L52 38l34 30 50-56 62 62 42-30 80 58v36z"
          fill="currentColor"
          opacity=".16"
        />
        <path d="M0 120V98l62-36 46 40 54-46 72 56 86-30v38z" fill="currentColor" opacity=".14" />
      </svg>
      <span className="discipline-sun" />
    </span>
  );
}
