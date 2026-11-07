import { spawn } from "node:child_process";

export function createProcessTreeStopper(child, options = {}) {
  const platform = options.platform ?? process.platform;
  const killFn = options.killFn ?? process.kill.bind(process);
  const spawnFn = options.spawnFn ?? spawn;
  const graceMs = options.graceMs ?? 2_000;
  let stopping = false;
  let escalation = null;

  function signalPosix(signal) {
    try {
      killFn(-child.pid, signal);
      return true;
    } catch {
      try {
        return child.kill(signal);
      } catch {
        return false;
      }
    }
  }

  function stop() {
    if (stopping) return false;
    stopping = true;
    if (!child.pid) {
      try { child.kill("SIGTERM"); } catch { /* already gone */ }
      return true;
    }
    if (platform === "win32") {
      try {
        const killer = spawnFn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
        killer.unref?.();
      } catch {
        try { child.kill("SIGTERM"); } catch { /* already gone */ }
      }
      return true;
    }
    signalPosix("SIGTERM");
    escalation = setTimeout(() => signalPosix("SIGKILL"), graceMs);
    escalation.unref?.();
    return true;
  }

  function settled() {
    // The leader may close while a grandchild ignores SIGTERM. Keep the
    // bounded group escalation alive until it has signalled those descendants.
    if (stopping) return;
    if (escalation) clearTimeout(escalation);
    escalation = null;
  }

  return { stop, settled, get stopping() { return stopping; } };
}
