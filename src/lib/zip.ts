/**
 * Minimal ZIP builder — no dependencies.
 * Creates an uncompressed (STORE) zip from a list of named blobs.
 */

function crc32(data: Uint8Array): number {
  let crc = -1
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]!
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return ~crc >>> 0
}

export async function createZip(
  files: { name: string; data: Blob }[],
): Promise<Blob> {
  const parts: Uint8Array[] = []
  const directory: {
    name: string
    offset: number
    crc: number
    size: number
  }[] = []

  let offset = 0

  for (const file of files) {
    const data = new Uint8Array(await file.data.arrayBuffer())
    const nameBytes = new TextEncoder().encode(file.name)
    const crc = crc32(data)

    // Local file header (30 bytes + name)
    const header = new Uint8Array(30 + nameBytes.length)
    const hv = new DataView(header.buffer)
    hv.setUint32(0, 0x04034b50, true) // local file header signature
    hv.setUint16(4, 20, true) // version needed to extract
    hv.setUint16(6, 0, true) // general purpose bit flag
    hv.setUint16(8, 0, true) // compression method: STORE
    hv.setUint16(10, 0, true) // last mod file time
    hv.setUint16(12, 0, true) // last mod file date
    hv.setUint32(14, crc, true) // crc-32
    hv.setUint32(18, data.length, true) // compressed size
    hv.setUint32(22, data.length, true) // uncompressed size
    hv.setUint16(26, nameBytes.length, true) // file name length
    hv.setUint16(28, 0, true) // extra field length
    header.set(nameBytes, 30)

    parts.push(header)
    parts.push(data)

    directory.push({ name: file.name, offset, crc, size: data.length })
    offset += header.length + data.length
  }

  const cdOffset = offset

  // Central directory entries
  for (const entry of directory) {
    const nameBytes = new TextEncoder().encode(entry.name)
    const rec = new Uint8Array(46 + nameBytes.length)
    const rv = new DataView(rec.buffer)
    rv.setUint32(0, 0x02014b50, true) // central directory header signature
    rv.setUint16(4, 20, true) // version made by
    rv.setUint16(6, 20, true) // version needed to extract
    rv.setUint16(8, 0, true) // general purpose bit flag
    rv.setUint16(10, 0, true) // compression method: STORE
    rv.setUint16(12, 0, true) // last mod file time
    rv.setUint16(14, 0, true) // last mod file date
    rv.setUint32(16, entry.crc, true) // crc-32
    rv.setUint32(20, entry.size, true) // compressed size
    rv.setUint32(24, entry.size, true) // uncompressed size
    rv.setUint16(28, nameBytes.length, true) // file name length
    rv.setUint16(30, 0, true) // extra field length
    rv.setUint16(32, 0, true) // file comment length
    rv.setUint16(34, 0, true) // disk number start
    rv.setUint16(36, 0, true) // internal file attributes
    rv.setUint32(38, 0, true) // external file attributes
    rv.setUint32(42, entry.offset, true) // relative offset of local header
    rec.set(nameBytes, 46)
    parts.push(rec)
    offset += rec.length
  }

  const cdSize = offset - cdOffset

  // End of central directory record
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true) // end of central dir signature
  ev.setUint16(4, 0, true) // number of this disk
  ev.setUint16(6, 0, true) // disk where central directory starts
  ev.setUint16(8, directory.length, true) // entries in central directory on this disk
  ev.setUint16(10, directory.length, true) // total entries in central directory
  ev.setUint32(12, cdSize, true) // size of central directory
  ev.setUint32(16, cdOffset, true) // offset of start of central directory
  ev.setUint16(20, 0, true) // comment length
  parts.push(end)

  return new Blob(parts as BlobPart[], { type: 'application/zip' })
}

export interface ZipEntry {
  name: string
  data: Uint8Array
}

/**
 * Minimal STORE-only ZIP reader. Supports the format produced by createZip
 * above (no compression, no encryption, no zip64). Throws on malformed input
 * or any compressed entry.
 */
export function readZip(buffer: Uint8Array): ZipEntry[] {
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  // Find End of Central Directory Record. Scan from the end; comment is usually empty.
  const EOCD_SIG = 0x06054b50
  let eocdOffset = -1
  const maxScan = Math.min(buffer.length, 65557) // 22 + 65535 max comment
  for (let i = buffer.length - 22; i >= buffer.length - maxScan && i >= 0; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset < 0) throw new Error('readZip: no end-of-central-directory found')

  const cdEntries = dv.getUint16(eocdOffset + 10, true)
  const cdOffset = dv.getUint32(eocdOffset + 16, true)

  const entries: ZipEntry[] = []
  let p = cdOffset
  const CD_SIG = 0x02014b50
  const LFH_SIG = 0x04034b50

  for (let i = 0; i < cdEntries; i++) {
    if (dv.getUint32(p, true) !== CD_SIG) throw new Error('readZip: bad central directory entry')
    const compression = dv.getUint16(p + 10, true)
    const compSize = dv.getUint32(p + 20, true)
    const uncompSize = dv.getUint32(p + 24, true)
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const commentLen = dv.getUint16(p + 32, true)
    const localOffset = dv.getUint32(p + 42, true)
    if (compression !== 0) throw new Error('readZip: only STORE compression is supported')
    if (compSize !== uncompSize) throw new Error('readZip: size mismatch on STORE entry')

    const name = new TextDecoder().decode(buffer.subarray(p + 46, p + 46 + nameLen))

    // Jump to local file header to find the actual data offset
    if (dv.getUint32(localOffset, true) !== LFH_SIG) throw new Error('readZip: bad local header')
    const lhNameLen = dv.getUint16(localOffset + 26, true)
    const lhExtraLen = dv.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + lhNameLen + lhExtraLen
    const data = buffer.subarray(dataStart, dataStart + uncompSize)

    entries.push({ name, data })
    p += 46 + nameLen + extraLen + commentLen
  }

  return entries
}
