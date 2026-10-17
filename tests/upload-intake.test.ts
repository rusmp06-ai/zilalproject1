import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadIntake, type IntakeTransport } from '../src/upload-intake';
const file = new File(['Original bytes'], 'original.txt', { type: 'text/plain' });
const input = {
  request: 'one-request',
  kind: 'lecture' as const,
  course: 'course',
  group: 'group',
  title: 'Original title',
  description: 'Text',
  due: null,
  max: 100,
  late: false,
};
function fixture() {
  let reservations = 0,
    published = 0,
    uploads = 0,
    stored = false,
    result: string | null = null;
  const faults = { uploadBefore: false, uploadAfter: false, finishAfter: false };
  const transport: IntakeTransport = {
    prepare: async (i, f, mime, hash) => {
      assert.equal(i.request, input.request);
      assert.equal(f, file);
      assert.equal(mime, 'text/plain');
      assert.match(hash, /^[a-f0-9]{64}$/);
      if (!reservations) reservations++;
      return {
        item_id: 'source',
        path: 'user/source/content',
        bucket: 'studyhub-courses',
        published: !!result,
        result_id: result,
      };
    },
    upload: async (r, f) => {
      assert.equal(r.path, 'user/source/content');
      assert.equal(await f.text(), 'Original bytes');
      uploads++;
      if (faults.uploadBefore) throw Error('offline');
      if (stored) throw Error('already exists');
      stored = true;
      if (faults.uploadAfter) throw Error('response lost');
    },
    finish: async () => {
      if (!stored) throw Error('missing file');
      if (!result) {
        published++;
        result = 'result-id';
      }
      if (faults.finishAfter) {
        faults.finishAfter = false;
        throw Error('response lost');
      }
      return result;
    },
  };
  return { transport, faults, counts: () => ({ reservations, published, uploads }) };
}
test('broken upload retries the same reservation and original bytes', async () => {
  const f = fixture();
  f.faults.uploadBefore = true;
  await assert.rejects(() => uploadIntake(f.transport, input, file), /Публикация не завершена/);
  assert.deepEqual(f.counts(), { reservations: 1, published: 0, uploads: 1 });
  f.faults.uploadBefore = false;
  assert.equal(await uploadIntake(f.transport, input, file), 'result-id');
  assert.deepEqual(f.counts(), { reservations: 1, published: 1, uploads: 2 });
});
test('lost upload response finishes the stored original without a duplicate upload', async () => {
  const f = fixture();
  f.faults.uploadAfter = true;
  assert.equal(await uploadIntake(f.transport, input, file), 'result-id');
  assert.deepEqual(f.counts(), { reservations: 1, published: 1, uploads: 1 });
});
test('lost publication response is reconciled by prepare without another storage request', async () => {
  const f = fixture();
  f.faults.finishAfter = true;
  await assert.rejects(() => uploadIntake(f.transport, input, file), /публикация не подтверждена/);
  assert.equal(await uploadIntake(f.transport, input, file), 'result-id');
  assert.deepEqual(f.counts(), { reservations: 1, published: 1, uploads: 1 });
});
test('a rejected reservation does not declare an earlier uncertain request editable', async () => {
  const f = fixture();
  f.transport.prepare = async () => {
    throw Object.assign(Error('Access denied'), { code: 'P0001' });
  };
  await assert.rejects(
    () => uploadIntake(f.transport, input, file),
    (e) => {
      assert.equal((e as { canEdit?: boolean }).canEdit, false);
      return true;
    },
  );
  assert.deepEqual(f.counts(), { reservations: 0, published: 0, uploads: 0 });
});

test('a schema-cache miss also retains the identity of an earlier uncertain request', async () => {
  const f = fixture();
  f.transport.prepare = async () => {
    throw Object.assign(Error('schema cache'), { code: 'PGRST202' });
  };
  await assert.rejects(
    () => uploadIntake(f.transport, input, file),
    (e) => {
      assert.equal((e as { canEdit?: boolean }).canEdit, false);
      assert.match((e as Error).message, /SQL v0.30/);
      return true;
    },
  );
});
