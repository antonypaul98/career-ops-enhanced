// OpenCode run's JSON output omits session.status retry events. Observe those
// locally so an exhausted allowance cannot silently retry for minutes. This
// plugin has no tools, filesystem reads, network access or approval capability.
export default async function quotaObserver() {
  let failed = false;
  return { event: async ({ event }) => {
    if (failed || event?.type !== 'session.status') return;
    const status = event.properties?.status;
    if (status?.type !== 'retry' || status.action?.reason !== 'free_tier_limit') return;
    failed = true;
    process.stdout.write(JSON.stringify({ type: 'error', error: { name: 'FreeUsageLimitError', data: { message: 'Free usage limit reached' } } }) + '\n');
  } };
}
