import test from 'node:test';
import assert from 'node:assert/strict';
import observer from '../../src/lib/opencode-quota-observer.mjs';
import { parseOpenCodeEvent } from '../../src/lib/run-cli-support.mjs';

test('hidden free quota retries become a single sanitized terminal JSONL error',async()=>{
  const hook=await observer(); const lines=[]; const original=process.stdout.write;
  process.stdout.write=(s)=>{lines.push(s);return true;};
  try {
    await hook.event({event:{type:'session.status',properties:{status:{type:'retry',message:'transient overload'}}}});
    assert.equal(lines.length,0);
    const event={type:'session.status',properties:{status:{type:'retry',action:{reason:'free_tier_limit'},message:'PRIVATE',next:999999}}};
    await hook.event({event}); await hook.event({event});
    assert.equal(lines.length,1); assert(parseOpenCodeEvent(lines[0]).error); assert(!lines[0].includes('PRIVATE'));
  } finally {process.stdout.write=original;}
});
