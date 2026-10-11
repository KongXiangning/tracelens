#!/usr/bin/env node
/** Non-blocking management API. Deliberately imports no task/qualification kernel. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { taskCommand, taskStatus as buildTaskStatus, synchronizeTasks, readTaskDisplay } from './task-management.mjs';
import { decodeObservation, MAX_LOGICAL_TASK_EVENT_BYTES } from './task-event-codec.mjs';
import { storeRead, storeReadFile, storeStat, storeExists, storeList, storeReserve, storePublishFile, archiveCommand, archiveInventory, withStoreReadContext } from './record-storage.mjs';

export const COMMANDS = ['context', 'record', 'snapshot', 'read', 'find', 'task', 'task-status', 'git-checkpoint', 'archive'];
const STORE = '.workflow-system/records';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const clamp = (n, fallback, max) => Number.isSafeInteger(n) && n > 0 ? Math.min(n, max) : fallback;
const failure = (code, message) => Object.assign(new Error(message), { code });
const issue = error => ({ code: error?.code ?? 'IO_ERROR', message: error instanceof Error ? error.message : String(error) });
const base = () => ({ runtime_role: 'assistance', development_gate: false, qualification: 'not-evaluated' });

// Protect this service's own I/O. This is not permission to edit product files.
function repositoryPath(root, requested) {
  if (typeof requested !== 'string' || !requested || requested.includes('\0'))
    throw failure('UNSAFE_PATH', 'Expected a repository-relative path or an in-repository absolute path.');
  const normalized = requested.replace(/\\/g, '/');
  const absolute = path.resolve(root, normalized);
  const relative = path.relative(path.resolve(root), absolute);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    || relative.split(path.sep).some(p => p.includes(':') || p.toLowerCase().replace(/[. ]+$/, '') === '.git'))
    throw failure('UNSAFE_PATH', 'Expected a repository-relative path without traversal into external or Git-control files.');
  return absolute;
}
function local(root, requested) {
  const absolute = repositoryPath(root, requested), relative = path.relative(path.resolve(root), absolute);
  let current = path.resolve(root);
  for (const part of [null, ...relative.split(path.sep)]) {
    if (part !== null) current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw failure('UNSAFE_PATH', 'Symbolic paths are not followed.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return current;
}
function ensureParent(root, target) {
  const parent = path.posix.dirname(target);
  fs.mkdirSync(local(root, parent), { recursive: true });
  local(root, parent); // Recheck after directory creation.
}
function hashFile(file) {
  const fd = fs.openSync(file, 'r');
  try {
    if (!fs.fstatSync(fd).isFile()) throw failure('NOT_A_FILE', 'Expected a regular file.');
    const hash = createHash('sha256'), buffer = Buffer.alloc(65536);
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}
// Resolve caller aliases once; the logical storage API keeps original relative refs.
function logicalRef(root, ref) { return path.relative(path.resolve(root), local(root, ref)).split(path.sep).join('/'); }
// Reservation preserves higher-level event/label replay behavior. Strict byte-level
// append is separately available from record-storage; timestamps are not rewritten.
function publish(root, target, bytes) { return storeReserve(root, logicalRef(root, target), Buffer.from(bytes)); }
function workflowHome(root, requested) {
  if (requested) { local(root, requested); return { home: requested, issues: [] }; }
  const fallback = 'docs/workflow';
  try {
    const profile = fs.readFileSync(local(root, '.workflow-system/PROJECT_PROFILE.yaml'), 'utf8');
    const match = /^[ \t]*workflow_home:[ \t]*(.*?)[ \t]*$/m.exec(profile);
    if (!match) return { home: fallback, issues: [] };
    let value = match[1].replace(/\s+#.*$/, '');
    if (value.startsWith('"')) value = JSON.parse(value);
    else if (value.startsWith("'")) {
      if (!value.endsWith("'")) throw failure('PROFILE_HINT_UNREADABLE', 'Unclosed workflow_home quote.');
      value = value.slice(1, -1).replace(/''/g, "'");
    } else if (!/^[^{}\[\]&*!>|%@`#\r\n]+$/u.test(value)) throw failure('PROFILE_HINT_UNREADABLE', 'Pass workflow_home explicitly for a non-scalar YAML value.');
    local(root, value);
    return { home: value, issues: [] };
  } catch (error) {
    return { home: fallback, issues: error.code === 'ENOENT' ? [] : [issue(error)] };
  }
}
function evidenceObjectPaths(digest, home) {
  if (!/^[a-f0-9]{64}$/.test(digest ?? '')) throw failure('INVALID_DIGEST', 'A SHA-256 object reference must have 64 lowercase hexadecimal characters.');
  return [`${STORE}/evidence-objects/${digest}.blob`, `${home}/evidence-objects/${digest}.blob`];
}
function verifyExistingBytes(root, ref, digest, declaredSize) {
  const metadata = storeStat(root, ref);
  if (metadata.sha256 !== digest) throw failure('OBJECT_CORRUPT', `Preserved object differs: ${ref}`);
  if (declaredSize !== undefined && (!Number.isSafeInteger(declaredSize) || declaredSize < 0 || declaredSize !== metadata.size))
    throw failure('REFERENCE_SIZE_MISMATCH', `Declared evidence size differs: ${ref}`);
  // Reuse asserts the complete preserved body exists; a zero-byte metadata probe
  // cannot establish this for a compressed archive.
  if (metadata.storage === 'archive') {
    const hash = createHash('sha256'), pageBytes = 16 * 1024 * 1024;
    if (metadata.size === 0) storeReadFile(root, ref);
    for (let offset = 0; offset < metadata.size; offset += pageBytes)
      hash.update(storeRead(root, ref, { offset, length: Math.min(pageBytes, metadata.size - offset), expectedSha256: digest }).bytes);
    if (hash.digest('hex') !== digest) throw failure('OBJECT_CORRUPT', `Preserved object differs: ${ref}`);
  }
  return metadata;
}
function preserved(root, digest, home) {
  for (const candidate of evidenceObjectPaths(digest, home)) {
    try { verifyExistingBytes(root, candidate, digest); return candidate; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw failure('HISTORICAL_OBJECT_UNAVAILABLE', `No preserved object for ${digest}; a digest cannot reconstruct missing bytes.`);
}
function fixedEvidenceReference(root, spec, requestedHome) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)
    || Object.keys(spec).some(k => !['ref', 'sha256', 'size', 'label', 'purpose', 'role', 'workflow_home'].includes(k))
    || !/^[a-f0-9]{64}$/.test(spec.sha256 ?? ''))
    throw failure('INVALID_EVIDENCE_REFERENCE', 'Use an existing immutable ref with SHA256 (or a known CAS SHA256), optional size/label/purpose/role/workflow_home; live paths belong in files.');
  const { home, issues } = workflowHome(root, spec.workflow_home ?? requestedHome);
  let ref;
  if (spec.ref !== undefined) {
    ref = logicalRef(root, spec.ref);
    const fact = /^\.workflow-system\/records\/(?:events\/[^/]+\.json|attachments\/[^/]+\.json|legacy\/current-[a-f0-9]{64}\.md)$/.test(ref);
    const objectDigest = /(?:^|\/)evidence-objects\/([a-f0-9]{64})\.blob$/.exec(ref)?.[1];
    if (!fact && objectDigest !== spec.sha256)
      throw failure('MUTABLE_EVIDENCE_REFERENCE', 'A live document path is not a fixed historical identity; snapshot it first, then reuse its returned ref and SHA256.');
  } else ref = preserved(root, spec.sha256, home);
  const meta = verifyExistingBytes(root, ref, spec.sha256, spec.size);
  return { status: 'referenced', kind: 'fixed-evidence-reference/v1', ref, sha256: spec.sha256, size: meta.size,
    request: spec, storage: meta.storage, live_source_read: false, verification: 'whole-file',
    current_applicability: 'not-evaluated', issues };
}
export function snapshot(root, input) {
  const { home, issues } = workflowHome(root, input.workflow_home);
  if (input.sha256) {
    try { const ref = preserved(root, input.sha256, home); return { ...base(), status: 'found', ref, sha256: input.sha256, issues }; }
    catch (error) { if (error.code !== 'HISTORICAL_OBJECT_UNAVAILABLE' || !input.path) throw error; }
  }
  const source = local(root, input.path);
  const directory = `${STORE}/evidence-objects`;
  ensureParent(root, `${directory}/placeholder`);
  const tempRef = `${directory}/${randomUUID()}.tmp`, temp = local(root, tempRef);
  const sourceRef = logicalRef(root, input.path), logical = !fs.existsSync(source);
  const fd = logical ? undefined : fs.openSync(source, 'r');
  let out;
  try {
    const before = logical ? storeStat(root, sourceRef) : fs.fstatSync(fd);
    if (!logical && !before.isFile()) throw failure('NOT_A_FILE', 'Only explicitly named regular files are captured.');
    out = fs.openSync(temp, 'wx', 0o600);
    const hash = createHash('sha256'), buffer = Buffer.alloc(65536);
    let count, size = 0;
    for (;;) {
      const part = logical ? storeRead(root, sourceRef, { offset: size, length: buffer.length }).bytes
        : buffer.subarray(0, fs.readSync(fd, buffer, 0, buffer.length, null));
      count = part.length; if (!count) break;
      hash.update(part); size += count; fs.writeFileSync(out, part);
    }
    fs.fsyncSync(out); fs.closeSync(out); out = undefined;
    const after = logical ? storeStat(root, sourceRef) : fs.fstatSync(fd), digest = hash.digest('hex');
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
      throw failure('SOURCE_CHANGED_DURING_CAPTURE', 'Source changed while being captured; no stable-source claim was made.');
    if (input.sha256 && input.sha256 !== digest)
      throw failure('HISTORICAL_OBJECT_UNAVAILABLE', 'The live file is not the requested historical content; it was not relabelled.');
    const ref = `${directory}/${digest}.blob`;
    storePublishFile(root, ref, tempRef, digest, size);
    return { ...base(), status: 'saved', ref, sha256: digest, size, source_path: input.path, issues };
  } finally {
    if (fd !== undefined) fs.closeSync(fd); if (out !== undefined) fs.closeSync(out);
    fs.rmSync(temp, { force: true });
  }
}
function recordObservation(root, input) {
  // Keep caller fields verbatim. Missing IDs, stale revisions and unknown kinds
  // are association information, never qualifications for retaining the report.
  const payload = input && typeof input === 'object' && !Array.isArray(input) ? input : { body: input };
  const payloadDigest = sha(JSON.stringify(stable(payload)));
  const key = typeof payload.idempotency_key === 'string' && payload.idempotency_key ? payload.idempotency_key : null;
  let id = key ? `key-${sha(key)}` : `${Date.now()}-${randomUUID()}`;
  let ref = `${STORE}/events/${id}.json`;
  const issues = [];
  for (;;) {
    const event = { schema_version: 1, kind: 'workflow-observation', recorded_at: new Date().toISOString(),
      payload_sha256: payloadDigest, assurance: 'caller-reported', payload, issues: [...issues] };
    if (publish(root, ref, json(event))) {
      // Raw observation is durable BEFORE optional file association/snapshotting.
      const attachments = [];
      for (const spec of Array.isArray(payload.files) ? payload.files : []) {
        try { attachments.push(snapshot(root, typeof spec === 'string' ? { path: spec, workflow_home: payload.workflow_home } : { workflow_home: payload.workflow_home, ...spec })); }
        catch (error) { attachments.push({ status: 'unavailable', request: spec, ...issue(error) }); }
      }
      if (payload.evidence_refs !== undefined) {
        if (!Array.isArray(payload.evidence_refs)) attachments.push({ status: 'unavailable', request: payload.evidence_refs,
          code: 'INVALID_EVIDENCE_REFERENCES', message: 'evidence_refs must be an array; the original request was retained.' });
        else for (const spec of payload.evidence_refs) {
          try { attachments.push(fixedEvidenceReference(root, spec, payload.workflow_home)); }
          catch (error) { attachments.push({ status: 'unavailable', request: spec, ...issue(error) }); }
        }
      }
      let attachmentsRef = null;
      if (attachments.length) {
        attachmentsRef = `${STORE}/attachments/${id}.json`;
        try { publish(root, attachmentsRef, json({ event_ref: ref, captured_at: new Date().toISOString(), attachments })); }
        catch (error) { issues.push(issue(error)); attachmentsRef = null; }
      }
      return { ...base(), status: 'recorded', recorded: true, ref, sha256: sha(json(event)),
        attachments_ref: attachmentsRef, attachments, issues };
    }
    let previous, validWire = false, sameRequest = false;
    try {
      previous = JSON.parse(storeReadFile(root, ref).toString('utf8'));
      validWire = sha(JSON.stringify(stable(previous.payload))) === previous.payload_sha256;
      if (!validWire) throw failure('EVENT_DIGEST_MISMATCH', 'Observation wire payload digest does not match.');
      if (previous.payload_sha256 !== payloadDigest && payload.kind === 'task-event' && previous.payload?.kind === 'task-event'
        && payload.request && previous.payload.request
        && JSON.stringify(stable(payload.request)) === JSON.stringify(stable(previous.payload.request))) {
        decodeObservation(previous);
        decodeObservation({ payload, payload_sha256: payloadDigest });
        sameRequest = true;
      }
    }
    catch (error) { issues.push({ ...issue(error), unreadable_ref: ref }); }
    if (validWire
      && (previous.payload_sha256 === payloadDigest || sameRequest)) {
      const a = `${STORE}/attachments/${id}.json`;
      return { ...base(), status: 'already-recorded', recorded: true, ref,
        attachments_ref: storeExists(root, a) ? a : null, issues: previous.issues ?? [],
        note: 'Replay does not rerun commands or recapture changed files.' };
    }
    issues.push({ code: 'IDEMPOTENCY_CONFLICT_RETAINED', conflicting_ref: ref,
      message: 'Different observation retained separately; the original was not overwritten.' });
    id = issues.length === 1 ? `conflict-${sha(key ?? id)}-${payloadDigest}` : `${Date.now()}-${randomUUID()}`;
    ref = `${STORE}/events/${id}.json`;
  }
}
// The raw store stays permissive. Management updates are a separately reported result.
const taskIO = readContext => ({ local, workflowHome, publish, record: recordObservation, snapshot,
  readFile: (root, ref) => storeReadFile(root, ref, { readContext }),
  list: (root, ref) => storeList(root, ref, { readContext }) });
export function task(root, input = {}) {
  if ((input?.action ?? 'status') === 'status') return taskStatus(root, input);
  try { return taskCommand(root, input, taskIO()); }
  catch (error) {
    if ((input?.action ?? 'status') === 'status') throw error;
    if (input?.action === 'rebuild') return { ...base(), status: 'unavailable', recorded: false, projection: { status: 'failed', ...issue(error) }, recovery_options: ['rebuild', 'defer'] };
    // A malformed management request must not destroy the original report/choice.
    const saved = recordObservation(root, { kind: 'unassociated-task-request', body: input });
    return { ...saved, association: 'unresolved', projection: { status: 'not-updated' },
      issues: [...saved.issues, issue(error)], recovery_options: ['link', 'correct', 'rebuild', 'defer'] };
  }
}
export function taskStatus(root, input = {}) {
  return withStoreReadContext(root, readContext => buildTaskStatus(root, input, taskIO(readContext)));
}
export function record(root, input) {
  const saved = recordObservation(root, input);
  try {
    const projection = synchronizeTasks(root, input && typeof input === 'object' ? input : {}, taskIO());
    const recordIssues = projection.view?.issues.filter(i => i.ref === saved.ref
      && (i.code?.startsWith('TASK_EVENT_') || ['RECORD_UNREADABLE', 'EVENT_VERSION_UNSUPPORTED'].includes(i.code))) ?? [];
    const diagnostics = recordIssues.length ? { association: 'unresolved',
      issues: [...new Map([...(projection.issues ?? []), ...recordIssues].map(i => [JSON.stringify(stable(i)), i])).values()] } : {};
    return { ...saved, management: { ...projection, view: undefined, ...diagnostics },
      current_task_id: projection.view?.current_task_id ?? null };
  } catch (error) {
    return { ...saved, management: { status: 'failed', ...issue(error), recovery_options: ['rebuild', 'defer'] } };
  }
}
export function read(root, input) {
  const { home, issues } = workflowHome(root, input.workflow_home);
  if (input.format === 'logical-task-event') {
    if (input.sha256 || (input.offset !== undefined && input.offset !== 0))
      throw failure('TASK_EVENT_READ_OPTIONS', 'A logical task-event read needs one event ref and has no byte offset or evidence-object digest selector.');
    const ref = logicalRef(root, input.path ?? input.ref), bytes = storeReadFile(root, ref);
    const event = JSON.parse(bytes.toString('utf8')), decoded = decodeObservation(event);
    if (decoded.payload.kind !== 'task-event' || decoded.payload.task_event?.version !== 1)
      throw failure('TASK_EVENT_READ_KIND', 'The selected observation is not a supported task event; use the raw paged read.');
    const logicalBytes = Buffer.byteLength(JSON.stringify(decoded.payload));
    const limit = clamp(input.max_bytes, MAX_LOGICAL_TASK_EVENT_BYTES, MAX_LOGICAL_TASK_EVENT_BYTES);
    if (logicalBytes > limit)
      throw failure('TASK_EVENT_EXPANSION_LIMIT', `Logical task payload exceeds the requested ${limit}-byte limit; use the raw paged read.`);
    return { ...base(), status: 'read', format: 'logical-task-event', ref, wire_size: bytes.length,
      wire_sha256: sha(bytes), logical_payload_bytes: logicalBytes, ...decoded, issues,
      note: 'Payload is the complete logical v1 task event. Wire hashes describe the unchanged stored event; logical_payload_sha256 describes the reconstructed payload. Default read returns original bytes.' };
  }
  let ref = input.path ?? input.ref, result;
  const offset = Number.isSafeInteger(input.offset) && input.offset >= 0 ? input.offset : 0;
  const options = { offset, length: clamp(input.max_bytes, 8192, 65536), expectedSha256: input.sha256 };
  if (input.sha256) {
    // Resolve and read in one storage operation: a cold page's metrics must not
    // hide extra full-object hashing or duplicate index scans in a preflight.
    for (const candidate of evidenceObjectPaths(input.sha256, home)) {
      try { result = storeRead(root, candidate, options); ref = candidate; break; }
      catch (error) {
        if (error.code === 'ENOENT') continue;
        if (error.code === 'OBJECT_CORRUPT') throw failure('OBJECT_CORRUPT', `Preserved object differs: ${candidate}`);
        throw error;
      }
    }
    if (!result && !ref) throw failure('HISTORICAL_OBJECT_UNAVAILABLE', `No preserved object for ${input.sha256}; a digest cannot reconstruct missing bytes.`);
  }
  result ??= storeRead(root, logicalRef(root, ref), options);
  const page = result.bytes;
  return { ...base(), status: 'read', ref, sha256: input.sha256 ?? null, actual_sha256: result.sha256, size: result.size, offset,
    next_offset: offset + page.length < result.size ? offset + page.length : null,
    encoding: 'base64', data: page.toString('base64'), text_preview: page.toString('utf8'),
    storage: result.storage, verification: result.verification, read_metrics: result.metrics,
    issues, note: 'Base64 is exact; UTF-8 preview may split a character at a byte-page boundary. Archive pages validate their blocks; archive verify checks complete objects and packs. Historical availability does not imply current applicability.' };
}
export function archive(root, input = {}) { return { ...base(), ...archiveCommand(root, input) }; }
export function find(root, input) {
  return withStoreReadContext(root, readContext => findRecords(root, input, readContext));
}
function findRecords(root, input, readContext) {
  const { home, issues } = workflowHome(root, input.workflow_home);
  const query = typeof input.query === 'string' ? input.query : '';
  const needle = Buffer.from(query);
  if (needle.length > 4096) throw failure('QUERY_TOO_LONG', 'Use a shorter literal search; this is a search request limit, not a workflow gate.');
  const roots = input.roots ?? [STORE, home, 'TASKS'];
  if (!Array.isArray(roots) || roots.some(p => typeof p !== 'string')) throw failure('INVALID_SEARCH_ROOTS', 'roots must be relative paths.');
  let pending = roots.slice().reverse().map(p => ({ path: p, offset: 0, named: false }));
  if (input.cursor) {
    const cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'));
    if (cursor.query !== query || !Array.isArray(cursor.pending)) throw failure('INVALID_CURSOR', 'Use a cursor from this literal query.');
    pending = cursor.pending;
  }
  const matches = [], max = clamp(input.max_results, 20, 100);
  let remaining = clamp(input.scan_bytes, 1048576, 4194304), visited = 0;
  while (pending.length && matches.length < max && remaining > 0 && visited++ < 2000) {
    const item = pending.pop();
    try {
      const ref = logicalRef(root, item.path), file = local(root, ref);
      if (ref.startsWith(`${STORE}/archives/`) || ref.startsWith(`${STORE}/archive-staging/`)
        || ref.startsWith(`${STORE}/archive-quarantine/`)) continue;
      let physical;
      try { physical = fs.lstatSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (physical?.isDirectory() || (!physical && !item.logical)) {
        if (ref === STORE || ref.startsWith(`${STORE}/`)) {
          const refs = storeList(root, ref, { hashLoose: false, readContext });
          if (!(refs.length === 1 && refs[0] === ref)) {
            pending.push(...refs.slice().reverse().map(p => ({ path: p, offset: 0, named: false, logical: true })));
            continue;
          }
        } else if (physical?.isDirectory()) {
          const names = fs.readdirSync(file).filter(n => !['.git', 'node_modules'].includes(n) && !n.endsWith('.tmp')).sort().reverse();
          pending.push(...names.map(n => ({ path: `${item.path}/${n}`, offset: 0, named: false })));
          continue;
        }
      }
      if (physical && !physical.isFile()) continue;
      const stat = storeStat(root, ref, { hashLoose: false, readContext });
      if (!item.named && (!query || item.path.includes(query))) {
        matches.push({ path: item.path, offset: null, match: 'path' }); item.named = true;
        if (!query) continue;
        if (matches.length >= max) { pending.push(item); break; }
      }
      item.named = true;
      const offset = Number.isSafeInteger(item.offset) && item.offset >= 0 ? item.offset : 0;
      const length = Math.min(65536, remaining, Math.max(0, stat.size - offset));
      if (!length) continue;
      const page = storeRead(root, ref, { offset, length: length + Math.max(0, needle.length - 1), hashLoose: false, readContext });
      const bytes = page.bytes, count = bytes.length;
      remaining -= length;
      let from = 0, next = offset + length;
      while (needle.length && from < length) {
        const at = bytes.indexOf(needle, from);
        if (at < 0 || at >= length) break;
        matches.push({ path: item.path, offset: offset + at, match: 'content',
          excerpt: bytes.subarray(Math.max(0, at - 80), Math.min(count, at + needle.length + 160)).toString('utf8') });
        from = at + 1;
        if (matches.length >= max) { next = offset + from; break; }
      }
      if (next < stat.size) pending.push({ ...item, offset: next });
    } catch (error) { if (error.code !== 'ENOENT') issues.push({ path: item.path, ...issue(error) }); }
  }
  return { ...base(), status: pending.length || issues.length ? 'partial' : 'complete', matches, issues,
    coverage: issues.length ? 'gaps-reported' : 'scanned-within-budget',
    next_cursor: pending.length ? Buffer.from(JSON.stringify({ query, pending })).toString('base64url') : null,
    note: 'Literal search over stored bytes, without active-task validation. Pagination is not a failure. Concurrent additions may require a fresh search.' };
}
export function context(root, input) {
  return withStoreReadContext(root, readContext => readContextView(root, input, readContext));
}
function readContextView(root, input, readContext) {
  const { home, issues } = workflowHome(root, input.workflow_home);
  const candidates = [`${home}/CURRENT_TASK.md`, `${home}/task-data`, `${home}/task-history`,
    `${home}/evidence-objects`, `${STORE}/events`, `${STORE}/legacy`, `${STORE}/task-view.json`, 'TASKS'];
  const sources = [];
  for (const candidate of candidates) {
    try { if (fs.existsSync(local(root, candidate)) || storeList(root, candidate, { readContext }).length) sources.push(candidate); }
    catch (error) { issues.push({ path: candidate, ...issue(error) }); }
  }
  const management = buildTaskStatus(root, input, taskIO(readContext));
  return { ...base(), status: 'available', workflow_home: home, sources, issues,
    current_task: management.current_task, current_task_id: management.current_task_id,
    tasks: management.tasks, management,
    records: findRecords(root, { query: input.task_ref ?? '', roots: [`${STORE}/events`], max_results: input.max_results ?? 20 }, readContext),
    note: 'Current task state is computed from the whole task journal; sources/search hits are navigation only. Inspect management.issues and unassociated_records. A closed task is not verified completion.' };
}
// Presentation only: keep the complete reducer and the existing JS APIs unchanged.
function queryOptions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw failure('INVALID_QUERY', 'Expected a JSON object.');
  if (input.task_id !== undefined || input.plan_ref !== undefined)
    throw failure('INVALID_QUERY', 'Use task_ref for selection; step detail reads the adopted/legacy plan. Read historical plan refs with read.');
  const detail = input.detail ?? 'summary';
  if (!['summary', 'task', 'step', 'full'].includes(detail))
    throw failure('INVALID_QUERY', 'detail must be summary, task, step or full.');
  for (const key of ['task_ref', 'step_id', 'expected_view_revision']) {
    if (input[key] !== undefined && (typeof input[key] !== 'string' || !input[key].trim()))
      throw failure('INVALID_QUERY', `${key} must be a nonempty string when supplied.`);
  }
  if (detail === 'step' && !input.step_id)
    throw failure('INVALID_QUERY', 'Step detail requires step_id; it reads the adopted/legacy plan only.');
  if (input.step_id !== undefined && detail !== 'step')
    throw failure('INVALID_QUERY', 'step_id requires detail=step; no selector is silently ignored.');
  const offset = input.offset ?? 0, limit = input.limit ?? 20;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw failure('INVALID_QUERY', 'Summary offset must be nonnegative and limit must be 1..100.');
  if (detail !== 'summary' && (input.offset !== undefined || input.limit !== undefined))
    throw failure('INVALID_QUERY', 'offset/limit paginate task summaries only.');
  if (offset > 0 && !input.expected_view_revision)
    throw failure('INVALID_QUERY', 'Continue summaries with expected_view_revision from the preceding page.');
  return { detail, offset, limit };
}
function stepSummary(step) {
  return { id: step.id, title: step.title ?? null, state: step.state,
    legacy_step_status: step.legacy_step_status, execution_ref: step.execution_ref,
    execution_result: step.execution?.result ?? null, review_ref: step.review_ref,
    review_status: step.review_status, review_choice: step.review_choice,
    review_decision_ref: step.review_decision_ref, disposition_ref: step.disposition_ref,
    finding_count: Array.isArray(step.findings) ? step.findings.length : 0, test_count: step.tests.length };
}
function followUpRequest(home, fields) { return { ...fields, workflow_home: home }; }
function returnSummary(result) {
  if (!result) return null;
  return { status: result.status, ref: result.ref ?? null, parent_task_id: result.parent_task_id ?? null,
    parent_plan_ref: result.parent_plan_ref ?? null, parent_step_id: result.parent_step_id ?? null };
}
function taskSummary(task, home) {
  const step = task.steps.find(s => s.id === task.current_step_id);
  const disposition = task.dispositions.find(d => d.ref === task.lifecycle_ref);
  return { task_id: task.task_id, display_id: task.display_id, title: task.title,
    lifecycle: task.lifecycle, lifecycle_ref: task.lifecycle_ref,
    plan_status: task.plan_status, adopted_plan_ref: task.adopted_plan_ref, adopted_by: task.adopted_by,
    legacy_plan_ref: task.legacy_plan_ref, legacy_source: task.legacy_source,
    current_step_id: task.current_step_id, current_step: step ? stepSummary(step) : null,
    next_route: task.next_route, next_mode: task.next_mode, next_action: task.next_action,
    recommendation_only: task.recommendation_only,
    origin: task.origin ? { ref: task.origin.ref, parent_task_id: task.origin.parent_task_id,
      parent_plan_ref: task.origin.parent_plan_ref, parent_step_id: task.origin.parent_step_id,
      return_policy: task.origin.return_policy } : null,
    dependency: { state: task.dependency.state, ref: task.dependency.ref },
    dependencies: task.dependencies.map(d => ({ ...d, return_result: returnSummary(d.return_result) })),
    return_result: returnSummary(task.return_result), waiting_on_task_ids: task.waiting_on_task_ids, continuation: task.continuation,
    remaining_work: disposition?.remaining_work ?? null, gaps: disposition?.gaps ?? null,
    counts: { steps: task.steps.length,
      unfinished_steps: task.steps.filter(s => !['finished', 'skipped', 'closed'].includes(s.state)).length,
      findings_in_current_plan: task.steps.reduce((n, s) => n + (Array.isArray(s.findings) ? s.findings.length : 0), 0),
      plans: task.plans.length, executions: task.executions.length, tests: task.tests.length,
      reviews: task.reviews.length, review_decisions: task.review_decisions.length, commits: task.commits.length },
    detail_request: followUpRequest(home, { detail: 'task', task_ref: task.task_id }) };
}
function presentStatus(view, input, options) {
  if (input.expected_view_revision && input.expected_view_revision !== view.view_revision)
    throw failure('QUERY_VIEW_CHANGED', 'The live view changed; restart the query. This is not a workflow gate.');
  if (options.detail === 'full') return view;
  const selected = input.task_ref ? view.selected_task : view.current_task;
  const detailRequest = selected ? followUpRequest(view.workflow_home, { detail: 'task', task_ref: selected.task_id }) : null;
  const counts = {};
  for (const task of view.tasks) counts[task.lifecycle] = (counts[task.lifecycle] ?? 0) + 1;
  const output = { ...base(), kind: 'task-query/v1', detail: options.detail, status: view.status,
    source_revision: view.source_revision, view_revision: view.view_revision, display_revision: view.display_revision, workflow_home: view.workflow_home,
    current_task_id: view.current_task_id,
    focus: view.focus, next_task_id: view.next_task_id, next_step_id: view.next_step_id,
    next_route: view.next_route, next_mode: view.next_mode, next_action: view.next_action,
    selection: { requested_task_ref: input.task_ref ?? null, task_id: selected?.task_id ?? null,
      status: selected ? 'resolved' : 'unresolved',
      detail_request: detailRequest },
    health: view.health, state_completeness: view.state_completeness, records_scanned: view.records_scanned,
    projection: view.projection, recovery_options: view.recovery_options,
    // Diagnostics are deliberately NOT paged or filtered to the selected task.
    issues: view.issues, unassociated_records: view.unassociated_records,
    task_count: view.tasks.length, lifecycle_counts: counts,
    coverage: { computation: 'full-journal-rebuild', diagnostics: 'all', history: 'not-expanded' },
    note: 'Presentation of the complete live rebuild. Omitted detail is not absent history, clean review or permission. Read record refs with read; use detail=full for the compatibility view.' };
  if (options.detail === 'summary') {
    const tasks = input.task_ref ? (selected ? [selected] : []) : view.tasks;
    const end = Math.min(options.offset + options.limit, tasks.length);
    return { ...output, tasks: tasks.slice(options.offset, end).map(task => taskSummary(task, view.workflow_home)),
      pagination: { total: tasks.length, offset: options.offset, limit: options.limit,
        next_offset: end < tasks.length ? end : null, view_revision: view.view_revision,
        next_request: end < tasks.length ? followUpRequest(view.workflow_home, { detail: 'summary', offset: end, limit: options.limit,
          expected_view_revision: view.view_revision,
          ...(input.task_ref ? { task_ref: input.task_ref } : {}) }) : null } };
  }
  if (options.detail === 'task') return { ...output,
    coverage: { ...output.coverage, history: 'selected-task' }, task: selected ?? null };
  // Never reinterpret a historical plan, ambiguous selector or unknown step as the current one.
  const matches = selected?.steps.filter(s => s.id === input.step_id) ?? [];
  const step = matches.length === 1 ? matches[0] : null;
  return { ...output,
    selection: { ...output.selection, requested_step_id: input.step_id,
      step_status: step ? 'resolved' : 'unresolved' },
    task: selected ? { task_id: selected.task_id, display_id: selected.display_id, lifecycle: selected.lifecycle,
      adopted_plan_ref: selected.adopted_plan_ref, legacy_plan_ref: selected.legacy_plan_ref } : null,
    coverage: { ...output.coverage, history: 'selected-step-projection-only' },
    step, review: step ? selected.reviews.find(r => r.ref === step.review_ref) ?? null : null,
    detail_request: detailRequest };
}
/** Agent-facing read APIs. The low-level taskStatus/context exports stay full for existing callers. */
export function queryStatus(root, input = {}) {
  const options = queryOptions(input);
  return presentStatus(taskStatus(root, input), input, options);
}
export function queryContext(root, input = {}) {
  const options = queryOptions(input), result = context(root, input);
  const management = presentStatus(result.management, input, options);
  if (options.detail === 'full') return result;
  return { ...base(), status: result.status, workflow_home: result.workflow_home,
    sources: result.sources, issues: result.issues, management,
    note: 'Task data occurs once under management. Use its detail requests or explicit find/read for evidence; navigation is not task state.' };
}

// Checkpoint inspection leaves project/Git state unchanged; blob reads use OS scratch files.
// The Skill owns authorized configuration, staging and commit; a manifest is not an approval token.
function checkpointGit(root, args, input, accepted = [0], stdout) {
  const result = spawnSync('git', args, {
    cwd: root, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', stdout ?? 'pipe', 'pipe'],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.error) throw result.error;
  if (!accepted.includes(result.status)) throw failure('GIT_READ_FAILED', (result.stderr?.toString() || result.stdout?.toString() || `Git exited ${result.status}`).trim());
  return result;
}
function checkpointBlob(root, oid, inspect) {
  // Keep the synchronous API without buffering whole Git blobs in process memory.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-checkpoint-blob-'));
  const file = path.join(directory, 'blob');
  let fd;
  try {
    fd = fs.openSync(file, 'wx', 0o600);
    checkpointGit(root, ['cat-file', 'blob', oid], undefined, [0], fd);
    fs.closeSync(fd); fd = undefined;
    return inspect(file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(file, { force: true });
    fs.rmdirSync(directory);
  }
}
function checkpointPath(root, value) {
  const relative = path.relative(path.resolve(root), repositoryPath(root, value)).split(path.sep).join('/');
  if (!relative) throw failure('EXACT_PATH_REQUIRED', 'Name a file, not the repository root.');
  return relative;
}
function checkpointTree(root, revision) {
  if (!revision) return new Map();
  const result = new Map();
  for (const line of checkpointGit(root, ['ls-tree', '-r', '-z', '--full-tree', revision]).stdout.split('\0').filter(Boolean)) {
    const at = line.indexOf('\t'), [mode, type, oid] = line.slice(0, at).split(' ');
    result.set(line.slice(at + 1), { mode, oid, type });
  }
  return result;
}
function checkpointIndex(root) {
  const entries = new Map(), unmerged = new Set();
  for (const line of checkpointGit(root, ['ls-files', '--stage', '-z']).stdout.split('\0').filter(Boolean)) {
    const at = line.indexOf('\t'), [mode, oid, stage] = line.slice(0, at).split(' '), ref = line.slice(at + 1);
    if (stage !== '0') unmerged.add(ref);
    else entries.set(ref, { mode, oid, type: mode === '160000' ? 'commit' : 'blob' });
  }
  return { entries, unmerged: [...unmerged] };
}
const checkpointEqual = (a, b) => a?.mode === b?.mode && a?.oid === b?.oid;
const checkpointDiff = (before, after) => [...new Set([...before.keys(), ...after.keys()])].filter(ref => !checkpointEqual(before.get(ref), after.get(ref))).sort();
const checkpointTreeDigest = entries => sha(JSON.stringify([...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([ref, e]) => [ref, e.mode, e.oid])));
function checkpointFile(root, ref, algorithm) {
  const fd = fs.openSync(local(root, ref), 'r');
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile()) throw failure('NOT_A_FILE', `Not a regular file: ${ref}`);
    const contentHash = createHash('sha256'), objectHash = createHash(algorithm).update(`blob ${before.size}\0`), buffer = Buffer.alloc(65536);
    let n;
    while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) { contentHash.update(buffer.subarray(0, n)); objectHash.update(buffer.subarray(0, n)); }
    const after = fs.fstatSync(fd), current = fs.lstatSync(local(root, ref));
    if (['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(k => before[k] !== after[k] || after[k] !== current[k]))
      throw failure('SOURCE_CHANGED', `File changed during checkpoint inspection: ${ref}`);
    return { sha256: contentHash.digest('hex'), raw_git_oid: objectHash.digest('hex'), size: before.size };
  } finally { fs.closeSync(fd); }
}
function checkpointIndexFile(root, entry) {
  if (entry.mode === '160000') return { mode: entry.mode, raw_git_oid: entry.oid, sha256: null, size: null };
  if (!['100644', '100755', '120000'].includes(entry.mode)) throw failure('UNSUPPORTED_GIT_ENTRY', `Unsupported Git mode: ${entry.mode}`);
  return checkpointBlob(root, entry.oid, file => ({ mode: entry.mode, raw_git_oid: entry.oid,
    sha256: hashFile(file), size: fs.statSync(file).size }));
}
function checkpointBusinessFile(root, ref, algorithm, entry, symlinks) {
  if (entry?.mode === '160000') throw failure('GITLINK_INDEX_SOURCE_REQUIRED', 'Review/stage the intended submodule pointer and re-plan with source=index; no submodule work is replayed.');
  const parent = local(root, path.posix.dirname(ref)), file = path.join(parent, path.posix.basename(ref));
  const before = fs.lstatSync(file);
  if (before.isSymbolicLink()) {
    const bytes = fs.readlinkSync(file, { encoding: 'buffer' }), after = fs.lstatSync(file);
    if (['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(k => before[k] !== after[k]))
      throw failure('SOURCE_CHANGED', `Link changed during checkpoint inspection: ${ref}`);
    return { mode: '120000', sha256: sha(bytes), size: bytes.length,
      raw_git_oid: createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest('hex') };
  }
  const metadata = checkpointFile(root, ref, algorithm);
  return entry?.mode === '120000' && !symlinks ? { ...metadata, mode: '120000' } : metadata;
}
function checkpointRole(ref, display) {
  if (ref === display) return 'display';
  if (ref === `${STORE}/.gitignore` || ref === `${STORE}/.gitattributes`) return 'configuration';
  if (new RegExp(`^${STORE.replaceAll('.', '\\.')}\/(events|attachments|task-labels)\/[^/]+\\.json$`).test(ref)
    || new RegExp(`^${STORE.replaceAll('.', '\\.')}\/evidence-objects\/[a-f0-9]{64}\\.blob$`).test(ref)
    || ref === `${STORE}/legacy/baseline.json` || new RegExp(`^${STORE.replaceAll('.', '\\.')}\/legacy\/current-[a-f0-9]{64}\\.md$`).test(ref)) return 'fact';
  if (new RegExp(`^${STORE.replaceAll('.', '\\.')}\/legacy\/display-(?:[a-f0-9]{64}|capture-[a-f0-9-]+)\\.md$`).test(ref)) return 'recovery';
  if (new RegExp(`^${STORE.replaceAll('.', '\\.')}\/archives\/[a-f0-9]{64}\/(?:manifest\\.json|index-[0-9]{6}\\.json|pack-[0-9]{6}\\.bin)$`).test(ref)) return 'archive';
  if (['.archive-staging', 'archive-quarantine', '.record-store-locks'].some(name => ref === `${STORE}/${name}` || ref.startsWith(`${STORE}/${name}/`))) return 'temporary';
  if (ref === `${STORE}/task-view.json` || ref.startsWith(`${STORE}/task-views/`)) return 'derived';
  if (ref.startsWith(`${STORE}/`) && (ref.endsWith('.tmp') || /^task-view.*\.lock$/.test(path.posix.basename(ref)))) return 'temporary';
  return 'unclassified';
}
function checkpointObjectPath(root, ref) {
  const target = checkpointPath(root, ref), directory = path.posix.dirname(target);
  const digest = /^([a-f0-9]{64})\.blob$/.exec(path.posix.basename(target))?.[1];
  if (!digest || path.posix.basename(directory) !== 'evidence-objects') return null;
  const home = path.posix.dirname(directory);
  return evidenceObjectPaths(digest, home).map(p => checkpointPath(root, p)).includes(target) ? target : null;
}
function checkpointVisitReferences(value, visit) {
  if (Array.isArray(value)) { for (const child of value) checkpointVisitReferences(child, visit); }
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'ref' || key.endsWith('_ref') || ['parents', 'execution_refs'].includes(key))
        for (const ref of Array.isArray(child) ? child : [child]) if (typeof ref === 'string') visit(ref, key === 'ref' ? value : null);
      checkpointVisitReferences(child, visit);
    }
  }
}
const checkpointFixedRecord = ref => /^\.workflow-system\/records\/(?:events\/[^/]+\.json|attachments\/[^/]+\.json|legacy\/current-[a-f0-9]{64}\.md)$/.test(ref);
function checkpointInventory(root, display, business = []) {
  const files = new Map(), issues = [], pending = [STORE];
  while (pending.length) {
    const ref = pending.pop();
    try {
      const file = local(root, ref), stat = fs.lstatSync(file);
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(file).sort().reverse()) pending.push(`${ref}/${entry}`);
      } else if (stat.isFile()) files.set(ref, checkpointRole(ref, display));
      else issues.push({ code: 'UNSUPPORTED_RECORD_ENTRY', path: ref });
    } catch (error) { if (error.code !== 'ENOENT') issues.push({ ...issue(error), path: ref }); }
  }
  let archives = { archives: [], records: [], quarantined: [] };
  try { archives = archiveInventory(root, { verify: true }); }
  catch (error) { issues.push({ ...issue(error), code: error.code ?? 'ARCHIVE_INVALID', path: `${STORE}/archives` }); }
  const archived = new Map(archives.records.map(record => [record.ref, record]));
  const logicalFiles = new Map(files);
  for (const ref of archived.keys()) logicalFiles.set(ref, checkpointRole(ref, display));
  // Follow verified typed refs, not arbitrary report text or a scan of the old workflow home.
  const objects = new Set(), referenceIssues = [];
  function includeObject(ref, from) {
    try {
      const target = checkpointObjectPath(root, ref);
      if (!target) { referenceIssues.push({ code: 'ATTACHMENT_OBJECT_REF_UNSUPPORTED', from, path: ref }); return; }
      objects.add(target);
      if (archived.has(target)) { logicalFiles.set(target, 'fact'); return; }
      const stat = fs.lstatSync(local(root, target));
      if (!stat.isFile()) throw failure('NOT_A_FILE', `Not a regular preserved object: ${target}`);
      files.set(target, 'fact'); logicalFiles.set(target, 'fact');
    } catch (error) { if (error.code !== 'ENOENT') referenceIssues.push({ ...issue(error), from, path: ref }); }
  }
  for (const [ref, role] of logicalFiles) {
    if (role !== 'fact' || !ref.endsWith('.json')) continue;
    try {
      const value = JSON.parse(storeReadFile(root, ref).toString('utf8'));
      if (ref.startsWith(`${STORE}/attachments/`)) {
        for (const attachment of Array.isArray(value.attachments) ? value.attachments : [])
          if (attachment.status !== 'unavailable' && attachment.ref
            && !(attachment.kind === 'fixed-evidence-reference/v1' && checkpointFixedRecord(attachment.ref))) includeObject(attachment.ref, ref);
      } else if (ref.startsWith(`${STORE}/events/`)) {
        const decoded = decodeObservation(value);
        checkpointVisitReferences(decoded.payload.kind === 'task-event' ? decoded.payload.task_event?.data : null, target => {
          if (/(?:^|\/)evidence-objects\/[a-f0-9]{64}\.blob$/.test(target)) includeObject(target, ref);
        });
      }
    } catch { /* The reference check reports unreadable manifests without discarding their bytes. */ }
  }
  for (const ref of business) if (checkpointObjectPath(root, ref)) includeObject(ref, null);
  for (const directory of new Set([...objects].map(ref => path.posix.dirname(ref)))) {
    const ref = `${directory}/.gitattributes`;
    try { if (fs.lstatSync(local(root, ref)).isFile()) files.set(ref, 'configuration'); }
    catch (error) { if (error.code !== 'ENOENT') issues.push({ ...issue(error), path: ref }); }
  }
  return { files, logicalFiles, archived, archives: archives.archives, quarantined: archives.quarantined ?? [],
    issues, evidence_objects: objects, reference_issues: [...referenceIssues, ...issues.filter(i => i.path === `${STORE}/archives`)] };
}
function checkpointAttributes(root, refs, cached = false) {
  if (!refs.length) return new Map();
  const attrs = ['text', 'filter', 'ident', 'working-tree-encoding'];
  const values = checkpointGit(root, ['check-attr', ...(cached ? ['--cached'] : []), '-z', '--stdin', ...attrs], refs.join('\0') + '\0').stdout.split('\0');
  const result = new Map();
  for (let i = 0; i + 2 < values.length; i += 3) {
    const row = result.get(values[i]) ?? {}; row[values[i + 1]] = values[i + 2]; result.set(values[i], row);
  }
  return result;
}
function checkpointPolicy(root, home, generatedDisplay, evidenceObjects = []) {
  const legacyDirectories = [...new Set(evidenceObjects.filter(ref => !ref.startsWith(`${STORE}/`))
    .map(ref => path.posix.dirname(ref)))].sort();
  const oldIgnore = '/task-view.json\n/task-views/\n/task-view*.lock\n**/*.tmp\n';
  const definitions = [
    [`${STORE}/.gitignore`, `${oldIgnore}/.archive-staging/\n/archive-quarantine/\n/.record-store-locks/\n`],
    [`${STORE}/.gitattributes`, '** -text -filter -ident -working-tree-encoding\n'],
    ...legacyDirectories.map(directory => [`${directory}/.gitattributes`, '*.blob -text -filter -ident -working-tree-encoding\n']),
    ...(generatedDisplay ? [[`${home}/.gitignore`, '/CURRENT_TASK.md\n']] : []),
  ];
  const edits = [], paths = [], issues = [];
  for (const [ref, body] of definitions) {
    paths.push(ref);
    const begin = '# BEGIN vNext checkpoint Git policy', end = '# END vNext checkpoint Git policy';
    let bytes = null;
    try { bytes = fs.readFileSync(local(root, ref)); } catch (error) { if (error.code !== 'ENOENT') { issues.push({ ...issue(error), path: ref }); continue; } }
    let text;
    try { text = bytes === null ? '' : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { issues.push({ code: 'POLICY_ENCODING_UNSUPPORTED', path: ref }); continue; }
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const block = `${begin}\n${body}${end}\n`.replaceAll('\n', newline);
    if (text.includes(begin) || text.includes(end)) {
      const prior = `${begin}\n${oldIgnore}${end}\n`.replaceAll('\n', newline);
      if (ref === `${STORE}/.gitignore` && text.includes(prior) && text.split(begin).length === 2 && text.split(end).length === 2
        && !/@frozen|DO NOT MODIFY/i.test(text)) {
        edits.push({ path: ref, before_sha256: sha(bytes), content: text.replace(prior, block),
          existing_content_retained: true, project_policy_review: true });
        continue;
      }
      if (!text.includes(block) || text.split(begin).length !== 2 || text.split(end).length !== 2)
        issues.push({ code: 'POLICY_BLOCK_EDITED', path: ref, message: 'Keep project customizations; reconcile the policy explicitly, do not overwrite it.' });
      continue;
    }
    if (/@frozen|DO NOT MODIFY/i.test(text)) { issues.push({ code: 'POLICY_FILE_FROZEN', path: ref }); continue; }
    edits.push({ path: ref, before_sha256: bytes === null ? null : sha(bytes),
      content: text + (text && !text.endsWith('\n') ? newline : '') + block,
      existing_content_retained: true, project_policy_review: bytes !== null });
  }
  return { edits, paths, issues };
}
function checkpointReferences(root, inventory, selected, read = ref => storeReadFile(root, ref)) {
  const issues = [...inventory.reference_issues], check = (ref, from, attachment = false, taskData = false, fixed = false) => {
    if (typeof ref !== 'string') return;
    if (!attachment && !ref.startsWith(`${STORE}/`)
      && !(taskData && /(?:^|\/)evidence-objects\/[a-f0-9]{64}\.blob$/.test(ref))) return;
    try {
      const object = checkpointObjectPath(root, ref);
      if (!attachment && !ref.startsWith(`${STORE}/`) && !object) return;
      const target = checkpointPath(root, ref);
      if (attachment && !object && !(fixed && checkpointFixedRecord(target))) {
        issues.push({ code: 'ATTACHMENT_OBJECT_REF_UNSUPPORTED', from, path: target }); return;
      }
      if (!(inventory.logicalFiles ?? inventory.files).has(target)) issues.push({ code: 'REFERENCE_MISSING', from, path: target });
      else if (!selected.has(target)) issues.push({ code: 'REFERENCE_NOT_SELECTED', from, path: target });
      if (object && selected.has(target) && selected.get(target)?.sha256 !== /\/([a-f0-9]{64})\.blob$/.exec(target)?.[1])
        issues.push({ code: 'PRESERVED_DIGEST_MISMATCH', from, path: target });
      return target;
    } catch (error) { issues.push({ ...issue(error), from, path: ref }); }
  };
  for (const [ref, role] of inventory.logicalFiles ?? inventory.files) {
    if (role !== 'fact') continue;
    try {
      if (!ref.endsWith('.json')) {
        // Blobs and legacy Markdown are checked by their byte-addressed names, not parsed as JSON.
        const named = /\/([a-f0-9]{64})\.blob$/.exec(ref)?.[1] ?? /\/legacy\/(?:current|display)-([a-f0-9]{64})\.md$/.exec(ref)?.[1];
        if (named && selected.has(ref) && selected.get(ref)?.sha256 !== named)
          issues.push({ code: 'PRESERVED_DIGEST_MISMATCH', path: ref });
        continue;
      }
      const value = JSON.parse(read(ref).toString('utf8'));
      if (ref.startsWith(`${STORE}/events/`)) {
        // The wire digest and codec version must be valid before data pointers are
        // interpreted. The same check runs against actual index/commit blob bytes.
        const { payload } = decodeObservation(value);
        checkpointVisitReferences(payload, target => check(target, ref));
        checkpointVisitReferences(payload.kind === 'task-event' ? payload.task_event?.data : null, (target, reference) => {
          const checked = check(target, ref, false, true), object = checked && checkpointObjectPath(root, checked) && selected.get(checked);
          if (object && reference && ((reference.sha256 !== undefined && reference.sha256 !== object.sha256)
            || (reference.size !== undefined && reference.size !== object.size)))
            issues.push({ code: 'REFERENCE_METADATA_MISMATCH', from: ref, path: checked });
        });
        if ((Array.isArray(payload?.files) && payload.files.length)
          || (payload.evidence_refs !== undefined && (!Array.isArray(payload.evidence_refs) || payload.evidence_refs.length)))
          check(`${STORE}/attachments/${path.posix.basename(ref)}`, ref);
      } else if (ref.startsWith(`${STORE}/attachments/`)) {
        check(value.event_ref, ref);
        for (const attachment of Array.isArray(value.attachments) ? value.attachments : []) {
          if (attachment.status === 'unavailable') issues.push({ code: 'RETAINED_ATTACHMENT_UNAVAILABLE', path: ref, request: attachment.request });
          else {
            const target = check(attachment.ref, ref, true, false, attachment.kind === 'fixed-evidence-reference/v1');
            if (!attachment.ref) issues.push({ code: 'ATTACHMENT_REF_MISSING', path: ref });
            const object = selected.get(target);
            const digest = typeof target === 'string' ? /\/([a-f0-9]{64})\.blob$/.exec(target)?.[1] : null;
            if (object && digest && object.sha256 !== digest) issues.push({ code: 'PRESERVED_DIGEST_MISMATCH', from: ref, path: target });
            if (object && (attachment.sha256 !== object.sha256 || (attachment.size !== undefined && attachment.size !== object.size)))
              issues.push({ code: 'ATTACHMENT_METADATA_MISMATCH', path: ref, object_ref: attachment.ref });
          }
        }
      } else if (ref === `${STORE}/legacy/baseline.json`) {
        check(value.ref, ref);
        const original = selected.get(value.ref);
        if (original && value.sha256 !== original.sha256) issues.push({ code: 'BASELINE_DIGEST_MISMATCH', path: ref });
      }
    } catch (error) { issues.push({ code: error.code ?? 'RETAINED_RECORD_UNREADABLE', path: ref, message: error.message }); }
  }
  return issues;
}
function checkpointSelectedRecords(inventory, files, excluded = () => false) {
  const selected = new Map(files.map(file => [file.path, file]));
  const complete = new Set(inventory.archives.filter(archive => archive.physical_files.every(file =>
    selected.get(file.ref)?.sha256 === file.sha256 && selected.get(file.ref)?.size === file.size)).map(archive => archive.id));
  for (const record of inventory.archived.values()) if (!selected.has(record.ref) && !excluded(record.ref) && complete.has(record.archiveId))
    selected.set(record.ref, { ...record, role: 'fact', storage: 'archive' });
  return selected;
}
function checkpointStoredReferences(root, plan, target, isCommit) {
  const issues = [], objects = new Map(), archivePaths = [], directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vnext-checkpoint-archives-'));
  let archives = { archives: [], records: [] };
  try {
    // Validate actual Git blobs in an isolated root. Worktree indexes/caches and loose
    // copies must never stand in for missing, transformed or corrupt committed packs.
    for (const [ref, entry] of target) if (checkpointRole(ref, '') === 'archive') {
      archivePaths.push(ref);
      if (!['100644', '100755'].includes(entry.mode)) {
        issues.push({ code: 'STORED_MODE_DIFFERS', path: ref, actual: entry.mode }); continue;
      }
      const file = local(directory, ref); fs.mkdirSync(path.dirname(file), { recursive: true });
      const fd = fs.openSync(file, 'wx', 0o600);
      try { checkpointGit(root, ['cat-file', 'blob', entry.oid], undefined, [0], fd); }
      finally { fs.closeSync(fd); }
    }
    try { archives = archiveInventory(directory, { verify: true }); }
    catch (error) { issues.push({ ...issue(error), path: `${STORE}/archives`, storage: isCommit ? 'commit' : 'index' }); }
    const archived = new Map(archives.records.map(record => [record.ref, record]));
    const logicalFiles = new Map([...target.keys()].map(ref => [ref, checkpointRole(ref, '')]));
    for (const ref of archived.keys()) logicalFiles.set(ref, checkpointRole(ref, ''));
    const metadata = ref => {
      if (objects.has(ref)) return objects.get(ref);
      const entry = target.get(ref);
      if (!entry) return archived.get(ref);
      if (!['100644', '100755'].includes(entry.mode)) throw failure('STORED_MODE_DIFFERS', `Expected regular preserved bytes: ${ref}`);
      const value = checkpointIndexFile(root, entry); objects.set(ref, value); return value;
    };
    for (const [ref, record] of archived) if (target.has(ref)) {
      try {
        const loose = metadata(ref);
        if (loose.sha256 !== record.sha256 || loose.size !== record.size)
          issues.push({ code: 'LOGICAL_RECORD_CONFLICT', path: ref, storage: isCommit ? 'commit' : 'index' });
      } catch (error) { issues.push({ ...issue(error), path: ref }); }
    }
    const selected = { has: ref => target.has(ref) || archived.has(ref), get: metadata };
    const read = ref => {
      const entry = target.get(ref);
      if (!entry) return storeReadFile(directory, ref);
      metadata(ref);
      return checkpointBlob(root, entry.oid, blob => fs.readFileSync(blob));
    };
    issues.push(...checkpointReferences(root, { files: logicalFiles, logicalFiles, reference_issues: [] }, selected, read));
    if (!isCommit) for (const [ref, row] of checkpointAttributes(root,
      [...new Set([...archivePaths, ...objects.keys()].filter(ref => checkpointRole(ref, '') === 'archive' || checkpointObjectPath(root, ref)))], true)) {
      if (row.text !== 'unset' || ['filter', 'ident', 'working-tree-encoding'].some(k => !['unset', 'unspecified'].includes(row[k])))
        issues.push({ code: 'INDEX_BYTE_ATTRIBUTES_UNSAFE', path: ref, attributes: row });
    }
    return { issues, archived, archives: archives.archives };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
/** Project checkpoint inventory and actual Git verification; never stages, commits or deletes. */
export function gitCheckpoint(root, input = {}) {
  const action = input.action ?? 'plan';
  if (!['plan', 'verify-index', 'verify-commit'].includes(action)) throw failure('INVALID_CHECKPOINT_ACTION', action);
  const top = checkpointGit(root, ['rev-parse', '--show-toplevel']).stdout.trim();
  if (path.resolve(top) !== path.resolve(root)) throw failure('CHECKPOINT_ROOT_MISMATCH', 'Use the exact Git worktree root.');
  const algorithm = checkpointGit(root, ['rev-parse', '--show-object-format']).stdout.trim();
  if (!['sha1', 'sha256'].includes(algorithm)) throw failure('UNSUPPORTED_GIT_OBJECT_FORMAT', algorithm);
  const headResult = checkpointGit(root, ['rev-parse', '--verify', '-q', 'HEAD'], undefined, [0, 1]);
  const head = headResult.status === 0 ? headResult.stdout.trim() : null;
  if (action !== 'plan') return verifyCheckpoint(root, input, head, algorithm);
  const mode = input.mode ?? 'checkpoint';
  if (!['checkpoint', 'paths'].includes(mode)) throw failure('INVALID_CHECKPOINT_MODE', mode);
  const source = input.source ?? 'worktree';
  if (!['worktree', 'index'].includes(source)) throw failure('INVALID_CHECKPOINT_SOURCE', 'source must be worktree or index; it selects the business content, not authority.');
  const exactPaths = values => {
    if (!Array.isArray(values) || values.some(v => typeof v !== 'string')) throw failure('EXACT_PATHS_REQUIRED', 'Use an array of exact file paths, not a glob or directory.');
    return [...new Set(values.map(v => checkpointPath(root, v)))].sort();
  };
  const business = exactPaths(input.business_paths ?? []), exclusions = exactPaths(input.exclude_paths ?? []);
  // A selected link's own value is supported; a linked ancestor must not turn a
  // worktree path into an alias for another scope. Index sources need no traversal.
  if (source === 'worktree') for (const ref of business) local(root, path.posix.dirname(ref));
  const excluded = ref => exclusions.some(p => ref === p || ref.startsWith(`${p}/`));
  const { home, issues: homeIssues } = workflowHome(root, input.workflow_home), display = `${home}/CURRENT_TASK.md`;
  let generatedDisplay = false, displayHasMarker = false;
  try {
    const published = readTaskDisplay(root, display, { local });
    displayHasMarker = published.managed;
    generatedDisplay = published.verified;
  } catch (error) { if (error.code !== 'ENOENT') homeIssues.push({ ...issue(error), path: display }); }
  const inventory = checkpointInventory(root, display, source === 'worktree' ? business : []), before = checkpointTree(root, head), index = checkpointIndex(root);
  const symlinks = checkpointGit(root, ['config', '--bool', 'core.symlinks'], undefined, [0, 1]).stdout.trim() !== 'false';
  const archivesById = new Map(inventory.archives.map(archive => [archive.id, archive]));
  const quarantineByRef = new Map(inventory.quarantined.map(record => [record.ref, record]));
  const excludedArchiveIds = new Set([...inventory.archived.values()].filter(record => excluded(record.ref)).map(record => record.archiveId));
  const blockedArchives = inventory.archives.filter(archive => excludedArchiveIds.has(archive.id));
  const blockedArchivePaths = new Set(blockedArchives.flatMap(archive => archive.physical_files.map(file => file.ref)));
  const selected = new Set(business.filter(ref => !excluded(ref) && !blockedArchivePaths.has(ref)));
  const files = [], deletions = [], archiveMigrations = [];
  const omitted = [], problems = [...homeIssues, ...inventory.issues], policy = mode === 'checkpoint'
    ? checkpointPolicy(root, home, generatedDisplay, [...inventory.evidence_objects].filter(ref => inventory.files.has(ref) && !excluded(ref)))
    : { edits: [], paths: [], issues: [] };
  if (mode === 'checkpoint') {
    for (const [ref, role] of inventory.files) {
      if (['fact', 'recovery', 'archive', 'configuration'].includes(role) && !excluded(ref) && !blockedArchivePaths.has(ref)) selected.add(ref);
      else omitted.push({ path: ref, role, reason: excluded(ref) || blockedArchivePaths.has(ref) ? 'user-excluded' : ['derived', 'temporary'].includes(role) ? 'local-generated' : 'classification-required' });
    }
    for (const ref of policy.paths) if (!excluded(ref) && fs.existsSync(local(root, ref))) selected.add(ref);
    const selectedArchives = new Set(inventory.archives.filter(archive => archive.physical_files.every(file => selected.has(file.ref))).map(archive => archive.id));
    for (const ref of new Set([...before.keys(), ...index.entries.keys()])) {
      const role = checkpointRole(ref, display);
      if (!['fact', 'recovery', 'archive'].includes(role) || inventory.files.has(ref)) continue;
      const proof = quarantineByRef.get(ref), archived = inventory.archived.get(ref);
      const archive = archived && archivesById.get(archived.archiveId);
      if (role === 'fact' && proof && archived && archive && !excluded(ref)
        && proof.sha256 === archived.sha256 && proof.size === archived.size
        && selectedArchives.has(archived.archiveId)) {
        try {
          for (const entry of [before.get(ref), index.entries.get(ref)].filter(Boolean)) {
            if (!['100644', '100755'].includes(entry.mode)) throw failure('UNSUPPORTED_PERSISTENT_ENTRY', `Cannot migrate non-regular entry: ${ref}`);
            const actual = checkpointIndexFile(root, entry);
            if (actual.sha256 !== archived.sha256 || actual.size !== archived.size)
              throw failure('ARCHIVE_MIGRATION_BYTES_DIFFER', `Tracked/staged original differs from the verified archive: ${ref}`);
          }
          deletions.push(ref);
          archiveMigrations.push({ path: ref, sha256: archived.sha256, size: archived.size, archiveId: archived.archiveId });
          continue;
        } catch (error) { problems.push({ ...issue(error), path: ref }); }
      }
      problems.push({ code: 'PERSISTENT_FILE_MISSING', path: ref, message: 'Do not silently stage this deletion as checkpoint cleanup; an archive copy alone is not explicit quarantine proof.' });
    }
    for (const registry of ['FREEZE_REGISTRY.md', '.workflow-system/FREEZE_REGISTRY.md'])
      if (fs.existsSync(local(root, registry)) && policy.edits.length) problems.push({ code: 'FREEZE_POLICY_REVIEW', path: registry });
  }
  for (const archive of blockedArchives) problems.push({ code: 'ARCHIVE_SCOPE_EXCLUSION', path: archive.manifestRef,
    message: 'This archive contains an excluded logical record; its indivisible backing files were not selected.' });
  const configuration = policy.edits.filter(e => !excluded(e.path));
  for (const e of policy.edits.filter(e => excluded(e.path))) omitted.push({ path: e.path, role: 'configuration', reason: 'user-excluded' });
  problems.push(...policy.issues);
  if (mode === 'checkpoint' && displayHasMarker && !generatedDisplay)
    problems.push({ code: 'DISPLAY_DRIFT_RETAINED', path: display, message: 'No matching saved generated view. Keep the file and resolve/preserve its content; do not newly ignore or untrack it.' });
  for (const ref of [...selected].sort()) {
    const fileSource = source === 'index' && business.includes(ref) ? 'index' : 'worktree';
    const object = checkpointObjectPath(root, ref), byteExact = ref.startsWith(`${STORE}/`) || !!object;
    let role = inventory.files.get(ref);
    if (!role) {
      if (object) role = 'fact';
      else if (policy.paths.includes(ref)) role = 'configuration';
      else role = 'business';
    }
    try {
      let metadata;
      if (fileSource === 'index') {
        const entry = index.entries.get(ref);
        if (!entry) {
          if (before.has(ref)) { deletions.push(ref); continue; }
          throw failure('INDEX_PATH_NOT_FOUND', `No selected index or HEAD entry: ${ref}`);
        }
        if (byteExact && !['100644', '100755'].includes(entry.mode)) throw failure('UNSUPPORTED_PERSISTENT_ENTRY', `Preserved records require regular blobs: ${ref}`);
        metadata = checkpointIndexFile(root, entry);
      } else if (role === 'business') metadata = checkpointBusinessFile(root, ref, algorithm, index.entries.get(ref), symlinks);
      else metadata = checkpointFile(root, ref, algorithm);
      files.push({ path: ref, role, source: fileSource, byte_exact: byteExact, ...metadata });
    } catch (error) {
      if (error.code === 'ENOENT' && business.includes(ref) && before.has(ref) && mode === 'paths') deletions.push(ref);
      else if (error.code === 'ENOENT' && business.includes(ref) && before.has(ref) && !ref.startsWith(`${STORE}/`)) deletions.push(ref);
      else problems.push({ ...issue(error), path: ref });
    }
  }
  const untrack = [], untrackFiles = [], trackedDerived = [];
  if (mode === 'checkpoint') for (const ref of new Set([...before.keys(), ...index.entries.keys()])) {
    const role = checkpointRole(ref, display);
    if (!(['derived', 'temporary'].includes(role) || (role === 'display' && generatedDisplay)) || selected.has(ref) || excluded(ref)) continue;
    trackedDerived.push(ref);
    if (input.untrack_derived === true) {
      if (!checkpointEqual(before.get(ref), index.entries.get(ref)) || index.unmerged.includes(ref)) {
        problems.push({ code: 'STAGED_DERIVED_CHANGE', path: ref, message: 'Retain staged work until the user selects its disposition.' });
      } else {
        untrack.push(ref);
        try { untrackFiles.push({ path: ref, ...checkpointFile(root, ref, algorithm) }); }
        catch (error) { if (error.code !== 'ENOENT') problems.push({ ...issue(error), path: ref }); }
      }
    }
  }
  const indexChanges = checkpointDiff(before, index.entries), chosen = new Set([...files.map(f => f.path), ...deletions, ...untrack]);
  const outside = indexChanges.filter(ref => !chosen.has(ref));
  if (outside.length) problems.push({ code: 'STAGED_OUTSIDE_SCOPE', paths: outside, message: 'Preserve the existing index; do not reset or include unrelated staged changes.' });
  if (index.unmerged.length) problems.push({ code: 'UNMERGED_INDEX', paths: index.unmerged });
  const worktreeFiles = files.filter(f => f.source === 'worktree');
  const ignored = worktreeFiles.length ? new Set(checkpointGit(root, ['check-ignore', '-z', '--stdin'], worktreeFiles.map(f => f.path).join('\0') + '\0', [0, 1]).stdout.split('\0').filter(Boolean)) : new Set();
  for (const ref of ignored) problems.push({ code: 'SELECTED_PATH_IGNORED', path: ref, message: 'Do not force-add or override project exclusions without the actual user choice.' });
  const attrs = checkpointAttributes(root, worktreeFiles.filter(f => f.byte_exact).map(f => f.path));
  const indexAttrs = checkpointAttributes(root, files.filter(f => f.byte_exact && f.source === 'index').map(f => f.path), true);
  for (const f of files) {
    if (['fact', 'archive'].includes(f.role) && before.has(f.path) && before.get(f.path).oid !== f.raw_git_oid)
      problems.push({ code: 'TRACKED_FACT_CHANGED', path: f.path, message: 'Inspect the immutable-history change; do not silently overwrite it during a checkpoint.' });
    const attributes = (f.source === 'index' ? indexAttrs : attrs).get(f.path);
    if (f.byte_exact && Object.values(attributes ?? {}).some(v => !['unset', 'unspecified'].includes(v)))
      problems.push({ code: 'BYTE_ATTRIBUTE_REVIEW', path: f.path, attributes });
    if (f.source !== 'index' && indexChanges.includes(f.path) && index.entries.has(f.path) && index.entries.get(f.path).oid !== f.raw_git_oid)
      problems.push({ code: 'PRESTAGED_CONTENT_DIFFERS', path: f.path, message: 'Inspect staged hunks/normalization; do not silently replace a partial stage.' });
  }
  const selectedRecords = checkpointSelectedRecords(inventory, files, excluded);
  const referenceIssues = mode === 'checkpoint' || files.some(file => file.role === 'archive')
    ? checkpointReferences(root, inventory, selectedRecords) : [];
  for (const archive of inventory.archives) if (archive.physical_files.some(file => selectedRecords.has(file.ref)))
    for (const file of archive.physical_files) {
      const selectedFile = selectedRecords.get(file.ref);
      if (!selectedFile) referenceIssues.push({ code: 'REFERENCE_NOT_SELECTED', from: archive.manifestRef, path: file.ref });
      else if (selectedFile.sha256 !== file.sha256 || selectedFile.size !== file.size)
        referenceIssues.push({ code: 'ARCHIVE_SELECTED_BYTES_DIFFER', from: archive.manifestRef, path: file.ref });
    }
  for (const f of files) {
    const named = /\/([a-f0-9]{64})\.blob$/.exec(f.path)?.[1] ?? /\/legacy\/(?:current|display)-([a-f0-9]{64})\.md$/.exec(f.path)?.[1];
    if (named && f.mode !== '160000' && named !== f.sha256) referenceIssues.push({ code: 'PRESERVED_DIGEST_MISMATCH', path: f.path });
  }
  const addPaths = files.filter(f => f.source !== 'index' && (!index.entries.has(f.path) || index.entries.get(f.path).oid !== f.raw_git_oid || f.role === 'business')).map(f => f.path);
  const migratedPaths = new Set(archiveMigrations.map(migration => migration.path));
  const plan = { kind: 'git-checkpoint-plan/v1', root: path.resolve(root), base_head: head, object_format: algorithm, mode, source,
    workflow_home: home, business_paths: business, exclude_paths: exclusions, files, delete_paths: deletions, archive_migrations: archiveMigrations,
    add_paths: [...new Set([...addPaths, ...deletions.filter(ref => migratedPaths.has(ref)
      ? index.entries.has(ref) : source === 'worktree')])].sort(), untrack_paths: untrack.sort(), untrack_files: untrackFiles,
    configuration, tracked_derived_retained: trackedDerived.filter(p => !untrack.includes(p)), omitted,
    issues: problems, reference_issues: referenceIssues };
  return { ...base(), status: 'planned', ...plan,
    counts: { selected: files.length, facts: files.filter(f => f.role === 'fact').length, recovery: files.filter(f => f.role === 'recovery').length,
      archives: files.filter(f => f.role === 'archive').length, archived_records: [...selectedRecords.values()].filter(f => f.storage === 'archive').length,
      add: plan.add_paths.length, untrack: untrack.length, omitted: omitted.length },
    note: 'Project-wide records are candidates under the Skill checkpoint policy, not permission. Apply authorized configuration, re-plan, review the index, then verify. Reference gaps do not prohibit preserving existing bytes. Keep this plan in an OS temporary file, not in records.' };
}
function verifyCheckpoint(root, input, head, algorithm) {
  const plan = input.plan;
  if (plan?.kind !== 'git-checkpoint-plan/v1' || !Array.isArray(plan.files) || !Array.isArray(plan.add_paths) || !Array.isArray(plan.delete_paths) || !Array.isArray(plan.untrack_paths)
    || path.resolve(plan.root ?? '') !== path.resolve(root) || plan.object_format !== algorithm
    || (plan.base_head !== null && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(plan.base_head ?? '')))
    throw failure('INVALID_CHECKPOINT_PLAN', 'Use the plan from this worktree; a plan is data, not authority.');
  const normalize = ref => checkpointPath(root, ref);
  for (const f of plan.files) {
    normalize(f.path);
    const gitlink = f.mode === '160000' && f.source === 'index' && f.role === 'business' && !f.byte_exact;
    const persistent = f.byte_exact || f.path.startsWith(`${STORE}/`) || !!checkpointObjectPath(root, f.path);
    if ((!gitlink && !/^[a-f0-9]{64}$/.test(f.sha256)) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(f.raw_git_oid)
      || (f.source !== undefined && !['worktree', 'index'].includes(f.source))
      || (f.mode !== undefined && !['100644', '100755', '120000', '160000'].includes(f.mode))
      || (persistent && f.mode !== undefined && !['100644', '100755'].includes(f.mode))
      || (f.mode === '160000' && !gitlink)) throw failure('INVALID_CHECKPOINT_PLAN', 'Invalid file digest, source or Git mode.');
  }
  const plannedDeletions = new Set(plan.delete_paths);
  if (plan.archive_migrations !== undefined && (!Array.isArray(plan.archive_migrations) || plan.archive_migrations.some(migration =>
    !migration || checkpointRole(normalize(migration.path), '') !== 'fact' || !/^[a-f0-9]{64}$/.test(migration.sha256 ?? '')
    || !/^[a-f0-9]{64}$/.test(migration.archiveId ?? '') || !Number.isSafeInteger(migration.size) || migration.size < 0
    || !plannedDeletions.has(migration.path)))) throw failure('INVALID_CHECKPOINT_PLAN', 'Invalid verified archive migration.');
  const allowed = new Set([...plan.files.map(f => f.path), ...plan.delete_paths.map(normalize), ...plan.untrack_paths.map(normalize)]);
  const problems = [], referenceIssues = [...(plan.reference_issues ?? [])], isCommit = input.action === 'verify-commit';
  const objectPaths = new Set(plan.files.filter(f => checkpointObjectPath(root, f.path)).map(f => f.path));
  const byteExactFiles = plan.files.filter(f => f.byte_exact || objectPaths.has(f.path));
  const symlinks = checkpointGit(root, ['config', '--bool', 'core.symlinks'], undefined, [0, 1]).stdout.trim() !== 'false';
  function storageIssue(problem) {
    problems.push(problem);
    if (objectPaths.has(problem.path) || checkpointRole(problem.path ?? '', '') === 'archive') referenceIssues.push(problem);
  }
  if (plan.configuration?.length) problems.push({ code: 'CONFIGURATION_PENDING', message: 'Apply only authorized policy edits and re-plan before staging.' });
  let target, commit = null;
  if (isCommit) {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(input.commit_sha ?? '')) throw failure('COMMIT_SHA_REQUIRED', 'Pass the actual full commit SHA.');
    commit = checkpointGit(root, ['rev-parse', '--verify', `${input.commit_sha}^{commit}`]).stdout.trim();
    const parents = checkpointGit(root, ['rev-list', '--parents', '-n', '1', commit]).stdout.trim().split(' ').slice(1);
    if (parents.length !== (plan.base_head ? 1 : 0) || (plan.base_head && parents[0] !== plan.base_head)) problems.push({ code: 'COMMIT_BASE_DIFFERS', expected: plan.base_head, actual: parents });
    target = checkpointTree(root, commit);
  } else {
    if (head !== plan.base_head) problems.push({ code: 'HEAD_CHANGED', expected: plan.base_head, actual: head });
    const index = checkpointIndex(root); target = index.entries;
    if (index.unmerged.length) problems.push({ code: 'UNMERGED_INDEX', paths: index.unmerged });
  }
  if (!isCommit) {
    const attrs = checkpointAttributes(root, byteExactFiles.map(f => f.path), true);
    for (const [ref, row] of attrs) if (row.text !== 'unset' || ['filter', 'ident', 'working-tree-encoding'].some(k => !['unset', 'unspecified'].includes(row[k])))
      storageIssue({ code: 'INDEX_BYTE_ATTRIBUTES_UNSAFE', path: ref, attributes: row });
  }
  const outside = checkpointDiff(checkpointTree(root, plan.base_head), target).filter(ref => !allowed.has(ref));
  if (outside.length) problems.push({ code: 'OUTSIDE_SCOPE', paths: outside });
  for (const f of plan.files) {
    const stored = target.get(f.path);
    const modes = f.mode ? [f.mode] : ['100644', '100755'];
    if (!stored) storageIssue({ code: 'PLANNED_FILE_NOT_SAVED', path: f.path });
    else {
      if (!modes.includes(stored.mode)) storageIssue({ code: 'STORED_MODE_DIFFERS', path: f.path, expected: modes, actual: stored.mode });
      if ((f.source === 'index' || f.mode === '120000' || f.byte_exact || objectPaths.has(f.path)) && stored.oid !== f.raw_git_oid)
        storageIssue({ code: f.mode === '160000' ? 'STORED_GITLINK_DIFFERS' : 'STORED_BYTES_DIFFER', path: f.path, expected: f.raw_git_oid, actual: stored.oid });
    }
    if (!isCommit && f.source !== 'index') {
      try {
        const current = f.role === 'business' ? checkpointBusinessFile(root, f.path, algorithm, f.mode ? { mode: f.mode } : null, symlinks) : checkpointFile(root, f.path, algorithm);
        if (current.sha256 !== f.sha256 || current.mode !== f.mode)
          problems.push({ code: 'SOURCE_CHANGED_SINCE_PLAN', path: f.path });
      }
      catch (error) { problems.push({ ...issue(error), path: f.path }); }
    }
  }
  for (const ref of [...plan.delete_paths, ...plan.untrack_paths]) if (target.has(ref)) problems.push({ code: 'PLANNED_INDEX_REMOVAL_MISSING', path: ref });
  for (const f of plan.untrack_files ?? []) {
    try {
      if (checkpointFile(root, normalize(f.path), algorithm).sha256 !== f.sha256
        || f.path === `${plan.workflow_home}/CURRENT_TASK.md`) {
        let stillGenerated = false;
        if (f.path === `${plan.workflow_home}/CURRENT_TASK.md`) {
          try { stillGenerated = readTaskDisplay(root, f.path, { local }).verified; } catch { /* Not a recognized projection. */ }
        }
        if (!stillGenerated) problems.push({ code: 'UNTRACKED_SOURCE_CHANGED', path: f.path });
      }
    }
    catch (error) { problems.push({ ...issue(error), path: f.path }); }
  }
  const treeDigest = checkpointTreeDigest(target);
  if (isCommit && input.index_verification?.tree_sha256 && input.index_verification.tree_sha256 !== treeDigest)
    problems.push({ code: 'COMMITTED_TREE_DIFFERS_FROM_REVIEWED_INDEX' });
  // Older v1 plans may omit legacy objects. Inspect saved manifests and Git dependencies,
  // without adding paths to the user's plan or substituting later working-copy facts.
  const storedReferences = checkpointStoredReferences(root, plan, target, isCommit);
  referenceIssues.push(...storedReferences.issues);
  const plannedPaths = new Set(plan.files.map(file => file.path)), baseTree = checkpointTree(root, plan.base_head);
  const selectedArchives = new Set(storedReferences.archives.filter(archive => archive.physical_files.every(file => plannedPaths.has(file.ref))).map(archive => archive.id));
  for (const migration of plan.archive_migrations ?? []) {
    const record = storedReferences.archived.get(migration.path);
    if (!record || record.archiveId !== migration.archiveId || record.sha256 !== migration.sha256 || record.size !== migration.size
      || !selectedArchives.has(migration.archiveId)) {
      storageIssue({ code: 'ARCHIVE_MIGRATION_NOT_SAVED', path: migration.path });
      referenceIssues.push({ code: 'ARCHIVE_MIGRATION_NOT_SAVED', path: migration.path });
      continue;
    }
    const original = baseTree.get(migration.path);
    if (original) {
      try {
        const metadata = checkpointIndexFile(root, original);
        if (!['100644', '100755'].includes(original.mode) || metadata.sha256 !== record.sha256 || metadata.size !== record.size)
          throw failure('ARCHIVE_MIGRATION_BYTES_DIFFER', 'The removed committed original differs from the saved archive.');
      } catch (error) { storageIssue({ ...issue(error), path: migration.path }); }
    }
  }
  const inventory = checkpointInventory(root, `${plan.workflow_home}/CURRENT_TASK.md`, plan.files.filter(f => f.source !== 'index').map(f => f.path)), saved = new Map(plan.files.map(f => [f.path, f]));
  const remaining = [...inventory.issues.map(i => ({ ...i, reason: 'unreadable' }))];
  for (const f of byteExactFiles) if (!inventory.files.has(f.path)) remaining.push({ path: f.path, role: f.role, reason: 'missing-from-worktree' });
  for (const [ref, role] of inventory.files) if (['fact', 'archive', 'recovery', 'configuration', 'unclassified'].includes(role)) {
    try {
      const f = checkpointFile(root, ref, algorithm);
      if (target.get(ref)?.oid !== f.raw_git_oid) remaining.push({ path: ref, role,
        reason: !saved.has(ref) ? 'not-in-planned-snapshot' : 'changed-after-planning' });
    } catch (error) { remaining.push({ ...issue(error), path: ref, reason: 'unreadable' }); }
  }
  return { ...base(), status: problems.length ? 'mismatch' : 'verified', kind: 'git-checkpoint-verification/v1',
    phase: isCommit ? 'commit' : 'index', commit_sha: commit, base_head: plan.base_head,
    tree_sha256: treeDigest, snapshot_verified: problems.length === 0,
    reviewed_index_compared: isCommit && !!input.index_verification?.tree_sha256,
    reference_health: referenceIssues.length ? 'gaps-retained' : 'no-known-gaps',
    reference_issues: referenceIssues, planning_issues: plan.issues ?? [], issues: problems, remaining_records: remaining,
    scope_exclusions: plan.exclude_paths, recovery_files_retained: plan.files.filter(f => f.role === 'recovery').length,
    note: 'Checks the planned Git snapshot, not task completion, secret safety, future writes or remote backup. No project file/index/history was modified. New records after planning remain for a later authorized checkpoint; do not recursively commit.' };
}

export async function runAssistance(argv = process.argv.slice(2)) {
  let command = argv[0] ?? 'context', root = process.cwd();
  try {
    for (let i = 1; i < argv.length; i++) {
      if (argv[i] === '--root' && argv[i + 1]) root = path.resolve(argv[++i]);
      else throw failure('INVALID_ARGUMENT', 'Usage: assistance.mjs <context|record|snapshot|read|find|task|task-status|git-checkpoint|archive> --root <project>; JSON on stdin.');
    }
    if (!COMMANDS.includes(command)) throw failure('UNKNOWN_COMMAND', command);
    if (!fs.statSync(root).isDirectory()) throw failure('INVALID_ROOT', root);
    const text = process.stdin.isTTY ? '' : fs.readFileSync(0, 'utf8');
    let input;
    try { input = text.trim() ? JSON.parse(text) : {}; }
    catch (error) { if (command !== 'record') throw error; input = { kind: 'raw-observation', body: text }; }
    const statusQuery = command === 'task' && (input?.action ?? 'status') === 'status';
    const result = statusQuery ? queryStatus(root, input)
      : { context: queryContext, record, snapshot, read, find, task, 'task-status': queryStatus, 'git-checkpoint': gitCheckpoint, archive }[command](root, input);
    console.log(json(result)); return command === 'git-checkpoint' && result.status === 'mismatch' ? 1 : 0;
  } catch (error) {
    console.log(json({ ...base(), status: 'unavailable', recorded: false, command, ...issue(error),
      next_action: 'Report this service failure; retain output elsewhere when authorized. Do not turn it into a development stop, rerun business commands, or claim successful persistence.' }));
    return 1; // A real service failure, not a workflow veto and not fake success.
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runAssistance();
