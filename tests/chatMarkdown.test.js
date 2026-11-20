import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBlocks, parseInline } from '../src/lib/chatMarkdown.js';

test('bold, italic and code become marked spans', () => {
  assert.deepEqual(parseInline('Try **two lists**, *slowly*, `now`.'), [
    { t: 'text', v: 'Try ' }, { t: 'b', v: 'two lists' }, { t: 'text', v: ', ' },
    { t: 'i', v: 'slowly' }, { t: 'text', v: ', ' }, { t: 'code', v: 'now' }, { t: 'text', v: '.' },
  ]);
});

test('a lone asterisk or multiplication stays text', () => {
  assert.deepEqual(parseInline('2 * 3 = 6'), [{ t: 'text', v: '2 * 3 = 6' }]);
});

test('paragraphs, bullets, numbers and headings', () => {
  const blocks = parseBlocks('## Idea\nFirst line\nsecond line\n\n- one\n- two\n\n1. a\n2. b\nEnd');
  assert.deepEqual(blocks.map(b => b.t), ['h', 'p', 'ul', 'ol', 'p']);
  assert.deepEqual(blocks[1].lines, ['First line', 'second line']);
  assert.deepEqual(blocks[2].items, ['one', 'two']);
});

test('empty input gives no blocks', () => {
  assert.deepEqual(parseBlocks(''), []);
  assert.deepEqual(parseBlocks(undefined), []);
});
