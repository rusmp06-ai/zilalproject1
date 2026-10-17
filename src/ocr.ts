import workerPath from 'tesseract.js/dist/worker.min.js?url';
import corePath from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

// Documents stay in the browser. Only language models are downloaded from the public CDN.
export async function recognizePage(
  pdf: PDFDocumentProxy,
  page: number,
  language: 'rus' | 'eng',
  signal: AbortSignal,
  progress: (value: number) => void,
): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  if (signal.aborted) throw new DOMException('Отменено', 'AbortError');
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined, render: RenderTask | undefined;
  const cancel = () => {
    render?.cancel();
    void worker?.terminate();
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const p = await pdf.getPage(page),
      base = p.getViewport({ scale: 1 });
    const view = p.getViewport({
      scale: Math.min(2.5, Math.sqrt(8000000 / (base.width * base.height))),
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(view.width);
    canvas.height = Math.ceil(view.height);
    render = p.render({ canvas, viewport: view });
    await render.promise;
    if (signal.aborted) throw new DOMException('Отменено', 'AbortError');
    worker = await createWorker(language, 1, {
      workerPath,
      corePath,
      logger: (m) => {
        if (m.status === 'recognizing text') progress(Math.round(m.progress * 100));
      },
      errorHandler: () => {},
    });
    if (signal.aborted) throw new DOMException('Отменено', 'AbortError');
    const result = await worker.recognize(canvas);
    return result.data.text.trim();
  } finally {
    signal.removeEventListener('abort', cancel);
    await worker?.terminate();
  }
}
