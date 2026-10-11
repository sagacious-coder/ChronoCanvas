/**
 * ChronoCanvas agent-worker — Temporal Activities (Stage 3: Live LLM Integration).
 *
 * Activities run in a normal Node.js environment (no Temporal sandbox), so they
 * have full access to the file system, network, and native modules — including
 * the Loro CRDT wasm binding and the OpenAI SDK.
 *
 * Activity surface:
 *   - `captureCheckpoint`         — read Loro frontier, return JSON checkpoint.
 *   - `generateAgentMutation`     — call the LLM with the current document state
 *                                   and the user's instruction; return a
 *                                   structured {@link AgentMutation} JSON object
 *                                   describing the exact edit to make.
 *   - `generateAndInjectResponse` — call the LLM via OpenRouter, append the
 *                                   response to the Loro canvas, broadcast the
 *                                   binary update through the BackendSocket.
 *                                   On any failure during generation or CRDT
 *                                   mutation, the activity performs an instant
 *                                   `doc.checkout(savedFrontiers)` rollback,
 *                                   broadcasts the reverted state, then
 *                                   re-throws so Temporal marks the run failed.
 *
 * Environment variables consumed here (all loaded via `llm.ts` / dotenv):
 *   - `OPENROUTER_API_KEY`    — required for any LLM activity.
 *   - `OPENROUTER_BASE_URL`   — optional override (default: https://openrouter.ai/api/v1).
 *   - `OPENROUTER_MODEL`      — optional model override (default: openrouter/auto).
 *   - `CHRONO_WORKER_ID`      — stable worker id stamped on the AgentSyncEnvelope.
 */

import { Context, ApplicationFailure } from '@temporalio/activity';
import { LoroDoc } from 'loro-crdt';
import type { LoroCheckpoint, FrontierEntry, AgentSyncEnvelope } from './types';
import { getBackendSocket } from './connection';
import { getLlmClient, getLlmModel } from './llm';
// NOTE: getLlmClient / getLlmModel are used exclusively by generateAgentMutation
// (Phase 2).  generateAndInjectResponse (Phase 3) applies the pre-computed
// AgentMutation directly to Loro without a second LLM round-trip.

// ---- Helpers ----------------------------------------------------------------

/**
 * Safely encode a `bigint` peer ID as a decimal string for JSON transport.
 * Loro's `doc.frontiers()` returns `{ peer: bigint; counter: number }[]`.
 * Plain `JSON.stringify` would throw on BigInt — this normalises it first.
 */
function encodePeer(peer: bigint | string | number): string {
  return typeof peer === 'bigint' ? peer.toString(10) : String(peer);
}

// ---- Activities -------------------------------------------------------------

/**
 * Initialise a headless LoroDoc, import the caller-supplied binary state,
 * read the resulting causal frontier via `doc.frontiers()`, and return the
 * checkpoint as a JSON string ready for Temporal's history log.
 *
 * @param docId   - Stable document identifier; recorded in the checkpoint.
 * @param stateBytes - The serialised Loro state to inspect.  Pass an empty
 *                    array to capture the frontier of a brand-new doc (will be
 *                    an empty frontier `[]`).
 * @returns A JSON string that deserialises to {@link LoroCheckpoint}.
 *
 * @remarks
 * The activity is heartbeat-safe: it calls `Context.current().heartbeat()`
 * before and after the wasm import so the Temporal server knows we are alive
 * during potentially large state imports. If the activity is cancelled while
 * blocked inside the wasm call, the cancellation will be honoured on the next
 * heartbeat check.
 */
export async function captureCheckpoint(
  docId: string,
  stateBytes: number[],
): Promise<string> {
  const ctx = Context.current();

  ctx.heartbeat('starting-loro-import');

  const doc = new LoroDoc();

  // Convert the plain-number array (JSON-serialisable across the Temporal
  // activity boundary) back into a Uint8Array for Loro.
  const bytes = new Uint8Array(stateBytes);

  if (bytes.length > 0) {
    try {
      doc.import(bytes);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[captureCheckpoint] LoroDoc.import failed for doc "${docId}": ${msg}`);
    }
  }

  ctx.heartbeat('reading-frontiers');

  // `doc.frontiers()` returns `Array<{ peer: bigint; counter: number }>`.
  // The peer ID is a BigInt and is not JSON-serialisable; normalise to string.
  const rawFrontiers = doc.frontiers();
  const frontiers: FrontierEntry[] = rawFrontiers.map((f) => ({
    peer: encodePeer(f.peer as unknown as bigint),
    counter: f.counter,
  }));

  const checkpoint: LoroCheckpoint = {
    capturedAt: new Date().toISOString(),
    docId,
    frontiers,
  };

  return JSON.stringify(checkpoint);
}

// ---- LLM helpers ------------------------------------------------------------

/** Base64-encode a Uint8Array for the AgentSyncEnvelope payload field. */
const toB64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

// ---- Structured mutation type -----------------------------------------------

/**
 * The JSON schema the LLM must produce for {@link generateAgentMutation}.
 *
 * The agent evaluates the `currentDocumentState`, decides *where* to edit, and
 * returns this shape — never free-form prose, never markdown fences.
 *
 * @field operation  - `'insert'` adds text at position; `'replace'` removes a
 *                    range and replaces it; `'append'` adds text at the end.
 * @field position   - 0-based character offset (required for insert/replace).
 * @field deleteCount - number of characters to remove before inserting
 *                    `content` (required when operation is `'replace'`).
 * @field content    - the exact text to write; must NOT contain markdown fences,
 *                    triple-backticks, or commentary.
 * @field rationale  - one sentence explaining why this edit was chosen.
 */
export interface AgentMutation {
  operation: 'insert' | 'replace' | 'append';
  position?: number;
  deleteCount?: number;
  content: string;
  rationale: string;
}

// ---- generateAgentMutation --------------------------------------------------

/**
 * Temporal activity — call the LLM with the user's instruction and the full
 * current document state; return a structured {@link AgentMutation} JSON object.
 *
 * **Prompt discipline**: the system prompt instructs the model to act as a
 * *precise code editor*, evaluate the document state, determine the minimal
 * edit needed, and output ONLY a raw JSON object matching the AgentMutation
 * schema — no markdown, no commentary, no triple-backtick fences.
 *
 * This activity is intentionally decoupled from CRDT writes so it can be
 * retried independently (the Temporal retry policy on the proxy that calls it
 * applies here) without risking a double-write to Loro.
 *
 * @param instruction         - The user's natural-language edit request
 *                              (e.g. "Implement binary search").
 * @param currentDocumentState - Full text of the canvas as a plain string.
 * @param apiKey               - Optional user BYOK API key (overrides OPENROUTER_API_KEY).
 * @returns A JSON string that deserialises to {@link AgentMutation}.
 *
 * @throws When the LLM returns empty output or invalid JSON — the caller
 *         (the workflow) should decide whether to retry or roll back.
 */
export async function generateAgentMutation(
  instruction: string,
  currentDocumentState: string,
  apiKey?: string,
): Promise<string> {
  const ctx = Context.current();
  ctx.heartbeat('generate-mutation:start');

  const openai = getLlmClient(apiKey);
  const model  = getLlmModel();

  // ---- Pre-compute structural metadata from the live canvas ------------------
  //
  // Metadata is embedded in the USER message (not the system prompt) because
  // many OpenRouter models silently truncate or ignore system prompt content
  // when `response_format: { type: 'json_object' }` is active, especially when
  // the system prompt contains triple-backtick fenced blocks.  Moving the
  // canvas text to the user turn guarantees the model sees it.

  const docLength = currentDocumentState.length;
  const lineCount = currentDocumentState ? currentDocumentState.split('\n').length : 0;

  // Detect empty function stubs so we can give the LLM exact positions for
  // "replace" operations rather than having it guess.
  const stubPattern = /^[ \t]*(function\s+\w+\s*\([^)]*\)\s*\{[\s\S]*?\}|const\s+\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{[\s\S]*?\})/gm;
  const stubs: Array<{ name: string; position: number; length: number }> = [];
  let stubMatch: RegExpExecArray | null;
  while ((stubMatch = stubPattern.exec(currentDocumentState)) !== null) {
    stubs.push({
      name: stubMatch[1]?.match(/(?:function\s+|const\s+)(\w+)/)?.[1] ?? '(anonymous)',
      position: stubMatch.index,
      length: stubMatch[0].length,
    });
  }

  const lastNewline = currentDocumentState.lastIndexOf('\n');
  const lastLineOffset = lastNewline === -1 ? 0 : lastNewline + 1;

  // ---- System prompt: schema + output rules only (keep short) -----------------
  //
  // IMPORTANT: Do NOT embed the canvas text here. When response_format is
  // json_object, several hosted models (including those on OpenRouter) silently
  // drop content in system prompts that contain backtick-fenced code blocks or
  // exceed ~2 KB.  The canvas is delivered in the user message instead.
  const systemPrompt = `You are an expert autonomous code editor. Your ONLY output must be a single raw JSON object — no markdown, no backticks, no prose.

You will receive the CURRENT CANVAS STATE and a user INSTRUCTION in the next message.

OPERATIONS:
- "append"  → add content after the last character. No position needed.
- "insert"  → insert content at 0-based character index "position". Requires "position".
- "replace" → delete "deleteCount" chars from "position", then insert content. Requires "position" and "deleteCount".

OUTPUT SCHEMA (no extra keys, no omitted keys):
{
  "operation": "append" | "insert" | "replace",
  "position": <number, required for insert/replace>,
  "deleteCount": <number, required for replace>,
  "content": "<exact code to write>",
  "rationale": "<one sentence>"
}

RULES:
1. If the canvas already has code, analyse it and make a TARGETED edit — never treat a non-empty canvas as empty.
2. STRICT RULE: If the instruction targets a function that has an empty stub in the metadata, you MUST use "replace" with the exact position and length provided to overwrite the stub. Do NOT use "append" which would create a duplicate definition.
3. Prefer "append" for new top-level additions ONLY when no stub exists.
4. Match the language of the existing code. You MUST write code in the EXACT SAME LANGUAGE as the provided canvas. Do NOT write Python if the canvas is JavaScript.
5. Output ONLY the JSON object. Anything else will cause a fatal parse error.`;

  // ---- User message: carry the full canvas context --------------------------
  //
  // The document state lives here so it passes through response_format:json_object
  // reliably. The structural metadata (char count, stub positions) is pre-computed
  // above and listed explicitly so the model can pick exact positions without
  // mentally scanning the full text.
  let userMessage: string;
  if (currentDocumentState.length > 0) {
    const stubInfo = stubs.length > 0
      ? stubs.map(s => `  - "${s.name}": position=${s.position}, length=${s.length} (use replace to fill this stub)`).join('\n')
      : '  - none detected';

    userMessage = [
      `INSTRUCTION: ${instruction}`,
      '',
      'CURRENT CANVAS STATE:',
      `  Total characters : ${docLength}`,
      `  Total lines      : ${lineCount}`,
      `  Last line offset : ${lastLineOffset}`,
      `  Empty stubs      :`,
      stubInfo,
      '',
      'DOCUMENT TEXT (character positions are 0-based):',
      '---',
      currentDocumentState,
      '---',
      '',
      'Now output the JSON edit object.',
    ].join('\n');
  } else {
    userMessage = [
      `INSTRUCTION: ${instruction}`,
      '',
      'CURRENT CANVAS STATE: (empty — use "append" to write the initial content)',
      '',
      'Now output the JSON edit object.',
    ].join('\n');
  }

  console.log(
    `[generateAgentMutation] canvas snapshot: ${docLength} chars, ${lineCount} lines, ${stubs.length} stubs`,
  );


  ctx.heartbeat('generate-mutation:calling-llm');

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userMessage  },
  ];

  console.log("=== FINAL MESSAGES PAYLOAD ===", JSON.stringify(messages, null, 2));

  const completion = await openai.chat.completions.create({
    model,
    messages,
    // Request JSON mode if the model supports it (OpenRouter passes this through).
    response_format: { type: 'json_object' },
    temperature: 0.2,  // Low temperature = deterministic, precise edits.
  });

  ctx.heartbeat('generate-mutation:parsing');

  const raw = completion.choices[0]?.message?.content ?? '';
  if (!raw.trim()) {
    throw new Error('[generateAgentMutation] LLM returned an empty response.');
  }

  // Defensively strip markdown code blocks if the LLM hallucinated them
  let cleanRaw = raw.trim();
  if (cleanRaw.startsWith('```')) {
    const lines = cleanRaw.split('\n');
    if (lines[0].startsWith('```')) lines.shift();
    if (lines[lines.length - 1].startsWith('```')) lines.pop();
    cleanRaw = lines.join('\n').trim();
  }

  console.log(`[generateAgentMutation] Raw LLM output:\n${cleanRaw}`);

  // Validate the response is well-formed JSON with the required fields.
  let mutation: AgentMutation;
  try {
    mutation = JSON.parse(cleanRaw) as AgentMutation;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[generateAgentMutation] LLM response is not valid JSON: ${msg}\n\nRaw response:\n${raw}`,
    );
  }

  if (!mutation.operation || typeof mutation.content !== 'string' || typeof mutation.rationale !== 'string') {
    throw new Error(
      `[generateAgentMutation] LLM response is missing basic required fields (operation, content, rationale).\n\nParsed: ${JSON.stringify(mutation)}`,
    );
  }

  if (mutation.operation === 'insert' && typeof mutation.position !== 'number') {
    throw new Error(
      `[generateAgentMutation] 'insert' operation requires a numeric 'position'.\n\nParsed: ${JSON.stringify(mutation)}`
    );
  }

  if (mutation.operation === 'replace' && (typeof mutation.position !== 'number' || typeof mutation.deleteCount !== 'number')) {
    throw new Error(
      `[generateAgentMutation] 'replace' operation requires numeric 'position' and 'deleteCount'.\n\nParsed: ${JSON.stringify(mutation)}`
    );
  }

  console.log(
    `[generateAgentMutation] op="${mutation.operation}" ` +
    `pos=${mutation.position ?? 'n/a'} ` +
    `deleteCount=${mutation.deleteCount ?? 'n/a'} ` +
    `content.length=${mutation.content.length}`,
  );

  return JSON.stringify(mutation);
}

// ---- Activities (continued) -------------------------------------------------

/**
 * CRDT injection activity — applies a pre-generated {@link AgentMutation} to
 * the Loro canvas and broadcasts the incremental update.
 *
 * This activity is Phase 3 of the `agentSyncWorkflow`.  By the time it runs,
 * Phase 2 (`generateAgentMutation`) has already called the LLM and returned a
 * validated `AgentMutation` JSON string.  This activity's only job is to:
 *
 *   1. Deserialise the Loro state into a headless `LoroDoc`.
 *   2. Decode the checkpoint frontiers (the rollback target).
 *   3. Parse the `mutationJson` and apply the structured edit to the Loro
 *      `LoroText` container using the exact `operation`/`position`/`deleteCount`
 *      /`content` fields — **no second LLM call**.
 *   4. Export an incremental binary update and broadcast it via the backend
 *      WebSocket so all clients converge instantly.
 *
 * On **any** error thrown by steps 3–4, the catch block:
 *   - Calls `doc.checkout(savedFrontiers)` to revert all agent ops in-place
 *     (sub-5 ms for typical session-size documents).
 *   - Exports the rolled-back state and broadcasts it as an `AgentSyncEnvelope`
 *     so every client instantly sees the clean, pre-agent canvas.
 *   - Re-throws the original error so Temporal records the activity as failed.
 *
 * @param docId          - Stable document id; stamped on the envelope.
 * @param stateBytes     - Current Loro state, serialised as a `number[]` for
 *                         JSON transport across the Temporal activity boundary.
 * @param mutationJson   - JSON string produced by {@link generateAgentMutation}
 *                         (i.e. a serialised {@link AgentMutation}).
 *                         Passed via the `systemInstruction` parameter slot
 *                         to preserve the existing Temporal activity signature.
 * @param checkpointJson - JSON string produced by {@link captureCheckpoint}.
 *                         Contains the frontier we revert to on failure.
 * @returns The inserted/replaced content string (useful for Temporal history).
 *
 * @throws Re-throws any error from the mutation/broadcast phase after the
 *         rollback broadcast has been sent.
 */
export async function generateAndInjectResponse(
  docId: string,
  stateBytes: number[],
  systemInstruction: string,
  checkpointJson: string,
): Promise<string> {
  const ctx = Context.current();
  const workerId = process.env.CHRONO_WORKER_ID ?? 'agent-worker';

  // ---- 1. Load Loro state ---------------------------------------------------
  ctx.heartbeat('loading-loro-state');

  const doc = new LoroDoc();
  const bytes = new Uint8Array(stateBytes);

  if (bytes.length > 0) {
    try {
      doc.import(bytes);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[generateAndInjectResponse] LoroDoc.import failed for doc "${docId}": ${msg}`,
      );
    }
  }

  // ---- 2. Decode the saved checkpoint into Loro-native frontiers ------------
  //
  // `checkpointJson` was produced by `captureCheckpoint`, which normalised
  // bigint peer IDs to decimal strings via `encodePeer`.  Loro's `PeerID` type
  // is defined as `\`${number}\`` — a decimal string — so `FrontierEntry.peer`
  // is already the correct shape; we cast it directly without any BigInt
  // conversion.
  //
  // Loro checkout signature: `checkout(frontiers: { peer: PeerID; counter: number }[])`
  // where `type PeerID = \`${number}\`` (loro-crdt/*/loro_wasm.d.ts, line 69).
  let savedFrontiers: { peer: `${number}`; counter: number }[];
  try {
    const checkpoint: LoroCheckpoint = JSON.parse(checkpointJson) as LoroCheckpoint;
    savedFrontiers = checkpoint.frontiers.map((f: FrontierEntry) => ({
      // `f.peer` is already a decimal string produced by `encodePeer(bigint)`.
      // The cast to `${number}` matches Loro's PeerID template-literal type.
      peer: f.peer as `${number}`,
      counter: f.counter,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[generateAndInjectResponse] Failed to parse checkpointJson for doc "${docId}": ${msg}`,
    );
  }

  // ---- 3. Read canvas text --------------------------------------------------
  // The "codemirror" container is the single canonical text container owned by
  // loro-codemirror's LoroSyncPlugin. All editor clients write here.
  const textContainer = doc.getText('codemirror');
  const currentText = textContainer.toString();

  console.log(
    `[generateAndInjectResponse] doc="${docId}" canvas text length=${currentText.length}`,
  );

  // Snapshot the version vector *before* any agent write so the success-path
  // incremental export contains only the new ops and the rollback broadcast
  // can be diffed from the same baseline.
  const versionBefore = doc.version();

  // ---- Helper: connect the socket lazily (shared by success + rollback) -----
  const socket = getBackendSocket(workerId);
  if (!socket.isConnected) {
    await socket.connect();
  }

  // ---- Rollback helper ------------------------------------------------------
  //
  // Must be defined before the try block so the catch can close over it.
  // Exported as an inner function to keep the happy-path readable.
  //
  // The Loro `checkout` call is synchronous and targets the exact ops recorded
  // in `savedFrontiers`.  Because Loro is a CRDT, any concurrent human edits
  // that arrived after the checkpoint was captured are NOT reverted — only the
  // agent's own ops are rewound.  The whole operation completes in < 5 ms for
  // documents of typical session size.
  async function broadcastRollback(cause: unknown): Promise<void> {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    console.warn(
      `[generateAndInjectResponse] doc="${docId}" rolling back agent ops — cause: ${causeMsg}`,
    );

    try {
      // Revert all agent ops committed after the checkpoint.
      // `doc.checkout()` accepts `{ peer: bigint; counter: number }[]`.
      doc.checkout(savedFrontiers);

      // Export only the delta since our pre-write baseline so clients that
      // already applied the (now-reverted) agent ops converge back cleanly.
      const rollbackBytes = doc.export({ mode: 'update', from: versionBefore });

      const rollbackEnvelope: AgentSyncEnvelope = {
        type: 'crdt-sync',
        docId,
        payload: toB64(rollbackBytes),
        senderId: workerId,
        origin: 'agent',
        timestamp: Date.now(),
      };

      socket.sendSyncMessage(rollbackEnvelope);

      console.log(
        `[generateAndInjectResponse] doc="${docId}" rollback broadcast sent` +
        ` (${rollbackBytes.length} bytes)`,
      );
    } catch (rollbackErr) {
      // The rollback itself failed — log loudly so an operator can investigate,
      // but still re-throw the *original* error below so Temporal history is
      // accurate about what initially went wrong.
      console.error(
        `[generateAndInjectResponse] doc="${docId}" ROLLBACK FAILED:`,
        rollbackErr,
      );
    }
  }

  // ---- 4–6. Parse mutation, apply to Loro, and broadcast (crash-protected) --
  try {
    // ---- [4] Parse the structured AgentMutation from Phase 2 ----------------
    //
    // `systemInstruction` carries the raw JSON string returned by
    // `generateAgentMutation` (Phase 2).  We validate it here rather than
    // trusting that Phase 2's schema check was sufficient — defensive parsing
    // ensures that a future change to the activity signature cannot silently
    // inject garbage into the Loro document.
    ctx.heartbeat('parsing-mutation');

    let mutation: AgentMutation;
    try {
      mutation = JSON.parse(systemInstruction) as AgentMutation;
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      throw new Error(
        `[generateAndInjectResponse] mutationJson is not valid JSON for doc "${docId}": ${msg}` +
        `\n\nRaw mutationJson:\n${systemInstruction}`,
      );
    }

    if (!mutation.operation || !mutation.content) {
      throw new Error(
        `[generateAndInjectResponse] mutationJson is missing required fields ` +
        `(operation, content) for doc "${docId}". Parsed: ${JSON.stringify(mutation)}`,
      );
    }

    console.log(
      `[generateAndInjectResponse] doc="${docId}" applying op="${mutation.operation}" ` +
      `pos=${mutation.position ?? 'n/a'} ` +
      `deleteCount=${mutation.deleteCount ?? 'n/a'} ` +
      `content.length=${mutation.content.length} ` +
      `rationale="${mutation.rationale}"`,
    );

    // ---- [5] Apply the structured mutation to the Loro LoroText -------------
    ctx.heartbeat('writing-to-loro');

    const docLength = textContainer.length;

    switch (mutation.operation) {
      case 'insert': {
        // Position defaults to end-of-document if omitted, matching 'append'
        // semantics as a safe fallback.
        const pos = Math.min(mutation.position ?? docLength, docLength);
        textContainer.insert(pos, mutation.content);
        break;
      }

      case 'replace': {
        const pos = Math.min(mutation.position ?? 0, docLength);
        const deleteCount = Math.min(
          mutation.deleteCount ?? 0,
          docLength - pos,  // clamp so we never delete past the end
        );
        if (deleteCount > 0) {
          textContainer.delete(pos, deleteCount);
        }
        textContainer.insert(pos, mutation.content);
        break;
      }

      case 'append':
      default: {
        // Append a newline separator when the canvas already has content so
        // the agent's addition is visually distinct.
        const prefix = currentText.length > 0 ? '\n' : '';
        textContainer.insert(docLength, prefix + mutation.content);
        break;
      }
    }

    // ---- [6] Export incremental update + broadcast -------------------------
    ctx.heartbeat('broadcasting-update');

    const updateBytes = doc.export({ mode: 'update', from: versionBefore });

    const envelope: AgentSyncEnvelope = {
      type: 'crdt-sync',
      docId,
      payload: toB64(updateBytes),
      senderId: workerId,
      // Omit versionFrom — we are pushing a delta, not joining as a peer that
      // needs a backfill diff.  The server merges and fans out.
      origin: 'agent',
      timestamp: Date.now(),
    };

    socket.sendSyncMessage(envelope);

    console.log(
      `[generateAndInjectResponse] doc="${docId}" update broadcast (${updateBytes.length} bytes)`,
    );

    return mutation.content;

  } catch (err) {
    // ---- Rollback path -------------------------------------------------------
    //
    // Any error thrown by steps 4–6 lands here.  We attempt the checkout +
    // broadcast before re-throwing so Temporal sees a proper activity failure
    // (not a silent hang) and so clients are immediately healed.
    await broadcastRollback(err);

    // Re-throw the original error so the Temporal server records the activity
    // as failed, the workflow can react (e.g. surface to the caller or retry
    // with a capped attempt count), and Temporal history remains accurate.
    throw err;
  }
}

// ---- Emit Status -------------------------------------------------------------

/**
 * Activity to emit an intermediate status directly to the frontend via WebSocket.
 */
export async function emitTaskStatus(taskId: string, status: string, errorTrace?: string): Promise<void> {
  const workerId = process.env.CHRONO_WORKER_ID ?? 'agent-worker';
  const socket = getBackendSocket(workerId);
  if (!socket.isConnected) {
    await socket.connect();
  }
  const msg: Record<string, unknown> = {
    type: 'agent-task-status',
    taskId,
    status,
  };
  if (errorTrace) {
    msg.errorTrace = errorTrace;
  }
  socket.sendSyncMessage(msg);
}

// ---- Verify Syntax ----------------------------------------------------------

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Sandboxed testing activity — applies the mutation to a local headless Loro doc,
 * writes the resulting code to a temp file, and verifies it with uv run python.
 */
export async function verifyMutationSyntax(
  stateBytes: number[],
  mutationJson: string
): Promise<void> {
  const ctx = Context.current();
  ctx.heartbeat('sandboxed-testing');

  // Load Loro state
  const doc = new LoroDoc();
  const bytes = new Uint8Array(stateBytes);
  if (bytes.length > 0) {
    doc.import(bytes);
  }

  // Parse mutation
  const mutation = JSON.parse(mutationJson) as AgentMutation;
  const textContainer = doc.getText('codemirror');
  const docLength = textContainer.length;
  const currentText = textContainer.toString();

  switch (mutation.operation) {
    case 'insert':
      textContainer.insert(Math.min(mutation.position ?? docLength, docLength), mutation.content);
      break;
    case 'replace':
      const pos = Math.min(mutation.position ?? 0, docLength);
      const del = Math.min(mutation.deleteCount ?? 0, docLength - pos);
      if (del > 0) textContainer.delete(pos, del);
      textContainer.insert(pos, mutation.content);
      break;
    case 'append':
    default:
      const prefix = currentText.length > 0 ? '\n' : '';
      textContainer.insert(docLength, prefix + mutation.content);
      break;
  }

  const generatedCode = textContainer.toString();
  
  // Write to ephemeral file
  const tempFile = path.join(os.tmpdir(), `test_${Date.now()}_${Math.random().toString(36).substring(7)}.py`);
  fs.writeFileSync(tempFile, generatedCode);

  try {
    // Run syntax check
    // Ensure we use uv for testing as per requirements
    execSync(`uv run python -m py_compile ${tempFile}`, { stdio: 'pipe' });
  } catch (err: any) {
    // The command failed, return the stderr for the LLM
    const stderr = err.stderr ? err.stderr.toString() : err.message;
    throw ApplicationFailure.nonRetryable(`SYNTAX_ERROR: ${stderr}`);
  } finally {
    try {
      fs.unlinkSync(tempFile);
    } catch {
      // ignore
    }
  }
}

