declare module 'studyhub-pdf-worker' {
  const WorkerConstructor: new (options?: WorkerOptions) => Worker;
  export default WorkerConstructor;
}
declare module 'studyhub-optimizer-worker' {
  const WorkerConstructor: new (options?: WorkerOptions) => Worker;
  export default WorkerConstructor;
}

declare const __STUDYHUB_VERSION__: string;
