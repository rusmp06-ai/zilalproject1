import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import PdfWorker from 'studyhub-pdf-worker';
export type { PDFDocumentProxy } from 'pdfjs-dist';
export function loadPdf(data: Uint8Array) {
  if (!GlobalWorkerOptions.workerPort) GlobalWorkerOptions.workerPort = new PdfWorker();
  return getDocument({ data, useSystemFonts: true });
}
