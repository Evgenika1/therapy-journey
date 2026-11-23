import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectMyData, EXPORT_TABLES, exportFileName } from '../src/lib/dataExport.js';

function fakeSupabase({ failTable } = {}) {
  const asked = [];
  return {
    asked,
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'a@b.c', created_at: 't' } } }) },
    from: (table) => ({ select: () => ({ eq: async (col, val) => {
      asked.push([table, col, val]);
      return table === failTable ? { data: null, error: { message: 'boom' } } : { data: [{ table }], error: null };
    } }) }),
    storage: { from: () => ({ list: async () => ({ data: [{ name: 'x.webm', metadata: { size: 10 }, created_at: 'c' }], error: null }) }) },
  };
}

test('every table is read, only for the signed-in user', async () => {
  const sb = fakeSupabase();
  const out = await collectMyData(sb);
  assert.deepEqual(Object.keys(out.tables), EXPORT_TABLES);
  assert.ok(sb.asked.every(([, col, val]) => col === 'user_id' && val === 'u1'));
  assert.deepEqual(out.audio_files, [{ name: 'x.webm', size_bytes: 10, created_at: 'c' }]);
  assert.equal(out.errors, undefined);
});

test('a table that fails is reported, the rest still exported', async () => {
  const out = await collectMyData(fakeSupabase({ failTable: 'homework' }));
  assert.equal(out.errors.homework, 'boom');
  assert.equal(out.tables.sessions.length, 1);
});

test('file name carries the date', () => {
  assert.equal(exportFileName(new Date('2026-11-23T10:00:00Z')), 'kevi-my-data-2026-11-23.json');
});
