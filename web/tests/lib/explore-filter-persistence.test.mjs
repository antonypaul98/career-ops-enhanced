import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import * as codec from '../../src/lib/explore.ts';
import { saveExploreFilters, restoreExploreFilters } from '../../src/lib/explore-filter-storage.mjs';

const seed = () => codec.parseExplorePatch({ positive: ['seed role'], allow: ['Boston'], requireSponsorship: true, noClearance: true });
function memory(initial) {
  let value = initial ?? null;
  return { getItem: () => value, setItem: (_key, next) => { value = next; } };
}
function provider(storage) {
  // Execute the actual client callbacks with a fresh state/ref for each mount.
  // Node's built-in type stripper keeps this runnable in core CI, where the
  // separate web package (including Next/SWC) has not been installed.
  const source = fs.readFileSync(new URL('../../src/components/explore/explore-provider.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  const setFilters = useCallback(');
  const end = source.indexOf('  const discover = useCallback(', start);
  assert.ok(start >= 0 && end > start);
  let filters;
  const code = stripTypeScriptTypes(source.slice(start, end));
  const callbacks = vm.runInNewContext(code + '\n({setFilters, initFilters})', {
    touched: { current: false }, filtersRef: { current: null },
    useCallback: fn => fn, setFiltersState: next => { filters = next; },
    parseExplorePatch: codec.parseExplorePatch,
    saveExploreFilters: f => saveExploreFilters(f, storage),
    restoreExploreFilters: (f, normalize) => restoreExploreFilters(f, normalize, storage),
  });
  return { ...callbacks, getFilters: () => filters };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('actual Explore provider restores edited role, location and safety filters after remount', () => {
  const storage = memory(); const first = provider(storage);
  first.initFilters(seed());
  const edited = codec.parseExplorePatch({ positive: ['Data Engineer'], allow: ['New York'], sinceDays: 30, ats: ['greenhouse'], employmentTypes: ['full_time'] }, seed());
  first.setFilters(edited);
  const reloaded = provider(storage); reloaded.initFilters(seed());
  assert.deepEqual(plain(reloaded.getFilters()), plain(edited));
  assert.equal(reloaded.getFilters().requireSponsorship, true);
  assert.equal(reloaded.getFilters().noClearance, true);
});
test('intentionally cleared lists remain empty instead of reverting to portal seeds', () => {
  const storage = memory(); const first = provider(storage);
  first.setFilters(codec.parseExplorePatch({ positive: [], allow: [], employmentTypes: [] }, seed()));
  const next = provider(storage); next.initFilters(seed());
  assert.deepEqual(plain(next.getFilters().positive), []);
  assert.deepEqual(plain(next.getFilters().allow), []);
  assert.deepEqual(plain(next.getFilters().employmentTypes), []);
});
test('explicit shared searches bypass saved preferences without overwriting them', () => {
  const storage = memory(); saveExploreFilters(seed(), storage); const before = storage.getItem();
  const next = provider(storage); const explicit = codec.parseExplorePatch({ positive: ['Platform Engineer'] });
  next.initFilters(explicit, false);
  assert.deepEqual(plain(next.getFilters()), plain(explicit));
  assert.equal(storage.getItem(), before);
});
test('late initialization cannot replace an active user or assistant edit', () => {
  const storage = memory(); const next = provider(storage);
  const edited = codec.parseExplorePatch({ positive: ['User edit'] });
  next.setFilters(edited); next.initFilters(seed());
  assert.deepEqual(plain(next.getFilters()), plain(edited));
});
test('malformed and unsupported saved formats fall back without writing over storage', () => {
  for (const raw of ['{', 'null', '{"v":2,"filters":{}}', '{"v":1,"filters":[]}']) {
    const storage = memory(raw); const next = provider(storage); next.initFilters(seed());
    assert.deepEqual(plain(next.getFilters()), plain(seed())); assert.equal(storage.getItem(), raw);
  }
});
test('saved preferences use the existing filter codec and cannot add unrelated state', () => {
  const storage = memory(JSON.stringify({ v:1, filters: { positive:[' Python ','Python'], sinceDays:999, limitPerAts:-1, ats:['bogus'], employmentTypes:['paid','full_time'], candidate:'invented', submit:true } }));
  const next = provider(storage); next.initFilters(seed()); const f = next.getFilters();
  assert.deepEqual(plain(f.positive), ['Python']); assert.equal(f.sinceDays,60); assert.equal(f.limitPerAts,50);
  assert.deepEqual(plain(f.employmentTypes),['full_time']); assert.equal('candidate' in f,false); assert.equal('submit' in f,false);
});
test('unavailable browser storage does not prevent searching or editing preferences', () => {
  const storage = { getItem() { throw Error('denied'); }, setItem() { throw Error('full'); } };
  const next = provider(storage); next.initFilters(seed()); next.setFilters(seed());
  assert.deepEqual(plain(next.getFilters()), plain(seed()));
});
