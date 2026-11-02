// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
// Dependency-free deterministic ZIP32 reader and writer (store mode only).
import { createHash } from "node:crypto";

export const FIXED_TIME = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));

function dosStamps(date) {
  const stamp = ((date.getUTCFullYear() - 1980) << 9) | (date.getUTCMonth() + 1) << 5 | date.getUTCDate();
  const clock = date.getUTCHours() << 11 | date.getUTCMinutes() << 5 | Math.floor(date.getUTCSeconds() / 2);
  return { stamp, clock };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let row = i;
    for (let k = 0; k < 8; k++) row = row & 1 ? 0xedb88320 ^ (row >>> 1) : row >>> 1;
    table[i] = row >>> 0;
  }
  return table;
})();

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

const UNIX_MODE_SHIFT = 16;

function modeFor(entry) {
  if (entry.mode === undefined || entry.mode === null) return 0o644;
  return entry.mode & 0o777;
}

export function writeZip(entries) {
  const { stamp, clock } = dosStamps(FIXED_TIME);
  const bodyParts = [];
  const centralRows = [];
  let offset = 0;
  for (const entry of entries) {
    const directory = Boolean(entry.isDirectory === true || entry.name.endsWith("/"));
    if (entry.isDirectory === false && directory) {
      throw new Error(`directory flag and name disagree: ${entry.name}`);
    }
    const name = Buffer.from(entry.name, "utf8");
    const raw = entry.isDirectory ? Buffer.alloc(0) : Buffer.from(entry.data, "utf8");
    const mode = modeFor(entry);
    const external = ((0o100000 | mode) << UNIX_MODE_SHIFT | (entry.isDirectory ? 0x10 : 0)) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(clock, 10);
    local.writeUInt16LE(stamp, 12);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(raw.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    bodyParts.push(local, name, raw);
    centralRows.push({ name, offset, size: raw.length, external, crc: crc32(raw) });
    offset += local.length + name.length + raw.length;
  }
  const centralStart = offset;
  const centralParts = [];
  for (const row of centralRows) {
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(0, 10);
    record.writeUInt16LE(clock, 12);
    record.writeUInt16LE(stamp, 14);
    record.writeUInt32LE(row.crc, 16);
    record.writeUInt32LE(row.size, 20);
    record.writeUInt32LE(row.size, 24);
    record.writeUInt16LE(row.name.length, 28);
    record.writeUInt16LE(0, 30);
    record.writeUInt16LE(0, 32);
    record.writeUInt16LE(0, 34);
    record.writeUInt16LE(0, 36);
    record.writeUInt32LE(row.external, 38);
    record.writeUInt32LE(row.offset, 42);
    centralParts.push(record, row.name);
    offset += record.length + row.name.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(centralRows.length, 8);
  end.writeUInt16LE(centralRows.length, 10);
  end.writeUInt32LE(offset - centralStart, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...bodyParts, ...centralParts, end]);
}

// Spec-strict store-mode reader used for verification round-trips.
export function readZip(buffer) {
  if (buffer.length < 22 || buffer.readUInt32LE(buffer.length - 22) !== 0x06054b50) {
    throw new Error("archive has no end-of-central-directory record at the expected offset");
  }
  const eocd = buffer.length - 22;
  const count = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralStart = buffer.readUInt32LE(eocd + 16);
  if (centralStart + centralSize !== eocd) throw new Error("central directory does not abut the end record");
  const entries = [];
  let cursor = centralStart;
  for (let index = 0; index < count; index++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("bad central directory signature");
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const size = buffer.readUInt32LE(cursor + 20);
    const compressed = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    if (flags !== 0x0800 && flags !== 0) throw new Error(`unexpected flags in archive entry ${index}`);
    if (method !== 0) throw new Error(`entry ${index} is not stored`);
    if (size !== compressed) throw new Error(`entry ${index} has divergent stored sizes`);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    cursor += 46 + nameLength + extraLength + commentLength;
    // local header
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const localName = buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString("utf8");
    if (localName !== name) throw new Error(`name mismatch between local and central records for ${name}`);
    const localSize = buffer.readUInt32LE(localOffset + 18);
    const localCrc = buffer.readUInt32LE(localOffset + 14);
    if (localSize !== size) throw new Error(`size mismatch between local and central records for ${name}`);
    if (localCrc !== crc) throw new Error(`crc mismatch between local and central records for ${name}`);
    const payloadStart = localOffset + 30 + localNameLength + localExtraLength;
    const payload = buffer.subarray(payloadStart, payloadStart + size);
    if (crc32(payload) !== crc) throw new Error(`payload checksum mismatch for ${name}`);
    entries.push({
      name,
      data: payload.subarray(),
      size,
      mode: (externalAttributes >> UNIX_MODE_SHIFT) & 0o777,
      directory: Boolean(externalAttributes & 0x10)
    });
  }
  if (cursor !== centralStart + centralSize) throw new Error("central directory length mismatch");
  return entries;
}
