/**
 * Tracks live browser requests so dismissing a running worker is a real cancel,
 * not a UI-only removal. Kept as plain .mjs so the behavior is unit-testable
 * without React or a browser.
 */
export function createJobAbortRegistry() {
  /** @type {Map<string, AbortController>} */
  const controllers = new Map();

  return Object.freeze({
    /**
     * Register before any async CLI resolution so an immediate cancel cannot race
     * ahead of fetch() and accidentally allow the worker to start later.
     * @param {string} id
     * @param {AbortController} controller
     */
    register(id, controller) {
      const prior = controllers.get(id);
      if (prior && prior !== controller) prior.abort();
      controllers.set(id, controller);
    },

    /**
     * Abort exactly the request belonging to this job. Removing it from the map
     * makes repeated clicks idempotent and cannot affect a later job.
     * @param {string} id
     * @returns {boolean}
     */
    cancel(id) {
      const controller = controllers.get(id);
      if (!controller) return false;
      controllers.delete(id);
      controller.abort();
      return true;
    },

    /**
     * Forget only the controller that completed. A stale completion must not
     * remove a replacement controller registered under the same id.
     * @param {string} id
     * @param {AbortController} controller
     */
    forget(id, controller) {
      if (controllers.get(id) === controller) controllers.delete(id);
    },

    /** @param {string} id */
    has(id) {
      return controllers.has(id);
    },
  });
}
