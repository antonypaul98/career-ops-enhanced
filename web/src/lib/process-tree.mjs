import { spawn } from "node:child_process";

export function createProcessTreeStopper(child, options = {}) {
  const platform = options.platform ?? process.platform;
  const killFn = options.killFn ?? process.kill.bind(process);
  const spawnFn = options.spawnFn ?? spawn;
  const graceMs = options.graceMs ?? 2_000;
  let stopping = false;
  let escalation = null;
  let killer = null;
  let completion = null;
  let waitTimeout = null;
  const waiters = [];

  function complete(error = null) {
    if (completion) return;
    completion = { error };
    if (waitTimeout) clearTimeout(waitTimeout);
    for (const { resolve, reject } of waiters.splice(0)) {
      if (error) reject(error); else resolve();
    }
  }

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
      complete(new Error("Process-tree cleanup cannot be confirmed without a process identifier."));
      return true;
    }
    if (platform === "win32") {
      try {
        killer = spawnFn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
        killer.once?.("error", () => complete(new Error("Windows process-tree cleanup failed to start.")));
        killer.once?.("close", code => complete(code === 0 ? null : new Error("Windows process-tree cleanup was not confirmed.")));
        killer.unref?.();
      } catch {
        try { child.kill("SIGTERM"); } catch { /* already gone */ }
        complete(new Error("Windows process-tree cleanup failed to start."));
      }
      return true;
    }
    signalPosix("SIGTERM");
    escalation = setTimeout(() => {
      // A short-lived acceptance CLI must know the whole group was signalled,
      // not merely that its leader exited. Preserve the legacy fallback, but
      // fail an awaiting caller when only that fallback could be confirmed.
      try {
        killFn(-child.pid, "SIGKILL");
        complete();
      } catch (error) {
        if (error?.code === "ESRCH") complete();
        else {
          try { child.kill("SIGKILL"); } catch { /* best effort only */ }
          complete(new Error("POSIX process-tree cleanup was not confirmed."));
        }
      }
    }, graceMs);
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

  /** Optional for short-lived controllers. Keeps bounded cleanup alive after
   * the leader closes; legacy long-lived dashboard callers keep stop()'s
   * synchronous boolean API and unreferenced escalation behavior. */
  function waitForStop() {
    if (!stopping) return Promise.resolve();
    if (completion) return completion.error ? Promise.reject(completion.error) : Promise.resolve();
    escalation?.ref?.();
    killer?.ref?.();
    if (platform === "win32" && !waitTimeout) {
      waitTimeout = setTimeout(() => {
        try { killer?.kill?.("SIGKILL"); } catch { /* cannot prove target cleanup */ }
        complete(new Error("Windows process-tree cleanup timed out; termination is unverified."));
      }, options.waitTimeoutMs ?? 5_000);
    }
    return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
  }

  return { stop, settled, waitForStop, get stopping() { return stopping; } };
}
