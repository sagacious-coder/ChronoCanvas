import { WebSocket } from 'ws';
import { LoroDoc, VersionVector } from 'loro-crdt';
import { EventHub } from './dist/EventHub.js';

const URL = `ws://127.0.0.1:${process.env.PORT}`;
const DOC = 'harden-test';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (b) => Buffer.from(b).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const hex = (vv) => Buffer.from(vv.encode()).toString('hex');

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' :: ' + extra : ''}`);
  if (!ok) failures++;
};

function peer(name) {
  const doc = new LoroDoc();
  const ws = new WebSocket(URL);
  const p = { name, doc, ws, inbox: [] };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    p.inbox.push(m);
    if (m.type === 'crdt-sync' && m.payload) doc.import(unb64(m.payload));
  });
  p.ready = new Promise((res) => ws.on('open', res));
  p.push = (payload) =>
    ws.send(JSON.stringify({
      type: 'crdt-sync', docId: DOC,
      payload: payload ?? '', versionFrom: hex(doc.version()),
      senderId: name, timestamp: Date.now(),
    }));
  p.edit = (text) => {
    const before = doc.version();
    doc.getText('code').insert(doc.getText('code').length, text);
    doc.commit();
    p.push(b64(doc.export({ mode: 'update', from: before })));
  };
  p.text = () => doc.getText('code').toString();
  return p;
}

const a = peer('alice');
const b = peer('bob');
await Promise.all([a.ready, b.ready]);

// --- cold join + convergence -------------------------------------------------
a.push('');  // join, no payload
b.push('');
await sleep(150);
a.inbox.length = 0; b.inbox.length = 0;

a.edit('hello ');
await sleep(200);
check('peer B receives A edit', b.text() === 'hello ', `b="${b.text()}"`);
check('peer A gets zero self-echo', a.inbox.length === 0, `inbox=${a.inbox.length}`);

// The Event Hub stamps every human edit `origin: 'human'`, and `broadcast`
// puts it on the outbound frame so a peer can tell a human write from an agent's.
const humanSync = b.inbox.find((m) => m.type === 'crdt-sync');
check("human edit is broadcast with origin:'human' on the wire",
  humanSync?.origin === 'human', `origin=${humanSync?.origin}`);

b.edit('world');
await sleep(200);
check('bidirectional convergence', a.text() === 'hello world' && b.text() === 'hello world',
  `a="${a.text()}" b="${b.text()}"`);

// --- late cold joiner gets a snapshot ---------------------------------------
const c = peer('carol');
await c.ready;
c.push(''); // no versionFrom payload -> cold start
await sleep(250);
check('cold joiner backfilled from snapshot', c.text() === 'hello world', `c="${c.text()}"`);

// --- crash boundaries --------------------------------------------------------
a.inbox.length = 0;
a.ws.send('{not json');
a.ws.send(JSON.stringify({ type: 'crdt-sync' }));                               // no docId
a.ws.send(JSON.stringify({ type: 'crdt-sync', docId: DOC, payload: 'zzz!!' }));  // junk payload
a.ws.send(JSON.stringify({ type: 'crdt-sync', docId: DOC, payload: b64(Buffer.from('garbage')) }));
a.ws.send(JSON.stringify({ type: 'crdt-sync', docId: DOC, versionFrom: 'nothex' }));
a.ws.send(JSON.stringify({ type: 'crdt-sync', docId: DOC, payload: '', versionFrom: 'ff'.repeat(80) }));
a.ws.send(JSON.stringify({ type: 'awareness-update' }));                          // no docId
a.ws.send(JSON.stringify({ type: 'crdt-sync', docId: 'x'.repeat(500), payload: '' }));
a.ws.send('[]');
a.ws.send('null');
await sleep(400);
check('server alive after malformed frames', a.ws.readyState === WebSocket.OPEN);

a.edit('!');
await sleep(250);
check('still syncing after abuse', b.text() === 'hello world!', `b="${b.text()}"`);

// --- version vector ahead of server (cmp === 1) ------------------------------
const rogue = new LoroDoc();
rogue.getText('code').insert(0, 'phantom');
rogue.commit();
b.ws.send(JSON.stringify({
  type: 'crdt-sync', docId: DOC, payload: '',
  versionFrom: hex(rogue.version()), senderId: 'bob', timestamp: Date.now(),
}));
await sleep(150);
a.edit('?');
await sleep(300);
check('resync heals a peer that claimed to be ahead', b.text() === 'hello world!?', `b="${b.text()}"`);

// --- version vector strictly ahead of the server (cmp === 1) ----------------
// Same peer set as the server, but a higher counter: `compare` returns 1 rather
// than undefined, which is the other half of the resync branch.
await sleep(150);
{
  const vv = b.doc.version();
  const [peerId, counter] = [...vv.toJSON()][0];
  vv.setEnd({ peer: peerId, counter: counter + 5 });
  b.ws.send(JSON.stringify({
    type: 'crdt-sync', docId: DOC, payload: '',
    versionFrom: hex(vv), senderId: 'bob', timestamp: Date.now(),
  }));
}
await sleep(150);
a.edit('#');
await sleep(300);
check('resync heals a peer strictly ahead of the server', b.text() === 'hello world!?#', `b="${b.text()}"`);

// --- a client that misreports versionFrom still gets no echo ----------------
// A buggy client sends the version it held *before* its own edit. The server
// must fold in the spans that actually arrived and still not hand the ops back.
await sleep(150);
a.inbox.length = 0; b.inbox.length = 0;
{
  const stale = hex(a.doc.version());               // captured BEFORE the edit
  const before = a.doc.version();
  a.doc.getText('code').insert(a.doc.getText('code').length, 'X');
  a.doc.commit();
  a.ws.send(JSON.stringify({
    type: 'crdt-sync', docId: DOC,
    payload: b64(a.doc.export({ mode: 'update', from: before })),
    versionFrom: stale, senderId: 'alice', timestamp: Date.now(),
  }));
}
await sleep(300);
check('stale versionFrom does not echo ops back to sender',
  a.inbox.filter((m) => m.type === 'crdt-sync').length === 0,
  `frames=${a.inbox.filter((m) => m.type === 'crdt-sync').length}`);
check('stale versionFrom still propagates to peers', b.text() === 'hello world!?#X', `b="${b.text()}"`);

// --- awareness is scoped by docId -------------------------------------------
b.inbox.length = 0; c.inbox.length = 0;
a.ws.send(JSON.stringify({
  type: 'awareness-update', docId: DOC,
  peer: { peerId: 'alice', userName: 'Alice', userColor: '#f00' },
  timestamp: Date.now(), smuggled: 'should-be-stripped',
}));
a.ws.send(JSON.stringify({
  type: 'awareness-update', docId: 'some-other-doc',
  peer: { peerId: 'alice', userName: 'Alice', userColor: '#f00' }, timestamp: Date.now(),
}));
await sleep(250);
const aw = b.inbox.filter((m) => m.type === 'awareness-update');
check('awareness relayed to same-doc peers only', aw.length === 1, `got ${aw.length}`);
check('awareness extra fields stripped', aw[0] && !('smuggled' in aw[0]), JSON.stringify(aw[0]));
check('awareness not echoed to sender',
  a.inbox.filter((m) => m.type === 'awareness-update').length === 0);

// --- concurrent writes serialize --------------------------------------------
for (let i = 0; i < 12; i++) { a.edit('a'); b.edit('b'); }
await sleep(700);
check('concurrent burst converges', a.text() === b.text() && a.text().length === 39,
  `a.len=${a.text().length} b.len=${b.text().length} equal=${a.text() === b.text()}`);

// --- eviction ----------------------------------------------------------------
a.ws.close(); b.ws.close(); c.ws.close();
await sleep(1500); // grace is 800ms in this run
const probe = peer('dave');
await probe.ready;
probe.push('');
await sleep(300);
check('room evicted when empty (fresh doc for next joiner)', probe.text() === '', `"${probe.text()}"`);
probe.ws.close();

// --- Event Hub stamps the origin flag per producer class ---------------------
// A browser peer can only ever produce `human` writes over the wire; agent
// writes arrive in-process via `submitAgentDelta` (there is no agent WS frame).
// So the agent side of the flag is verified by driving the Hub directly with a
// fake sink. The on-the-wire check above already proved `broadcast` carries
// whatever `kind` the Hub stamps onto the outbound frame — so a `kind: 'agent'`
// write would surface as `origin: 'agent'` on the wire by the same path.
{
  const seen = [];
  const hub = new EventHub(async (_docId, _bytes, _vv, origin) => { seen.push(origin.kind); });
  await hub.submitHumanDelta(DOC, null, null, { connId: 'conn-1', ws: {}, label: 'human-1' });
  await hub.submitAgentDelta(DOC, null, null, { agentId: 'agent-1', label: 'agent-1' });
  check("Event Hub stamps human writes origin:'human'", seen[0] === 'human', `kind=${seen[0]}`);
  check("Event Hub stamps agent writes origin:'agent'", seen[1] === 'agent', `kind=${seen[1]}`);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
