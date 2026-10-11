/** Lossless, event-local task data references. No external body files or mutable lookups. */
import { createHash } from 'node:crypto';

const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const canonical = value => JSON.stringify(stable(value));
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message) => Object.assign(new Error(message), { code });
const invalid = message => failure('TASK_EVENT_ENCODING_INVALID', message);
export const MAX_LOGICAL_TASK_EVENT_BYTES = 64 * 1024 * 1024;
const MAX_REFERENCES = 4096;
const MAX_POINTER_BYTES = 16384;
const escape = key => key.replace(/~/g, '~0').replace(/\//g, '~1');
const childPointer = (parent, key) => `${parent}/${escape(String(key))}`;

function segments(pointer, allowRoot = true) {
  if (typeof pointer !== 'string' || (!allowRoot && pointer === '') || (pointer !== '' && !pointer.startsWith('/')))
    throw invalid('Task data references must use event-local JSON pointers.');
  if (Buffer.byteLength(pointer) > MAX_POINTER_BYTES) throw invalid('Task data reference is too long.');
  if (pointer === '') return [];
  return pointer.slice(1).split('/').map(part => {
    if (/~(?:[^01]|$)/u.test(part)) throw invalid('Invalid escape in task data reference.');
    return part.replace(/~1/g, '/').replace(/~0/g, '~');
  });
}
function ownValue(root, parts) {
  let value = root;
  for (const key of parts) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)
      || (Array.isArray(value) && !/^(?:0|[1-9][0-9]*)$/u.test(key)))
      throw invalid('Task data reference does not identify an existing own value.');
    value = value[key];
  }
  return value;
}
function exactKeys(value, keys) {
  return object(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

/** Called only for canonical task-generated v1 payloads, never for arbitrary raw records. */
export function encodeTaskPayload(payload) {
  try { return encode(payload); } catch { return payload; }
}
function encode(payload) {
  if (payload?.kind !== 'task-event' || payload.task_event?.version !== 1 || !object(payload.request)
    || !object(payload.task_event.data)) return payload;
  // Compare the actual JSON representation, including UTF-8 and formatting overhead.
  const original = JSON.parse(JSON.stringify(payload)), candidates = new Map(), references = [];
  function index(value, pointer) {
    const text = canonical(value);
    if (Buffer.byteLength(text) >= 256) {
      const hash = digest(value);
      if (!candidates.has(hash)) candidates.set(hash, { pointer, value });
    }
    if (value !== null && typeof value === 'object') {
      for (const key of Object.keys(value).sort()) index(value[key], childPointer(pointer, key));
    }
  }
  index(original.request, '');
  function template(value, pointer) {
    const text = canonical(value), bytes = Buffer.byteLength(text);
    if (pointer && bytes >= 256) {
      const match = candidates.get(digest(value));
      const reference = match && { data_pointer: pointer, request_pointer: match.pointer };
      if (match && text === canonical(match.value) && bytes > Buffer.byteLength(JSON.stringify(reference)) + 32) {
        references.push(reference);
        return null;
      }
    }
    if (Array.isArray(value)) return value.map((entry, i) => template(entry, childPointer(pointer, i)));
    if (object(value)) return Object.fromEntries(Object.keys(value).map(key => [key, template(value[key], childPointer(pointer, key))]));
    return value;
  }
  const data = template(original.task_event.data, '');
  if (!references.length) return payload;
  references.sort((a, b) => a.data_pointer < b.data_pointer ? -1 : a.data_pointer > b.data_pointer ? 1 : 0);
  const encoded = { ...original, task_event: { ...original.task_event, version: 2, data,
    data_encoding: { version: 1, kind: 'request-json-pointers', request_sha256: digest(original.request), references } } };
  if (Buffer.byteLength(JSON.stringify(encoded, null, 2)) >= Buffer.byteLength(JSON.stringify(original, null, 2))) return payload;
  // A failed encoding optimization must retain the complete, readable v1 report.
  try {
    const decoded = decodeObservation({ payload: encoded, payload_sha256: digest(encoded) });
    return canonical(decoded.payload) === canonical(original) ? encoded : payload;
  } catch { return payload; }
}

/** Validate stored-wire integrity first, then expose the original logical v1 payload. */
export function decodeObservation(event) {
  if (!object(event) || !object(event.payload) || digest(event.payload) !== event.payload_sha256)
    throw failure('EVENT_DIGEST_MISMATCH', 'Observation wire payload digest does not match.');
  if (Object.hasOwn(event, 'schema_version') && event.schema_version !== 1)
    throw failure('EVENT_VERSION_UNSUPPORTED', 'Unsupported observation schema version; the raw observation remains available.');
  const wire = event.payload, taskEvent = wire.task_event;
  let payload = wire, encoded = false;
  if (wire.kind === 'task-event' && taskEvent !== undefined) {
    if (!object(taskEvent) || ![1, 2].includes(taskEvent.version))
      throw failure('TASK_EVENT_VERSION_UNSUPPORTED', 'Unsupported task event version; the raw observation remains available.');
    if (taskEvent.version === 1 && Object.hasOwn(taskEvent, 'data_encoding'))
      throw invalid('A v1 task event cannot carry a v2 data encoding.');
    if (taskEvent.version === 2) {
      const encoding = taskEvent.data_encoding;
      if (wire.kind !== 'task-event' || !object(wire.request) || !object(taskEvent.data)
        || !exactKeys(encoding, ['version', 'kind', 'request_sha256', 'references']))
        throw invalid('Incomplete task event request or data encoding.');
      if (encoding.version !== 1 || encoding.kind !== 'request-json-pointers')
        throw failure('TASK_EVENT_ENCODING_UNSUPPORTED', 'Unsupported task data encoding; the raw observation remains available.');
      if (encoding.request_sha256 !== digest(wire.request))
        throw invalid('Task data encoding is not bound to this complete original request.');
      if (!Array.isArray(encoding.references) || !encoding.references.length)
        throw invalid('Task data encoding must contain explicit references.');
      if (encoding.references.length > MAX_REFERENCES)
        throw failure('TASK_EVENT_EXPANSION_LIMIT', 'Task data reference count exceeds the supported hydration limit; use the raw paged read.');
      const logicalEvent = { ...taskEvent, version: 1 };
      delete logicalEvent.data_encoding;
      let logicalBytes = Buffer.byteLength(JSON.stringify({ ...wire, task_event: logicalEvent }));
      const targets = new Set();
      // Validate every reference against the unchanged skeleton before hydrating any.
      const resolved = encoding.references.map(reference => {
        if (!exactKeys(reference, ['data_pointer', 'request_pointer'])) throw invalid('Malformed task data reference.');
        const target = segments(reference.data_pointer, false), source = segments(reference.request_pointer);
        if (targets.has(reference.data_pointer)) throw invalid('Duplicate task data reference.');
        targets.add(reference.data_pointer);
        if (ownValue(taskEvent.data, target) !== null) throw invalid('Task data reference must replace an explicit null placeholder.');
        const value = ownValue(wire.request, source);
        logicalBytes += Buffer.byteLength(JSON.stringify(value)) - 4;
        if (logicalBytes > MAX_LOGICAL_TASK_EVENT_BYTES)
          throw failure('TASK_EVENT_EXPANSION_LIMIT', 'Logical task payload exceeds 64 MiB; the raw report remains available with paged read.');
        return { target, value };
      });
      for (const pointer of targets) {
        const parts = segments(pointer);
        for (let i = 1; i < parts.length; i++) {
          const ancestor = '/' + parts.slice(0, i).map(escape).join('/');
          if (targets.has(ancestor)) throw invalid('Overlapping task data references are not allowed.');
        }
      }
      const data = structuredClone(taskEvent.data);
      for (const { target, value } of resolved) {
        const parent = ownValue(data, target.slice(0, -1)), key = target.at(-1);
        // Define an own property even for keys such as __proto__; never traverse prototypes.
        Object.defineProperty(parent, key, { value: structuredClone(value), enumerable: true, writable: true, configurable: true });
      }
      logicalEvent.data = data;
      payload = { ...wire, task_event: logicalEvent };
      encoded = true;
    }
  }
  return { payload, encoded, wire_payload_sha256: event.payload_sha256,
    logical_payload_sha256: digest(payload), request_sha256: object(wire.request) ? digest(wire.request) : null };
}
