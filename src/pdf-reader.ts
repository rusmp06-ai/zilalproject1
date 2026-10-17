import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&inline';
export type { PDFDocumentProxy } from 'pdfjs-dist';
export function loadPdf(data: Uint8Array) {
  if (!GlobalWorkerOptions.workerPort) GlobalWorkerOptions.workerPort = new PdfWorker();
  return getDocument({ data, useSystemFonts: true });
}
