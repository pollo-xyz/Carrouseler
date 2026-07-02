import { describe, it, expect } from 'vitest'
import { createZip, readZip } from './zip'

async function zipToBytes(files: { name: string; data: Blob }[]): Promise<Uint8Array> {
  const blob = await createZip(files)
  return new Uint8Array(await blob.arrayBuffer())
}

describe('createZip / readZip round-trip', () => {
  it('round-trips a single text file', async () => {
    const bytes = await zipToBytes([
      { name: 'project.json', data: new Blob(['{"hello":"world"}']) },
    ])
    const entries = readZip(bytes)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('project.json')
    expect(new TextDecoder().decode(entries[0]!.data)).toBe('{"hello":"world"}')
  })

  it('round-trips multiple files including binary data and nested paths', async () => {
    const binary = new Uint8Array(4096)
    for (let i = 0; i < binary.length; i++) binary[i] = i % 256
    const bytes = await zipToBytes([
      { name: 'project.json', data: new Blob(['{}']) },
      { name: 'assets/a1.png', data: new Blob([binary]) },
      { name: 'assets/a2.bin', data: new Blob([new Uint8Array([0, 255, 128])]) },
    ])
    const entries = readZip(bytes)
    expect(entries.map((e) => e.name)).toEqual(['project.json', 'assets/a1.png', 'assets/a2.bin'])
    expect(entries[1]!.data).toEqual(binary)
    expect(entries[2]!.data).toEqual(new Uint8Array([0, 255, 128]))
  })

  it('round-trips non-ASCII file names', async () => {
    const bytes = await zipToBytes([
      { name: 'assets/ñandú ütf✓.bin', data: new Blob([new Uint8Array([1, 2, 3])]) },
    ])
    const entries = readZip(bytes)
    expect(entries[0]!.name).toBe('assets/ñandú ütf✓.bin')
  })

  it('round-trips empty files', async () => {
    const bytes = await zipToBytes([{ name: 'empty.txt', data: new Blob([]) }])
    const entries = readZip(bytes)
    expect(entries[0]!.data).toHaveLength(0)
  })

  it('produces a blob with the local-file-header magic at offset 0', async () => {
    const bytes = await zipToBytes([{ name: 'a', data: new Blob(['x']) }])
    // PK\x03\x04
    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
  })
})

describe('readZip error handling', () => {
  it('throws on garbage input', () => {
    const junk = new Uint8Array(100).fill(0xab)
    expect(() => readZip(junk)).toThrow(/end-of-central-directory/)
  })

  it('throws on input too short to be a zip', () => {
    expect(() => readZip(new Uint8Array(4))).toThrow(/end-of-central-directory/)
  })

  it('throws when a central directory entry is corrupted', async () => {
    const bytes = await zipToBytes([{ name: 'a.txt', data: new Blob(['hi']) }])
    // The central directory starts after the local header (30 + 5 name+data... )
    // Corrupt the CD signature: find it and flip a byte.
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let i = 0; i < bytes.length - 4; i++) {
      if (dv.getUint32(i, true) === 0x02014b50) {
        bytes[i] = 0x00
        break
      }
    }
    expect(() => readZip(bytes)).toThrow(/bad central directory/)
  })
})
