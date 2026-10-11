/** Portable, append-only logical records. Native Node only; no local-only catalogue. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { hostname } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

const STORE = '.workflow-system/records';
const ARCHIVES = `${STORE}/archives`, STAGING = `${STORE}/.archive-staging`;
const QUARANTINE = `${STORE}/archive-quarantine`, LOCKS = `${STORE}/.record-store-locks`;
const MAGIC = Buffer.from('WFRPACK1\n');
export const ARCHIVE_LIMITS = Object.freeze({ chunkBytes: 65536, packRawBytes: 64 * 1024 * 1024,
  indexBytes: 4 * 1024 * 1024, recordsPerPack: 2048, manifestBytes: 4 * 1024 * 1024,
  catalogBytes: 16 * 1024 * 1024, archiveCount: 4096, readBytes: 16 * 1024 * 1024, fileReadBytes: 64 * 1024 * 1024 });
const MAX_PACK_BYTES = 72 * 1024 * 1024, MAX_HEADER = 4096, MAX_SEGMENTS = 8192;
const hash = b => createHash('sha256').update(b).digest('hex');
const json = v => Buffer.from(JSON.stringify(v) + '\n');
const digest = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const integer = v => Number.isSafeInteger(v) && v >= 0;
const error = (code, message) => Object.assign(new Error(message), { code });
function requireThat(ok, message, code = 'ARCHIVE_CORRUPT') { if (!ok) throw error(code, message); }

function reference(root, requested) {
  requireThat(typeof requested === 'string' && requested && !requested.includes('\0'), 'Expected a repository-relative path.', 'UNSAFE_PATH');
  const value = requested.replaceAll('\\', '/');
  requireThat(!value.split('/').some(p => p === '..' || p.includes(':') || p.toLowerCase().replace(/[. ]+$/, '') === '.git'),
    'Expected a repository-relative path without traversal or Git-control files.', 'UNSAFE_PATH');
  const relative = path.relative(path.resolve(root), path.resolve(root, value)).split(path.sep).join('/');
  requireThat(relative !== '..' && !relative.startsWith('../') && !path.isAbsolute(relative), 'Expected an in-repository path.', 'UNSAFE_PATH');
  return relative;
}
function local(root, ref) {
  const relative = ref === '' ? '' : reference(root, ref), base = path.resolve(root);
  let current = base;
  for (const part of [null, ...relative.split('/').filter(Boolean)]) {
    if (part !== null) current = path.join(current, part);
    try { requireThat(!fs.lstatSync(current).isSymbolicLink(), `Symbolic paths are not followed: ${ref}`, 'UNSAFE_PATH'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return current;
}
function statMaybe(root, ref) {
  try { return fs.lstatSync(local(root, ref)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
function ensureDir(root, ref) { fs.mkdirSync(local(root, ref), { recursive: true }); local(root, ref); }
function openFile(root, ref, flags = 'r') {
  const file = local(root, ref), numeric = flags === 'r' ? fs.constants.O_RDONLY : fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL;
  const fd = fs.openSync(file, numeric | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
  try { requireThat(fs.fstatSync(fd).isFile(), `Expected a regular file: ${ref}`, 'NOT_A_FILE'); local(root, ref); return fd; }
  catch (e) { fs.closeSync(fd); throw e; }
}
function syncDir(root, ref) {
  const fd = fs.openSync(local(root, ref), 'r');
  try {
    requireThat(fs.fstatSync(fd).isDirectory(), `Expected a directory to sync: ${ref}`);
    try { fs.fsyncSync(fd); }
    catch (e) {
      // Windows can open a directory but cannot FlushFileBuffers on that handle.
      // Only this directory-fsync case is optional; open and file errors propagate.
      if (!['EINVAL', 'ENOTSUP', 'EBADF'].includes(e.code) && !(process.platform === 'win32' && e.code === 'EPERM')) throw e;
    }
  }
  finally { fs.closeSync(fd); }
}
function sameStat(a, b) { return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs; }
function readExactly(fd, length, offset) {
  const bytes = Buffer.alloc(length); let got = 0;
  while (got < length) { const n = fs.readSync(fd, bytes, got, length - got, offset + got); requireThat(n > 0, 'Truncated archive or file.'); got += n; }
  return bytes;
}
function fileDigest(root, ref) {
  const fd = openFile(root, ref);
  try {
    const before = fs.fstatSync(fd), h = createHash('sha256'), buffer = Buffer.alloc(ARCHIVE_LIMITS.chunkBytes);
    let count, size = 0;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) { h.update(buffer.subarray(0, count)); size += count; }
    requireThat(sameStat(before, fs.fstatSync(fd)) && size === before.size, `Source changed while reading: ${ref}`, 'SOURCE_CHANGED');
    return { size, sha256: h.digest('hex'), stat: before };
  } finally { fs.closeSync(fd); }
}
function smallFile(root, ref, limit) {
  const fd = openFile(root, ref);
  try {
    const s = fs.fstatSync(fd); requireThat(s.size <= limit, `Metadata exceeds its bound: ${ref}`);
    const bytes = readExactly(fd, s.size, 0); requireThat(sameStat(s, fs.fstatSync(fd)), `File changed while reading: ${ref}`, 'SOURCE_CHANGED'); return bytes;
  }
  finally { fs.closeSync(fd); }
}
function parsed(bytes, name) { try { return JSON.parse(bytes.toString('utf8')); } catch { throw error('ARCHIVE_CORRUPT', `Invalid JSON: ${name}`); } }
function immutableFile(root, ref, bytes) {
  ensureDir(root, path.posix.dirname(ref));
  const temp = `${ref}.${randomUUID()}.tmp`, fd = openFile(root, temp, 'wx');
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try {
    try { fs.linkSync(local(root, temp), local(root, ref)); syncDir(root, path.posix.dirname(ref)); return true; }
    catch (e) { if (e.code !== 'EEXIST') throw e; return false; }
  } finally { fs.unlinkSync(local(root, temp)); }
}
function candidate(ref) {
  return new RegExp(`^\\.workflow-system/records/(?:events/[^/]+\\.json|attachments/[^/]+\\.json|evidence-objects/[a-f0-9]{64}\\.blob|task-labels/[^/]+\\.json|legacy/(?:baseline\\.json|current-[a-f0-9]{64}\\.md))$`).test(ref);
}
function canonicalRecord(root, ref) {
  requireThat(reference(root, ref) === ref && candidate(ref) && Buffer.byteLength(ref) <= 1024,
    `Archive contains an unsafe or non-archivable record path: ${ref}`);
}
function expectedContentName(ref, sha256) {
  const named = /\/(?:evidence-objects\/|legacy\/current-)([a-f0-9]{64})\.(?:blob|md)$/.exec(ref)?.[1];
  requireThat(!named || named === sha256, `Content-addressed filename differs: ${ref}`, 'OBJECT_CORRUPT');
}

// Dead owners are never stolen on an age threshold. Explicit recovery authorizes a
// deterministic successor lock; no reclaimer deletes another owner's lock inode.
function lockOwner(root, ref) {
  const raw = smallFile(root, ref, 16384), owner = parsed(raw, ref);
  requireThat(typeof owner.id === 'string' && typeof owner.host === 'string' && Number.isSafeInteger(owner.pid) && owner.pid > 0,
    `Invalid lock owner; inspect ${ref} before manual recovery.`, 'STORE_LOCK_INVALID');
  return { raw, owner };
}
function dead(owner) {
  if (owner.host !== hostname()) return false;
  try { process.kill(owner.pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; }
}
function lockSuccessor(root, ref, raw) {
  const key = hash(Buffer.concat([Buffer.from(`${ref}\n`), raw]));
  const recovery = `${LOCKS}/recovery-${key}.json`;
  if (!statMaybe(root, recovery)) return null;
  const marker = parsed(smallFile(root, recovery, 16384), recovery);
  requireThat(marker.lock_ref === ref && marker.owner_sha256 === hash(raw), 'Invalid lock recovery marker.', 'STORE_LOCK_INVALID');
  return `${LOCKS}/successor-${key}.lock`;
}
function withLock(root, fn) {
  invalidateReadContexts(root);
  ensureDir(root, LOCKS);
  // Brief live-writer contention is normal during concurrent event/label publication.
  // Wait within this operation; never steal a lock or replay business work.
  const deadline = process.hrtime.bigint() + 2_000_000_000n;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const owner = { pid: process.pid, host: hostname(), id: randomUUID() }, bytes = json(owner);
  const temp = `${LOCKS}/owner-${owner.id}.tmp`;
  immutableFile(root, temp, bytes);
  let acquired = null;
  try {
    let ref = `${LOCKS}/store.lock`;
    for (let depth = 0; depth < 64; depth++) {
      try { fs.linkSync(local(root, temp), local(root, ref)); acquired = ref; break; }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        let current;
        try { current = lockOwner(root, ref); }
        catch (readError) {
          if (readError.code === 'ENOENT') {
            if (process.hrtime.bigint() >= deadline)
              throw error('STORE_BUSY', `Record storage kept changing owners past bounded waiting; no lock was stolen: ${ref}`);
            depth--; continue;
          }
          throw readError;
        }
        const successor = lockSuccessor(root, ref, current.raw), abandoned = dead(current.owner);
        if (successor && abandoned) { ref = successor; continue; }
        if (!abandoned && process.hrtime.bigint() < deadline) {
          Atomics.wait(sleeper, 0, 0, 10); depth--; continue;
        }
        throw error('STORE_BUSY', abandoned
          ? `A dead record-store owner requires explicit archive recover-lock: ${ref}`
          : `Record storage remained busy after bounded waiting; no lock was stolen: ${ref}`);
      }
    }
    requireThat(acquired, 'Lock recovery chain exceeds its bound; inspect lock state.', 'STORE_BUSY');
    return fn();
  } finally {
    invalidateReadContexts(root);
    if (acquired) {
      const current = lockOwner(root, acquired);
      if (current.owner.id === owner.id) fs.unlinkSync(local(root, acquired));
    }
    fs.unlinkSync(local(root, temp));
  }
}
function recoverLock(root, input) {
  let ref = `${LOCKS}/store.lock`;
  for (let depth = 0; depth < 64; depth++) {
    if (!statMaybe(root, ref)) return { status: 'not-locked' };
    const { raw, owner } = lockOwner(root, ref), successor = lockSuccessor(root, ref, raw);
    if (successor) { requireThat(dead(owner), 'A live or remote lock owner cannot be recovered.', 'STORE_BUSY'); ref = successor; continue; }
    requireThat(dead(owner), 'Only a demonstrably exited process on this host may be recovered; no age-based stealing.', 'STORE_BUSY');
    if (input.owner_id !== undefined) requireThat(input.owner_id === owner.id, 'Lock owner changed.', 'STORE_BUSY');
    const key = hash(Buffer.concat([Buffer.from(`${ref}\n`), raw]));
    immutableFile(root, `${LOCKS}/recovery-${key}.json`, json({ version: 1, lock_ref: ref, owner_sha256: hash(raw) }));
    return { status: 'recovered', lock_ref: ref, owner_id: owner.id };
  }
  throw error('STORE_BUSY', 'Lock recovery chain exceeds its bound.');
}

// Cache only bounded metadata, guarded by inode/ctime/mtime/size; never cache a
// missing file, directory listing, payload verification, or mutable loose record.
const metadataCache = new Map(); let metadataCacheBytes = 0;

// A read context owns at most one validated catalog (full, or one routed ref).
// It is synchronous, root-bound and released on exit; it never authorizes writes
// or remembers loose bytes. Reuse checks every loaded physical file and archive
// directory, so directory membership, replacement and path changes are detected.
const readContexts = new WeakMap(), activeReadContexts = new Map();
function invalidateReadContexts(root) {
  for (const state of activeReadContexts.get(path.resolve(root)) ?? []) state.cached = null;
}
function signaturesMatch(root, signatures) {
  for (const [ref, before] of signatures) {
    const now = statMaybe(root, ref);
    if (before === null ? now !== null : now === null || !sameStat(before, now)) return false;
  }
  return true;
}
export function withStoreReadContext(root, fn) {
  const base = path.resolve(root), context = Object.freeze({}), state = { root: base, cached: null };
  readContexts.set(context, state);
  let active = activeReadContexts.get(base);
  if (!active) { active = new Set(); activeReadContexts.set(base, active); }
  active.add(state);
  try {
    const result = fn(context);
    requireThat(!result || typeof result.then !== 'function', 'Record read contexts must be synchronous.', 'INVALID_READ_CONTEXT');
    requireThat(!state.cached || signaturesMatch(base, state.cached.signatures), 'Archive changed during the query.', 'SOURCE_CHANGED');
    return result;
  } finally {
    state.cached = null; readContexts.delete(context); active.delete(state);
    if (!active.size) activeReadContexts.delete(base);
  }
}
function queryCatalog(root, target, context) {
  if (context === undefined) return catalog(root, target);
  const state = readContextState(root, context);
  try {
    const cached = state.cached;
    if (cached && signaturesMatch(root, cached.signatures) && (cached.target === null || cached.target === target))
      return { ...cached.catalog, metrics: newMetrics() };
    // Drop the old graph before loading another target: the 16 MiB catalog bound
    // applies to the entire context, rather than separately retained subqueries.
    state.cached = null;
    const signatures = new Map(), result = catalog(root, target, signatures);
    requireThat(signaturesMatch(root, signatures), 'Archive changed while validating the query.', 'SOURCE_CHANGED');
    state.cached = { target, catalog: result, signatures };
    return result;
  } catch (e) { state.cached = null; throw e; }
}
function readContextState(root, context) {
  if (context === undefined) return null;
  const state = readContexts.get(context);
  requireThat(state && state.root === path.resolve(root), 'Read context is closed or belongs to another root.', 'INVALID_READ_CONTEXT');
  return state;
}
function metadataFile(root, ref, limit, metrics) {
  const file = local(root, ref), stat = fs.lstatSync(file), old = metadataCache.get(file);
  requireThat(stat.isFile() && stat.size <= limit, `Invalid or oversized metadata: ${ref}`);
  metrics.metadata_bytes_examined += stat.size;
  requireThat(metrics.metadata_bytes_examined <= ARCHIVE_LIMITS.catalogBytes, 'Archive metadata exceeds its cold-lookup budget.', 'ARCHIVE_CATALOG_LIMIT');
  if (old && sameStat(old.stat, stat)) {
    metadataCache.delete(file); metadataCache.set(file, old); metrics.metadata_cache_hits++; return old;
  }
  if (old) { metadataCacheBytes -= old.bytes.length; metadataCache.delete(file); }
  const bytes = smallFile(root, ref, limit);
  requireThat(sameStat(stat, fs.lstatSync(local(root, ref))), 'Metadata changed while reading.', 'SOURCE_CHANGED');
  const value = { bytes, value: parsed(bytes, ref), sha256: hash(bytes), stat };
  metrics.metadata_bytes_read += bytes.length;
  while (metadataCache.size && (metadataCacheBytes + bytes.length > ARCHIVE_LIMITS.catalogBytes || metadataCache.size >= 512)) {
    const key = metadataCache.keys().next().value; metadataCacheBytes -= metadataCache.get(key).bytes.length; metadataCache.delete(key);
  }
  metadataCache.set(file, value); metadataCacheBytes += bytes.length; return value;
}

function archiveDirectories(root, signatures = null) {
  const s = statMaybe(root, ARCHIVES); signatures?.set(ARCHIVES, s); if (!s) return [];
  requireThat(s.isDirectory(), 'Archive storage must be a directory.');
  const names = fs.readdirSync(local(root, ARCHIVES)).sort();
  requireThat(names.length <= ARCHIVE_LIMITS.archiveCount, 'Archive catalogue exceeds its archive-count bound.', 'ARCHIVE_CATALOG_LIMIT');
  return names.map(id => {
    requireThat(digest(id), `Unexpected archive entry: ${id}`);
    const ref = `${ARCHIVES}/${id}`, stat = statMaybe(root, ref);
    requireThat(stat?.isDirectory(), `Unexpected archive entry: ${id}`);
    signatures?.set(ref, stat);
    return id;
  });
}
function loadArchive(root, id, target = null, metrics = newMetrics(), baseOverride = null, signatures = null) {
  const base = baseOverride ?? `${ARCHIVES}/${id}`, manifestRef = `${base}/manifest.json`;
  const manifestFile = metadataFile(root, manifestRef, ARCHIVE_LIMITS.manifestBytes, metrics), manifestBytes = manifestFile.bytes;
  signatures?.set(manifestRef, manifestFile.stat);
  requireThat(manifestFile.sha256 === id, `Manifest identity differs: ${id}`);
  metrics.manifests_read++;
  const manifest = manifestFile.value;
  requireThat(manifest.version === 1 && manifest.format === 'workflow-record-archive' && manifest.chunk_size === ARCHIVE_LIMITS.chunkBytes
    && Array.isArray(manifest.segments) && manifest.segments.length > 0 && manifest.segments.length <= MAX_SEGMENTS, 'Invalid archive manifest.');
  const physical = [{ ref: manifestRef, size: manifestBytes.length, sha256: id, kind: 'manifest' }], records = new Map(), packs = [];
  const expectedNames = new Set(['manifest.json']);
  let previousLast = null;
  for (const [number, segment] of manifest.segments.entries()) {
    const suffix = String(number).padStart(6, '0'), indexName = `index-${suffix}.json`, packName = `pack-${suffix}.bin`;
    requireThat(segment.index === indexName && segment.pack === packName && digest(segment.sha256) && digest(segment.pack_sha256)
      && integer(segment.size) && segment.size > 0 && segment.size <= ARCHIVE_LIMITS.indexBytes
      && integer(segment.pack_size) && segment.pack_size >= MAGIC.length && segment.pack_size <= MAX_PACK_BYTES, 'Invalid segment metadata.');
    canonicalRecord(root, segment.first_ref); canonicalRecord(root, segment.last_ref);
    requireThat(segment.first_ref <= segment.last_ref && (!previousLast || previousLast <= segment.first_ref), 'Invalid manifest routing ranges.');
    previousLast = segment.last_ref;
    expectedNames.add(indexName); expectedNames.add(packName);
    if (target !== null && (target < segment.first_ref || target > segment.last_ref)) continue;
    const indexRef = `${base}/${indexName}`, packRef = `${base}/${packName}`;
    const indexFile = metadataFile(root, indexRef, ARCHIVE_LIMITS.indexBytes, metrics), indexBytes = indexFile.bytes;
    signatures?.set(indexRef, indexFile.stat);
    requireThat(indexBytes.length === segment.size && indexFile.sha256 === segment.sha256, `Index digest differs: ${indexRef}`);
    metrics.indices_read++;
    const index = indexFile.value;
    requireThat(index.version === 1 && index.pack?.ref === packName && index.pack.size === segment.pack_size
      && index.pack.sha256 === segment.pack_sha256 && Array.isArray(index.records) && index.records.length > 0
      && index.records.length <= ARCHIVE_LIMITS.recordsPerPack, `Invalid index: ${indexRef}`);
    requireThat(index.records[0].ref === segment.first_ref && index.records.at(-1).ref === segment.last_ref, 'Index routing ranges differ.');
    const fd = openFile(root, packRef);
    try {
      const stat = fs.fstatSync(fd);
      requireThat(stat.size === segment.pack_size && readExactly(fd, MAGIC.length, 0).equals(MAGIC), `Missing or invalid pack: ${packRef}`);
      requireThat(sameStat(stat, fs.fstatSync(fd)), `Pack changed while validating: ${packRef}`, 'SOURCE_CHANGED');
      signatures?.set(packRef, stat);
    }
    finally { fs.closeSync(fd); }
    const indexPhysical = { ref: indexRef, size: segment.size, sha256: segment.sha256, kind: 'index' };
    const packPhysical = { ref: packRef, size: segment.pack_size, sha256: segment.pack_sha256, kind: 'pack' };
    physical.push(indexPhysical, packPhysical); packs.push(packPhysical);
    let next = MAGIC.length, rawTotal = 0;
    const segmentPaths = new Set(); let previousRef = null;
    for (const entry of index.records) {
      canonicalRecord(root, entry.ref);
      requireThat(integer(entry.size) && digest(entry.sha256) && Array.isArray(entry.chunks) && entry.chunks.length > 0 && !segmentPaths.has(entry.ref), 'Invalid or duplicate record index.');
      expectedContentName(entry.ref, entry.sha256); segmentPaths.add(entry.ref);
      requireThat(!previousRef || previousRef < entry.ref, 'Index paths are not sorted.'); previousRef = entry.ref;
      let record = records.get(entry.ref);
      const selected = target === null || target === entry.ref;
      if (!record) { record = { ref: entry.ref, size: entry.size, sha256: entry.sha256, archiveId: id, chunks: [], physical_files: [physical[0]] }; if (selected) records.set(entry.ref, record); }
      requireThat(record.size === entry.size && record.sha256 === entry.sha256, `Inconsistent record fragments: ${entry.ref}`);
      record.physical_files.push(indexPhysical, packPhysical);
      let entryOffset = entry.chunks[0].rawOffset;
      for (const chunk of entry.chunks) {
        requireThat(integer(chunk.offset) && chunk.offset === next && integer(chunk.length) && chunk.length > 0 && chunk.length <= ARCHIVE_LIMITS.chunkBytes + 1024
          && integer(chunk.rawOffset) && integer(chunk.rawLength) && chunk.rawLength <= ARCHIVE_LIMITS.chunkBytes
          && integer(chunk.headerLength) && chunk.headerLength > 0 && chunk.headerLength <= MAX_HEADER
          && digest(chunk.sha256) && digest(chunk.compressedSha256), 'Invalid chunk index.');
        requireThat(chunk.rawOffset === entryOffset
          && chunk.rawOffset + chunk.rawLength <= record.size && (chunk.rawLength > 0 || record.size === 0 && record.chunks.length === 0), 'Invalid chunk ranges.');
        next += 4 + chunk.headerLength + chunk.length; rawTotal += chunk.rawLength;
        requireThat(next <= segment.pack_size && rawTotal <= ARCHIVE_LIMITS.packRawBytes, 'Pack bounds exceeded.');
        entryOffset += chunk.rawLength;
        if (selected) record.chunks.push({ ...chunk, packRef });
      }
    }
    requireThat(next === segment.pack_size, 'Pack has missing or unindexed bytes.');
  }
  const names = fs.readdirSync(local(root, base));
  requireThat(names.length === expectedNames.size && names.every(n => expectedNames.has(n)), 'Unexpected files inside an immutable archive.');
  for (const record of records.values()) {
    let offset = 0; for (const chunk of record.chunks) { requireThat(chunk.rawOffset === offset, `Incomplete or overlapping record: ${record.ref}`); offset += chunk.rawLength; }
    requireThat(offset === record.size, `Incomplete record: ${record.ref}`);
  }
  return { id, manifestRef, physical_files: physical, records: [...records.values()], packs };
}
function catalog(root, target = null, signatures = null) {
  const metrics = newMetrics(), archives = archiveDirectories(root, signatures).map(id => {
    try { return loadArchive(root, id, target, metrics, null, signatures); }
    catch (e) { if (e.code === 'ENOENT') throw error('ARCHIVE_CORRUPT', `Archive metadata or pack is missing: ${id}`); throw e; }
  }), records = new Map();
  for (const archive of archives) for (const record of archive.records) {
    requireThat(!records.has(record.ref), `Logical path appears in multiple archives: ${record.ref}`, 'ARCHIVE_COLLISION');
    records.set(record.ref, record);
  }
  return { archives, records, metrics };
}
function chunkBytes(root, record, chunk, metrics) {
  const fd = openFile(root, chunk.packRef);
  try {
    const headerSize = readExactly(fd, 4, chunk.offset).readUInt32BE(0);
    requireThat(headerSize === chunk.headerLength && headerSize <= MAX_HEADER, 'Chunk header length differs.');
    const header = parsed(readExactly(fd, headerSize, chunk.offset + 4), chunk.packRef);
    requireThat(header.ref === record.ref && header.size === record.size && header.record_sha256 === record.sha256
      && header.rawOffset === chunk.rawOffset && header.rawLength === chunk.rawLength && header.length === chunk.length
      && header.sha256 === chunk.sha256 && header.compressedSha256 === chunk.compressedSha256, 'Pack chunk header differs from its index.');
    const compressed = readExactly(fd, chunk.length, chunk.offset + 4 + headerSize);
    requireThat(hash(compressed) === chunk.compressedSha256, 'Compressed chunk digest differs.');
    let bytes;
    try { bytes = inflateRawSync(compressed, { maxOutputLength: Math.max(1, chunk.rawLength), info: true }); }
    catch { throw error('ARCHIVE_CORRUPT', 'Invalid or oversized compressed chunk.'); }
    requireThat(bytes.engine.bytesWritten === compressed.length && bytes.buffer.length === chunk.rawLength && hash(bytes.buffer) === chunk.sha256, 'Chunk length or digest differs.');
    metrics.compressed_bytes_read += compressed.length; metrics.pack_bytes_read += 4 + headerSize + compressed.length;
    metrics.decompressed_bytes += bytes.buffer.length; metrics.chunks_read++;
    return bytes.buffer;
  } finally { fs.closeSync(fd); }
}
const newMetrics = () => ({ metadata_bytes_read: 0, metadata_bytes_examined: 0, metadata_cache_hits: 0, manifests_read: 0, indices_read: 0, compressed_bytes_read: 0, pack_bytes_read: 0, decompressed_bytes: 0, chunks_read: 0, loose_bytes_hashed: 0 });
function validateLoose(root, record, metrics, options = {}) {
  const s = statMaybe(root, record.ref); if (!s) return false;
  requireThat(s.isFile(), `Logical record is not a file: ${record.ref}`, 'ARCHIVE_COLLISION');
  requireThat(s.size === record.size, `Loose/archive length collision: ${record.ref}`, 'ARCHIVE_COLLISION');
  // Bounded discovery does not claim that unvisited duplicate bytes were verified.
  // The range reader below compares every returned byte against the loose copy.
  if (options.hashLoose === false && !options.expectedSha256) return true;
  const actual = fileDigest(root, record.ref); if (metrics) metrics.loose_bytes_hashed += actual.size;
  requireThat(actual.size === record.size && actual.sha256 === record.sha256, `Loose/archive collision: ${record.ref}`, 'ARCHIVE_COLLISION');
  return true;
}
function fullVerify(root, state) {
  for (const archive of state.archives) {
    for (const pack of archive.packs) { const actual = fileDigest(root, pack.ref); requireThat(actual.size === pack.size && actual.sha256 === pack.sha256, `Pack digest differs: ${pack.ref}`); }
    for (const record of archive.records) {
      const h = createHash('sha256'); for (const chunk of record.chunks) h.update(chunkBytes(root, record, chunk, newMetrics()));
      requireThat(h.digest('hex') === record.sha256, `Record digest differs: ${record.ref}`); validateLoose(root, record);
    }
  }
}
function logical(root, requested, options = {}) {
  readContextState(root, options.readContext);
  const ref = reference(root, requested);
  if (!candidate(ref)) return { ref, record: null };
  const state = queryCatalog(root, ref, options.readContext);
  return { ref, record: state.records.get(ref) ?? null, metrics: state.metrics };
}
export function storeStat(root, requested, options = {}) {
  const { ref, record } = logical(root, requested, options);
  if (record) {
    const duplicate = validateLoose(root, record, null, options);
    return { size: record.size, sha256: record.sha256, storage: 'archive', archiveId: record.archiveId,
      duplicate_verification: duplicate ? options.hashLoose === false ? 'metadata-only' : 'whole-file' : 'absent' };
  }
  if (options.hashLoose === false) {
    const fd = openFile(root, ref); try { return { size: fs.fstatSync(fd).size, storage: 'loose' }; } finally { fs.closeSync(fd); }
  }
  const actual = fileDigest(root, ref);
  return { size: actual.size, sha256: actual.sha256, storage: 'loose' };
}
export function storeExists(root, requested, options = {}) { try { storeStat(root, requested, options); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
export function storeRead(root, requested, options = {}) {
  const located = logical(root, requested, options), { ref, record } = located, metrics = located.metrics ?? newMetrics();
  const offset = options.offset ?? 0, requestedLength = options.length ?? ARCHIVE_LIMITS.readBytes;
  requireThat(integer(offset) && integer(requestedLength) && requestedLength <= ARCHIVE_LIMITS.readBytes, `Read range must be non-negative and at most ${ARCHIVE_LIMITS.readBytes} bytes.`, 'INVALID_RANGE');
  if (options.expectedSha256 !== undefined) requireThat(digest(options.expectedSha256), 'Invalid expected SHA-256.', 'INVALID_DIGEST');
  if (record) {
    const duplicate = validateLoose(root, record, metrics, options);
    requireThat(!options.expectedSha256 || options.expectedSha256 === record.sha256, `Historical digest differs: ${ref}`, 'OBJECT_CORRUPT');
    const length = Math.min(requestedLength, Math.max(0, record.size - offset)), end = offset + length, parts = [];
    for (const chunk of record.chunks) if (record.size === 0 || chunk.rawOffset < end && chunk.rawOffset + chunk.rawLength > offset) {
      const bytes = chunkBytes(root, record, chunk, metrics);
      parts.push(bytes.subarray(Math.max(0, offset - chunk.rawOffset), Math.min(bytes.length, end - chunk.rawOffset)));
    }
    const bytes = Buffer.concat(parts, length);
    let duplicateVerification = duplicate ? 'whole-file' : 'absent';
    if (duplicate && options.hashLoose === false && !options.expectedSha256) {
      const fd = openFile(root, ref);
      try {
        const before = fs.fstatSync(fd);
        requireThat(before.size === record.size, `Loose/archive length collision: ${ref}`, 'ARCHIVE_COLLISION');
        const loose = readExactly(fd, length, offset);
        requireThat(sameStat(before, fs.fstatSync(fd)), `Loose duplicate changed during range read: ${ref}`, 'SOURCE_CHANGED');
        requireThat(loose.equals(bytes), `Loose/archive range collision: ${ref}`, 'ARCHIVE_COLLISION');
        metrics.loose_bytes_read = length; duplicateVerification = 'selected-range-only';
      } finally { fs.closeSync(fd); }
    }
    return { bytes, size: record.size, sha256: record.sha256, storage: 'archive', metrics, verification: 'indexed-selected-chunks', duplicate_verification: duplicateVerification };
  }
  const hashLoose = options.hashLoose !== false || !!options.expectedSha256;
  let actual;
  if (hashLoose) { actual = fileDigest(root, ref); metrics.loose_bytes_hashed = actual.size; }
  else { const fd = openFile(root, ref); try { const stat = fs.fstatSync(fd); actual = { size: stat.size, sha256: null, stat }; } finally { fs.closeSync(fd); } }
  requireThat(!options.expectedSha256 || options.expectedSha256 === actual.sha256, `Historical digest differs: ${ref}`, 'OBJECT_CORRUPT');
  const fd = openFile(root, ref);
  try {
    requireThat(sameStat(actual.stat, fs.fstatSync(fd)), 'Source changed before range read.', 'SOURCE_CHANGED');
    const bytes = readExactly(fd, Math.min(requestedLength, Math.max(0, actual.size - offset)), offset);
    requireThat(sameStat(actual.stat, fs.fstatSync(fd)), 'Source changed during range read.', 'SOURCE_CHANGED');
    metrics.loose_bytes_read = bytes.length;
    return { bytes, size: actual.size, sha256: actual.sha256, storage: 'loose', metrics, verification: hashLoose ? 'whole-file' : 'file-range' };
  } finally { fs.closeSync(fd); }
}
export function storeReadFile(root, requested, options = {}) {
  const { ref, record } = logical(root, requested, options);
  if (!record) return smallFile(root, ref, ARCHIVE_LIMITS.fileReadBytes);
  validateLoose(root, record);
  requireThat(record.size <= ARCHIVE_LIMITS.fileReadBytes, 'Whole-file read exceeds its bound; use storeRead ranges.', 'READ_TOO_LARGE');
  const parts = [], h = createHash('sha256');
  for (const chunk of record.chunks) { const bytes = chunkBytes(root, record, chunk, newMetrics()); parts.push(bytes); h.update(bytes); }
  requireThat(h.digest('hex') === record.sha256, `Record digest differs: ${ref}`);
  return Buffer.concat(parts, record.size);
}
function walk(root, prefix, out) {
  const s = statMaybe(root, prefix); if (!s) return;
  if (s.isFile()) { out.add(prefix); return; }
  requireThat(s.isDirectory(), `Expected directory or regular file: ${prefix}`, 'NOT_A_FILE');
  for (const name of fs.readdirSync(local(root, prefix)).sort()) {
    const ref = prefix ? `${prefix}/${name}` : name;
    if (ref === '.git' || [ARCHIVES, STAGING, QUARANTINE, LOCKS].some(p => ref === p || ref.startsWith(`${p}/`))) continue;
    walk(root, ref, out);
  }
}
export function storeList(root, requested = STORE, options = {}) {
  readContextState(root, options.readContext);
  const prefix = reference(root, requested), found = new Set(); walk(root, prefix, found);
  if (prefix === '' || STORE.startsWith(`${prefix}/`) || prefix === STORE || prefix.startsWith(`${STORE}/`)) {
    const state = queryCatalog(root, null, options.readContext);
    for (const record of state.records.values()) if (record.ref === prefix || record.ref.startsWith(`${prefix}/`) || prefix === '') {
      // Discovery lists identities only. Diagnose a conflicting duplicate when
      // that individual record is scanned, so it cannot hide independent refs.
      if (options.hashLoose !== false) validateLoose(root, record);
      found.add(record.ref);
    }
  }
  return [...found].sort();
}
export function storeReserve(root, requested, value) {
  const ref = reference(root, requested), bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return withLock(root, () => {
    const record = candidate(ref) ? catalog(root, ref).records.get(ref) : null;
    if (record) { validateLoose(root, record); return false; }
    const s = statMaybe(root, ref);
    if (s) { requireThat(s.isFile(), `Expected regular record: ${ref}`, 'NOT_A_FILE'); return false; }
    return immutableFile(root, ref, bytes);
  });
}
export function storeAppend(root, requested, value) {
  const ref = reference(root, requested), bytes = Buffer.isBuffer(value) ? value : Buffer.from(value), sha256 = hash(bytes);
  return withLock(root, () => {
    const record = candidate(ref) ? catalog(root, ref).records.get(ref) : null;
    if (record) {
      validateLoose(root, record); requireThat(record.size === bytes.length && record.sha256 === sha256, `Append would replace historical bytes: ${ref}`, 'APPEND_CONFLICT');
      const h = createHash('sha256'); for (const chunk of record.chunks) h.update(chunkBytes(root, record, chunk, newMetrics()));
      requireThat(h.digest('hex') === sha256, `Archived record differs: ${ref}`); return { created: false };
    }
    if (statMaybe(root, ref)) {
      const old = fileDigest(root, ref); requireThat(old.size === bytes.length && old.sha256 === sha256, `Append would replace historical bytes: ${ref}`, 'APPEND_CONFLICT');
      return { created: false };
    }
    expectedContentName(ref, sha256);
    const created = immutableFile(root, ref, bytes);
    if (!created) {
      const old = fileDigest(root, ref);
      requireThat(old.size === bytes.length && old.sha256 === sha256, `Append raced with different bytes: ${ref}`, 'APPEND_CONFLICT');
    }
    return { created };
  });
}
export function storePublishFile(root, requested, tempFile, expectedSha256, size) {
  const ref = reference(root, requested), tempRef = reference(root, tempFile);
  const captured = fileDigest(root, tempRef);
  requireThat(captured.sha256 === expectedSha256 && captured.size === size, 'Captured file differs from expected bytes.', 'SOURCE_CHANGED');
  return withLock(root, () => {
    const record = candidate(ref) ? catalog(root, ref).records.get(ref) : null;
    if (record) {
      validateLoose(root, record); requireThat(record.sha256 === expectedSha256 && record.size === size, `Append conflict: ${ref}`, 'APPEND_CONFLICT');
      const h = createHash('sha256'); for (const chunk of record.chunks) h.update(chunkBytes(root, record, chunk, newMetrics()));
      requireThat(h.digest('hex') === expectedSha256, `Archived record differs: ${ref}`); return false;
    }
    if (statMaybe(root, ref)) { const old = fileDigest(root, ref); requireThat(old.sha256 === expectedSha256 && old.size === size, `Append conflict: ${ref}`, 'APPEND_CONFLICT'); return false; }
    requireThat(sameStat(captured.stat, fs.lstatSync(local(root, tempRef))), 'Captured source changed before publication.', 'SOURCE_CHANGED');
    expectedContentName(ref, expectedSha256); ensureDir(root, path.posix.dirname(ref));
    fs.linkSync(local(root, tempRef), local(root, ref)); syncDir(root, path.posix.dirname(ref)); return true;
  });
}

function publicRecord(record) { const { chunks, ...metadata } = record; return metadata; }
function publicArchive(archive) { const { packs, records, ...metadata } = archive; return { ...metadata, records: records.map(publicRecord) }; }
function quarantineRef(record) { return `${QUARANTINE}/${record.archiveId}/${record.ref.slice(STORE.length + 1)}`; }
function quarantineProof(root, state) {
  const result = [];
  for (const archive of state.archives) {
    const markerRef = `${QUARANTINE}/${archive.id}/quarantine.json`, receiptRef = `${QUARANTINE}/${archive.id}/reclaimed.json`;
    const marked = statMaybe(root, markerRef), reclaimed = statMaybe(root, receiptRef);
    if (!marked) { requireThat(!reclaimed, 'Reclamation receipt has no quarantine marker.'); continue; }
    const marker = parsed(smallFile(root, markerRef, 16384), markerRef);
    requireThat(marker.version === 1 && marker.archiveId === archive.id, 'Invalid quarantine marker.');
    if (reclaimed) {
      const receipt = parsed(smallFile(root, receiptRef, 16384), receiptRef);
      requireThat(receipt.version === 1 && receipt.archiveId === archive.id && receipt.scope === 'all-records', 'Invalid reclamation receipt.');
    }
    for (const record of archive.records) {
      const ref = quarantineRef(record), exists = statMaybe(root, ref);
      if (exists) {
        const actual = fileDigest(root, ref);
        requireThat(actual.sha256 === record.sha256 && actual.size === record.size, `Quarantine bytes differ: ${ref}`, 'QUARANTINE_CORRUPT');
      }
      if (!statMaybe(root, record.ref) && (exists || reclaimed)) result.push({ ...publicRecord(record),
        quarantineRef: exists ? ref : null, reclaimed: !exists && !!reclaimed, proofRef: reclaimed ? receiptRef : markerRef });
    }
  }
  return result;
}
export function archiveInventory(root, options = {}) {
  const state = catalog(root);
  if (options.verify) fullVerify(root, state);
  else for (const record of state.records.values()) validateLoose(root, record);
  return { verified: !!options.verify, archives: state.archives.map(publicArchive), records: [...state.records.values()].map(publicRecord),
    quarantined: quarantineProof(root, state), metrics: state.metrics };
}
function selection(root, input, state) {
  let ids = null, refs = null;
  if (input.archive_ids !== undefined) {
    requireThat(Array.isArray(input.archive_ids) && input.archive_ids.every(digest), 'archive_ids must contain SHA-256 archive identities.', 'INVALID_ARGUMENT');
    ids = new Set(input.archive_ids);
    for (const id of ids) requireThat(state.archives.some(a => a.id === id), `Unknown archive: ${id}`, 'ENOENT');
  }
  if (input.refs !== undefined) {
    requireThat(Array.isArray(input.refs), 'refs must be an array.', 'INVALID_ARGUMENT');
    refs = new Set(input.refs.map(ref => reference(root, ref)));
    for (const ref of refs) canonicalRecord(root, ref);
  }
  return [...state.records.values()].filter(r => (!ids || ids.has(r.archiveId)) && (!refs || refs.has(r.ref)));
}
function plan(root, input) {
  const state = catalog(root), files = new Set(); walk(root, STORE, files);
  let refs;
  if (input.refs !== undefined) {
    requireThat(Array.isArray(input.refs), 'refs must be an array.', 'INVALID_ARGUMENT');
    refs = [...new Set(input.refs.map(ref => reference(root, ref)))].sort();
    for (const ref of refs) { canonicalRecord(root, ref); requireThat(files.has(ref) || state.records.has(ref), `Record not found: ${ref}`, 'ENOENT'); }
  } else refs = [...files].filter(candidate).sort();
  const candidates = [];
  for (const ref of refs) {
    if (state.records.has(ref)) { validateLoose(root, state.records.get(ref)); continue; }
    const metadata = fileDigest(root, ref); expectedContentName(ref, metadata.sha256);
    candidates.push({ ref, ...metadata });
  }
  return { state, candidates };
}
function writeNew(root, ref, bytes) {
  const fd = openFile(root, ref, 'wx');
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function writeArchive(root, candidates, stage) {
  ensureDir(root, stage);
  const segments = []; let current = null;
  function begin() {
    requireThat(segments.length < MAX_SEGMENTS, 'Archive segment count exceeds its bound.', 'ARCHIVE_LIMIT');
    const suffix = String(segments.length).padStart(6, '0'), pack = `pack-${suffix}.bin`, index = `index-${suffix}.json`;
    const fd = openFile(root, `${stage}/${pack}`, 'wx'); fs.writeFileSync(fd, MAGIC);
    current = { pack, index, fd, bytes: MAGIC.length, rawBytes: 0, metadataBytes: 0, hash: createHash('sha256').update(MAGIC), records: [] };
  }
  function finish() {
    if (!current) return;
    const c = current;
    fs.fsyncSync(c.fd); fs.closeSync(c.fd); c.fd = null;
    const packSha = c.hash.digest('hex'), indexBytes = json({ version: 1, pack: { ref: c.pack, size: c.bytes, sha256: packSha }, records: c.records });
    requireThat(indexBytes.length <= ARCHIVE_LIMITS.indexBytes, 'Archive index exceeds its bound.', 'ARCHIVE_LIMIT');
    writeNew(root, `${stage}/${c.index}`, indexBytes);
    segments.push({ index: c.index, size: indexBytes.length, sha256: hash(indexBytes), pack: c.pack, pack_size: c.bytes,
      pack_sha256: packSha, first_ref: c.records[0].ref, last_ref: c.records.at(-1).ref }); current = null;
  }
  try {
    for (const record of candidates) {
      const fd = openFile(root, record.ref), original = fs.fstatSync(fd), h = createHash('sha256');
      try {
        requireThat(sameStat(original, record.stat), `Source changed before archiving: ${record.ref}`, 'SOURCE_CHANGED');
        let rawOffset = 0;
        do {
          const raw = readExactly(fd, Math.min(ARCHIVE_LIMITS.chunkBytes, record.size - rawOffset), rawOffset);
          const compressed = deflateRawSync(raw), chunkSha = hash(raw), compressedSha = hash(compressed); h.update(raw);
          if (!current) begin();
          const previous = current.records.at(-1), newEntry = !previous || previous.ref !== record.ref;
          if (current.rawBytes + raw.length > ARCHIVE_LIMITS.packRawBytes || (newEntry && current.records.length >= ARCHIVE_LIMITS.recordsPerPack)
            || current.metadataBytes + Buffer.byteLength(record.ref) + 512 > ARCHIVE_LIMITS.indexBytes - 4096) { finish(); begin(); }
          let entry = current.records.at(-1);
          if (!entry || entry.ref !== record.ref) { entry = { ref: record.ref, size: record.size, sha256: record.sha256, chunks: [] }; current.records.push(entry); current.metadataBytes += Buffer.byteLength(record.ref) + 160; }
          const header = json({ ref: record.ref, size: record.size, record_sha256: record.sha256, rawOffset, rawLength: raw.length,
            length: compressed.length, sha256: chunkSha, compressedSha256: compressedSha });
          requireThat(header.length <= MAX_HEADER, 'Chunk header exceeds its bound.', 'ARCHIVE_LIMIT');
          const length = Buffer.alloc(4); length.writeUInt32BE(header.length);
          const chunk = { offset: current.bytes, length: compressed.length, headerLength: header.length, rawOffset,
            rawLength: raw.length, sha256: chunkSha, compressedSha256: compressedSha };
          for (const bytes of [length, header, compressed]) { fs.writeFileSync(current.fd, bytes); current.hash.update(bytes); current.bytes += bytes.length; }
          current.rawBytes += raw.length; current.metadataBytes += JSON.stringify(chunk).length + 1; entry.chunks.push(chunk); rawOffset += raw.length;
        } while (rawOffset < record.size);
        requireThat(h.digest('hex') === record.sha256 && sameStat(original, fs.fstatSync(fd)), `Source changed while archiving: ${record.ref}`, 'SOURCE_CHANGED');
      } finally { fs.closeSync(fd); }
    }
    finish();
    const manifestBytes = json({ version: 1, format: 'workflow-record-archive', chunk_size: ARCHIVE_LIMITS.chunkBytes, segments });
    requireThat(manifestBytes.length <= ARCHIVE_LIMITS.manifestBytes, 'Archive manifest exceeds its bound.', 'ARCHIVE_LIMIT');
    writeNew(root, `${stage}/manifest.json`, manifestBytes); syncDir(root, stage);
    return hash(manifestBytes);
  } finally { if (current?.fd !== null && current?.fd !== undefined) fs.closeSync(current.fd); }
}
function physicalSnapshot(root, state) {
  return state.archives.flatMap(a => a.physical_files.map(f => ({ ref: f.ref, stat: fs.lstatSync(local(root, f.ref)) })));
}
function unchanged(root, files) {
  for (const f of files) requireThat(sameStat(f.stat, fs.lstatSync(local(root, f.ref))), `Archive changed since verification: ${f.ref}`, 'SOURCE_CHANGED');
}
function verifiedState(root) {
  const state = catalog(root), signatures = physicalSnapshot(root, state);
  fullVerify(root, state); unchanged(root, signatures);
  return { state, signatures };
}
function createArchive(root, input) {
  const { candidates } = plan(root, input);
  if (!candidates.length) return { status: 'nothing-to-archive', archived: 0, originals_retained: true, archive_ids: [] };
  const stage = `${STAGING}/${randomUUID()}`;
  let activated = false;
  try {
    const id = writeArchive(root, candidates, stage);
    const archive = loadArchive(root, id, null, newMetrics(), stage);
    fullVerify(root, { archives: [archive] });
    withLock(root, () => {
      const existing = catalog(root);
      requireThat(existing.archives.length + 1 <= ARCHIVE_LIMITS.archiveCount, 'Activation would exceed the archive-count bound.', 'ARCHIVE_CATALOG_LIMIT');
      const addedMetadata = archive.physical_files.filter(f => f.kind !== 'pack').reduce((n, f) => n + f.size, 0);
      requireThat(existing.metrics.metadata_bytes_examined + addedMetadata <= ARCHIVE_LIMITS.catalogBytes,
        'Activation would exceed the catalogue metadata bound; existing archives were not changed.', 'ARCHIVE_CATALOG_LIMIT');
      for (const record of candidates) {
        requireThat(!existing.records.has(record.ref), `Record was archived concurrently; retry: ${record.ref}`, 'STORE_CHANGED');
        requireThat(sameStat(record.stat, fs.lstatSync(local(root, record.ref))), `Source changed before activation: ${record.ref}`, 'SOURCE_CHANGED');
      }
      ensureDir(root, ARCHIVES);
      requireThat(!statMaybe(root, `${ARCHIVES}/${id}`), 'Archive destination already exists.', 'STORE_CHANGED');
      fs.renameSync(local(root, stage), local(root, `${ARCHIVES}/${id}`)); activated = true;
      syncDir(root, ARCHIVES); syncDir(root, STAGING);
    });
    return { status: 'archived', archived: candidates.length, archive_ids: [id], originals_retained: true,
      raw_bytes: candidates.reduce((sum, r) => sum + r.size, 0), inventory: archiveInventory(root, { verify: true }) };
  } finally { if (!activated && statMaybe(root, stage)) fs.rmSync(local(root, stage), { recursive: true }); }
}
function quarantineArchive(root, input) {
  const { state, signatures } = verifiedState(root), records = selection(root, input, state);
  let moved = 0;
  withLock(root, () => {
    unchanged(root, signatures);
    for (const record of records) {
      const source = statMaybe(root, record.ref), targetRef = quarantineRef(record), target = statMaybe(root, targetRef);
      if (target) { const actual = fileDigest(root, targetRef); requireThat(actual.size === record.size && actual.sha256 === record.sha256, `Quarantine bytes differ: ${targetRef}`, 'QUARANTINE_CORRUPT'); }
      if (!source) continue;
      validateLoose(root, record);
      const marker = `${QUARANTINE}/${record.archiveId}/quarantine.json`;
      if (!immutableFile(root, marker, json({ version: 1, archiveId: record.archiveId }))) {
        const saved = parsed(smallFile(root, marker, 16384), marker); requireThat(saved.version === 1 && saved.archiveId === record.archiveId, 'Invalid quarantine marker.');
      }
      ensureDir(root, path.posix.dirname(targetRef));
      if (!target) fs.linkSync(local(root, record.ref), local(root, targetRef));
      syncDir(root, path.posix.dirname(targetRef));
      requireThat(sameStat(source, fs.lstatSync(local(root, record.ref))) || (() => { const now = fileDigest(root, record.ref); return now.size === record.size && now.sha256 === record.sha256; })(), 'Loose record changed during quarantine.', 'SOURCE_CHANGED');
      fs.unlinkSync(local(root, record.ref)); syncDir(root, path.posix.dirname(record.ref)); moved++;
    }
  });
  return { status: 'quarantined', quarantined: moved, originals_retained: true, inventory: archiveInventory(root, { verify: true }) };
}
function restoreArchive(root, input) {
  const { state } = verifiedState(root), records = selection(root, input, state); let restored = 0;
  for (const record of records) {
    if (statMaybe(root, record.ref)) { validateLoose(root, record); continue; }
    ensureDir(root, STAGING);
    const temp = `${STAGING}/restore-${randomUUID()}.tmp`, fd = openFile(root, temp, 'wx'), h = createHash('sha256');
    try {
      try { for (const chunk of record.chunks) { const bytes = chunkBytes(root, record, chunk, newMetrics()); fs.writeFileSync(fd, bytes); h.update(bytes); } fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      requireThat(h.digest('hex') === record.sha256, 'Restored record digest differs.');
      withLock(root, () => {
        if (statMaybe(root, record.ref)) { validateLoose(root, record); return; }
        const current = catalog(root, record.ref).records.get(record.ref);
        requireThat(current?.sha256 === record.sha256 && current.size === record.size, 'Archive changed before restore.', 'SOURCE_CHANGED');
        ensureDir(root, path.posix.dirname(record.ref)); fs.linkSync(local(root, temp), local(root, record.ref));
        syncDir(root, path.posix.dirname(record.ref)); restored++;
      });
    } finally { fs.unlinkSync(local(root, temp)); }
  }
  return { status: 'restored', restored, archives_retained: true };
}
function reclaimArchive(root, input) {
  requireThat(input.refs === undefined, 'reclaim operates on complete archive_ids; quarantine all their records first.', 'INVALID_ARGUMENT');
  const { state, signatures } = verifiedState(root), records = selection(root, input, state);
  const ids = [...new Set(records.map(r => r.archiveId))]; let reclaimed = 0, reclaimedBytes = 0;
  withLock(root, () => {
    unchanged(root, signatures);
    const proof = quarantineProof(root, state), proven = new Set(proof.map(r => r.ref));
    for (const record of records) requireThat(!statMaybe(root, record.ref) && proven.has(record.ref), `Record must be explicitly quarantined before reclaim: ${record.ref}`, 'QUARANTINE_REQUIRED');
    // Persist intent only after every selected byte has a verified immutable archive.
    // A crash between the receipt and unlink is resumed safely by this same action.
    for (const id of ids) immutableFile(root, `${QUARANTINE}/${id}/reclaimed.json`, json({ version: 1, archiveId: id, scope: 'all-records' }));
    for (const record of records) {
      const ref = quarantineRef(record); if (!statMaybe(root, ref)) continue;
      const actual = fileDigest(root, ref); requireThat(actual.size === record.size && actual.sha256 === record.sha256, `Quarantine bytes differ: ${ref}`, 'QUARANTINE_CORRUPT');
      fs.unlinkSync(local(root, ref)); syncDir(root, path.posix.dirname(ref)); reclaimed++; reclaimedBytes += record.size;
    }
  });
  return { status: 'reclaimed', reclaimed, reclaimed_bytes: reclaimedBytes, recoverable_from_archives: true,
    inventory: archiveInventory(root, { verify: true }) };
}
export function archiveCommand(root, input = {}) {
  switch (input.action ?? 'plan') {
    case 'plan': {
      const { candidates, state } = plan(root, input);
      return { status: 'planned', candidates: candidates.map(({ stat, ...record }) => record), count: candidates.length,
        raw_bytes: candidates.reduce((n, r) => n + r.size, 0), existing_archives: state.archives.length,
        originals_retained: true, limits: ARCHIVE_LIMITS };
    }
    case 'create': return createArchive(root, input);
    case 'verify': return { status: 'verified', ...archiveInventory(root, { verify: true }) };
    case 'quarantine': return quarantineArchive(root, input);
    case 'reclaim': return reclaimArchive(root, input);
    case 'restore': return restoreArchive(root, input);
    case 'recover-lock': return recoverLock(root, input);
    default: throw error('INVALID_ARGUMENT', 'archive action must be plan, create, verify, quarantine, reclaim, restore, or recover-lock.');
  }
}
