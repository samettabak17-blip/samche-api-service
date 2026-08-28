import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterProviderMemoryByAuthority,
  stampProviderMemoryEntry,
} from '../services/channel-knowledge-authority-memory.js';

const assistantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('mapped channel memory keeps only entries from the exact current shared authority epoch', () => {
  const oldAuthority = { assistantId, version: 4n };
  const currentAuthority = { assistantId, version: 5n };
  const memory = [
    { role: 'user', content: 'legacy unproven marker' },
    stampProviderMemoryEntry({ role: 'assistant', content: 'ORBIT-4927' }, oldAuthority),
    stampProviderMemoryEntry({ role: 'user', content: 'current question' }, currentAuthority),
    stampProviderMemoryEntry({ role: 'assistant', content: 'current answer' }, currentAuthority),
  ];

  assert.deepEqual(
    filterProviderMemoryByAuthority(memory, currentAuthority).map((entry) => entry.content),
    ['current question', 'current answer'],
  );
});

test('reassignment does not revive process memory from an earlier equal knowledge state', () => {
  const assignedEpoch = { assistantId, version: 2n };
  const reassignedEpoch = { assistantId, version: 4n };
  const memory = [stampProviderMemoryEntry({ role: 'assistant', content: 'SAPPHIRE-7319' }, assignedEpoch)];
  assert.deepEqual(filterProviderMemoryByAuthority(memory, reassignedEpoch), []);
});

test('different Assistant memory is excluded', () => {
  const memory = [stampProviderMemoryEntry(
    { role: 'assistant', content: 'other assistant marker' },
    { assistantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', version: 5n },
  )];
  assert.deepEqual(filterProviderMemoryByAuthority(memory, { assistantId, version: 5n }), []);
});

test('unmapped legacy channel sessions retain their existing memory behavior', () => {
  const legacy = [{ role: 'user', content: 'legacy' }, { role: 'assistant', content: 'reply' }];
  assert.deepEqual(filterProviderMemoryByAuthority(legacy, null), legacy);
});
