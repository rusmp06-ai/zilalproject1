import { repackPdf } from './pdf-optimize-core';
self.onmessage = async (e: MessageEvent<Uint8Array>) => {
  try {
    const bytes = await repackPdf(e.data);
    (
      self as unknown as { postMessage: (message: unknown, transfer: Transferable[]) => void }
    ).postMessage({ bytes }, [bytes.buffer as ArrayBuffer]);
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : 'invalid' });
  }
};
