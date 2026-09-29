/**
 * ChronoCanvas agent-worker — Temporal Worker bootstrap (Day 5).
 *
 * This script is the process entry point.  It:
 *   1. Creates a Temporal `NativeConnection` to the local Temporal server.
 *   2. Registers the workflow bundle (Temporal's bundler isolates the sandbox).
 *   3. Registers all activities from `./activities`.
 *   4. Starts the worker and blocks until the process is signalled.
 *
 * **WebSocket extension seam**: `BackendSocket` is imported here so that
 * process-level shutdown can close the connection cleanly.  Day 6 will call
 * `getBackendSocket().connect()` here (or lazily inside an activity) so the
 * worker is pre-connected before it starts polling Temporal.
 *
 * Environment variables (all optional, with defaults):
 *   - `TEMPORAL_ADDRESS`  — Temporal server address (default: `localhost:7233`)
 *   - `TEMPORAL_NAMESPACE`— Namespace to run under (default: `default`)
 *   - `TEMPORAL_TASK_QUEUE`— Task queue name (default: `chrono-agent`)
 *   - `CHRONO_BACKEND_URL` — WebSocket backend (default: `ws://localhost:3001`)
 */

import path from 'node:path';
import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities';
import { getBackendSocket } from './connection';

// ---- Config -----------------------------------------------------------------

const TEMPORAL_ADDRESS   = process.env.TEMPORAL_ADDRESS    ?? 'localhost:7233';
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE  ?? 'default';
const TASK_QUEUE         = process.env.TEMPORAL_TASK_QUEUE ?? 'chrono-agent';

// ---- Bootstrap --------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`[agent-worker] connecting to Temporal at ${TEMPORAL_ADDRESS} (namespace: ${TEMPORAL_NAMESPACE})`);
  console.log(`[agent-worker] task queue: ${TASK_QUEUE}`);

  const connection = await NativeConnection.connect({
    address: TEMPORAL_ADDRESS,
  });

  const worker = await Worker.create({
    connection,
    namespace: TEMPORAL_NAMESPACE,
    taskQueue: TASK_QUEUE,

    /**
     * Point Temporal's bundler at the workflow source file.
     *
     * The path MUST include the `.ts` extension when running under ts-node /
     * tsx, because without it Node's `require.resolve` returns `undefined` and
     * Temporal's webpack bundler throws ENOENT.  `require.resolve` is
     * preferred over a bare string so that a typo surfaces immediately with a
     * clear "Cannot find module" error rather than a cryptic bundler crash.
     */
    workflowsPath: require.resolve('./workflows'),

    /**
     * Register all exported activity functions.
     *
     * Activities run in the normal Node.js environment, not the sandbox, so
     * they have access to `loro-crdt`, `ws`, and every other dependency.
     */
    activities,
  });

  // ---- Graceful shutdown ----------------------------------------------------
  // Register SIGINT / SIGTERM handlers *before* worker.run() so that a
  // Ctrl-C during startup still produces a clean shutdown.

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[agent-worker] ${signal} received — shutting down`);

    // Close the WebSocket to the backend (no-op if it was never connected).
    getBackendSocket().close();

    // Ask the Temporal worker to drain its current task and stop polling.
    worker.shutdown();
  };

  process.once('SIGINT',  () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  // --------------------------------------------------------------------------
  // Day 6 extension point:
  //
  //   Uncomment and expand the block below to pre-connect the WebSocket before
  //   the worker starts accepting tasks.  Failure to connect is logged but does
  //   NOT prevent the worker from starting — activities will surface the error
  //   when they first try to push a delta.
  //
  // try {
  //   await getBackendSocket().connect();
  //   console.log('[agent-worker] backend WebSocket connected');
  // } catch (err) {
  //   console.warn('[agent-worker] could not pre-connect to backend:', err);
  // }
  // --------------------------------------------------------------------------

  console.log('[agent-worker] worker started — polling for tasks');
  await worker.run();

  // `worker.run()` resolves after the worker drains on shutdown.
  await connection.close();
  console.log('[agent-worker] shutdown complete');
}

main().catch((err: unknown) => {
  console.error('[agent-worker] fatal startup error:', err);
  process.exit(1);
});
