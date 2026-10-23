// electron-builder beforePack hook — swap in the ffmpeg binary that matches
// the arch being packed.
//
// ffmpeg-static downloads ONE binary for the host CPU at `npm ci` time. The
// macOS CI runner is arm64 but we also ship an x64 DMG/zip, which used to
// bundle the arm64 binary ("bad CPU type" → every video export failed on
// Intel Macs). Before each macOS pack we delete the binary and re-run
// ffmpeg-static's installer for the target arch (it honours npm_config_arch).
// Windows builds are single-arch (x64 on x64) and are left alone.

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

// electron-builder's Arch enum (builder-util): ia32=0, x64=1, armv7l=2, arm64=3, universal=4
const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'arm', 3: 'arm64' }

exports.default = async function beforePack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const arch = ARCH_NAMES[context.arch]
  if (!arch) throw new Error(`[before-pack] unsupported arch ${context.arch} for ffmpeg-static`)

  const pkgDir = path.dirname(require.resolve('ffmpeg-static/package.json'))
  const binary = path.join(pkgDir, 'ffmpeg')
  fs.rmSync(binary, { force: true })
  console.log(`[before-pack] fetching ffmpeg-static for darwin-${arch}`)
  execFileSync(process.execPath, [path.join(pkgDir, 'install.js')], {
    cwd: pkgDir,
    stdio: 'inherit',
    env: { ...process.env, npm_config_platform: 'darwin', npm_config_arch: arch },
  })
  if (!fs.existsSync(binary)) throw new Error(`[before-pack] ffmpeg for darwin-${arch} was not installed`)
}
