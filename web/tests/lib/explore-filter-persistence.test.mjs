import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'next/dist/build/swc/index.js';
import * as chips from '../../src/lib/clean-chips.mjs';
import { saveExploreFilters, restoreExploreFilters } from '../../src/lib/explore-filter-storage.mjs';

function compile(relative, modules) {
  const source = fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
  const { code } = transformSync(source, { filename: relative, module: { type: 'commonjs' }, jsc: { parser: { syntax: 'typescript', tsx: relative.endsWith('.tsx') }, target: 'es2022', transform: { react: { runtime: 'automatic' } } } });
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => {
    if (!(name in modules)) throw Error(`Unexpected import ${name}`);
    return modules[name];
  }, URLSearchParams, Set, console });
  return exports;
}
const codec = compile('../../src/lib/explore.ts', { './clean-chips.mjs': chips });
const seed = () => codec.parseExplorePatch({ positive: ['seed role'], allow: ['Boston'], requireSponsorship: true, noClearance: true });
function memory(initial) {
  let value = initial ?? null;
  return { getItem: () => value, setItem: (_key, next) => { value = next; } };
}
function provider(storage) {
  let first = true;
  let filters;
  const react = {
    createContext: () => ({ Provider: 'provider' }), useContext: () => null,
    useCallback: fn => fn, useEffect: () => {}, useMemo: fn => fn(), useRef: current => ({ current }),
    useState: initial => {
      const isFilters = first; first = false;
      if (isFilters) filters = initial;
      return [initial, next => { if (isFilters) filters = next; }];
    },
  };
  const mod = compile('../../src/components/explore/explore-provider.tsx', {
    react, 'react/jsx-runtime': { jsx: (_type, props) => props },
    'next/navigation': { useRouter: () => ({}) }, '@/lib/explore': codec,
    '@/lib/explore-ai': {}, '@/lib/whats-new.mjs': {}, '@/lib/explore-error.mjs': {},
    '@/lib/explore-filter-storage.mjs': {
      saveExploreFilters: f => saveExploreFilters(f, storage),
      restoreExploreFilters: (f, normalize) => restoreExploreFilters(f, normalize, storage),
    },
  });
  const ctx = mod.ExploreProvider({ children: null }).value;
  return { ...ctx, getFilters: () => filters };
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
