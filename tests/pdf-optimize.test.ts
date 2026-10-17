import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, PDFName, PDFDict, PDFString } from 'pdf-lib';
import { repackPdf } from '../src/pdf-optimize-core';
test('repacking reduces object overhead without changing pages, text streams or metadata', async () => {
  const doc = await PDFDocument.create();
  doc.setTitle('Учебный документ');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 5; i++) {
    const page = doc.addPage();
    page.drawText('Original educational text ' + i, { font });
  }
  const original = await doc.save({ useObjectStreams: false });
  const output = await repackPdf(original);
  assert.ok(output.length < original.length);
  const check = await PDFDocument.load(output);
  assert.equal(check.getPageCount(), 5);
  assert.equal(check.getTitle(), 'Учебный документ');
});
test('interactive forms, signatures, accessibility structures and excessive page counts remain unchanged', async () => {
  for (const kind of ['form', 'signature', 'tagged', 'large']) {
    const doc = await PDFDocument.create();
    doc.addPage();
    if (kind === 'form') doc.getForm().createTextField('answer');
    if (kind === 'signature') {
      const dict = PDFDict.withContext(doc.context);
      dict.set(PDFName.of('Type'), PDFName.of('Sig'));
      dict.set(PDFName.of('Contents'), PDFString.of('signature'));
      doc.context.register(dict);
    }
    if (kind === 'tagged') doc.catalog.set(PDFName.of('StructTreeRoot'), doc.context.obj({}));
    if (kind === 'large') for (let i = 0; i < 40; i++) doc.addPage();
    const bytes = await doc.save();
    await assert.rejects(() => repackPdf(bytes), /interactive|limit/);
  }
});
test('invalid input is rejected rather than replacing the original', async () => {
  await assert.rejects(() => repackPdf(new TextEncoder().encode('not a PDF')));
});
