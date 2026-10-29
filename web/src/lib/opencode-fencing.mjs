export const OPENCODE_READONLY_AGENT = "career-ops-readonly";

/**
 * Bind read-only OpenCode workers to the verified per-run agent. This module
 * deliberately imports no Node built-ins because cli-fencing.mjs is shared with
 * client-rendered capability/status code.
 */
export function fenceOpenCodeArgs(args, capabilities) {
  if (capabilities.writes) {
    throw new Error("OpenCode is authorized only for backend-persisted read-only workers.");
  }
  const run = args.indexOf("run");
  if (run === -1 || run === args.length - 1) {
    throw new Error(`cli-fencing: opencode argv must contain "run" followed by a prompt, got ${JSON.stringify(args)}.`);
  }
  if (args.slice(0, -1).some((arg) => arg === "--agent" || arg.startsWith("--agent="))) {
    throw new Error("cli-fencing: opencode argv already selects an agent; permission belongs to the adapter.");
  }
  return [...args.slice(0, run + 1), "--agent", OPENCODE_READONLY_AGENT, ...args.slice(run + 1)];
}
