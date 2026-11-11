// OpenCode run's JSON output omits session.status retry events. Observe those
// locally so an exhausted allowance cannot silently retry for minutes. This
// plugin has no tools, filesystem reads, network access or approval capability.
import { writeSync } from 'node:fs';
export default async function quotaObserver() {
  let failed = false;
  let requests = 0;
  const single = process.env.CAREER_OPS_SINGLE_REQUEST === '1';
  return { ...(single ? { 'chat.params': async input => {
    // Verified against 1.19.4: this awaited hook precedes each LLM request;
    // the provider SDK uses maxRetries:0. Includes retries and auxiliary calls.
    if (requests++ !== 0 || input.agent !== 'career-ops-readonly'
        || input.model?.providerID !== 'opencode' || input.model?.id !== 'glm-5.3-flash-free') {
      writeSync(1, JSON.stringify({type:'error',error:{data:{message:'Single free-model request boundary blocked another or unexpected model request'}}})+'\n');
      process.exit(78);
    }
  }} : {}), event: async ({ event }) => {
    if (failed || event?.type !== 'session.status') return;
    const status = event.properties?.status;
    if (status?.type !== 'retry') return;
    if (single) {
      // The provider SDK uses zero retries in OpenCode 1.19.4; its session retry
      // publishes this event before retrying. Exit in this process, not after a
      // best-effort parent notification, so the next request cannot start.
      const quota = status.action?.reason === 'free_tier_limit' || /quota|rate.?limit|usage.?limit|429/i.test(status.message ?? '');
      writeSync(1, JSON.stringify({type:'error',error:{data:{statusCode:quota?429:503,message:quota?'Free usage limit reached':'Provider retry blocked by single-request policy'}}})+'\n');
      process.exit(78);
    }
    if (status.action?.reason !== 'free_tier_limit') return;
    failed = true;
    process.stdout.write(JSON.stringify({ type: 'error', error: { name: 'FreeUsageLimitError', data: { message: 'Free usage limit reached' } } }) + '\n');
  } };
}
