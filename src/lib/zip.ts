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

  return new Blob(parts, { type: 'application/zip' })
}
