import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

import { packageName } from './package-name.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const localEnvironment = path.join(root, '.env.build.local')
const env = {
  ...process.env,
  ...(fs.existsSync(localEnvironment)
    ? parseEnv(fs.readFileSync(localEnvironment, 'utf8'))
    : {}),
}
const [platform, versionArgument, versionCodeArgument, ...extra] =
  process.argv.slice(2)
const version = versionArgument?.replace(/^v/, '')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const run = (command, args, cwd = root) =>
  execFileSync(command, args, { cwd, env, stdio: 'inherit' })

function copyInstallers(files, platformName, arch = process.arch) {
  if (!files.length) throw new Error('No installer was produced')
  const output = path.join(root, 'release-local', version, platformName)
  fs.rmSync(output, { recursive: true, force: true })
  fs.mkdirSync(output, { recursive: true })
  for (const file of files) {
    const name = packageName(path.basename(file), version, arch)
    const destination = path.join(output, name)
    fs.copyFileSync(file, destination)
    console.log(`Package: ${destination}`)
  }
}

function desktop() {
  const target = {
    'darwin-arm64': 'aarch64-apple-darwin',
    'darwin-x64': 'x86_64-apple-darwin',
    'win32-x64': 'x86_64-pc-windows-msvc',
    'linux-x64': 'x86_64-unknown-linux-gnu',
  }[`${process.platform}-${process.arch}`]
  if (!target) {
    throw new Error(
      'Build on macOS, Windows x64, or Linux x64; cross-compilation is not configured',
    )
  }
  const versions = [
    JSON.parse(read('package.json')).version,
    JSON.parse(read('src-tauri/tauri.conf.json')).version,
    read('src-tauri/Cargo.toml').match(/^version = "([^"]+)"/m)?.[1],
    read('Cargo.lock').match(/name = "vergen"\r?\nversion = "([^"]+)"/)?.[1],
  ]
  if (versions.some((value) => value !== version)) {
    throw new Error(
      `Version fields differ. Run pnpm release-version ${version} first`,
    )
  }
  if (!/^https?:\/\//.test(env.VITE_ENTERPRISE_SERVER_URL ?? '')) {
    throw new Error(
      'Set VITE_ENTERPRISE_SERVER_URL in .env.build.local before packaging',
    )
  }
  const signedUpdates = env.VERGEN_BUILD_UPDATER === 'true'
  if (signedUpdates && !env.TAURI_SIGNING_PRIVATE_KEY) {
    throw new Error(
      'Signed updates require TAURI_SIGNING_PRIVATE_KEY matching the installed client public key',
    )
  }
  if (signedUpdates && !env.VITE_ENTERPRISE_SERVER_URL.startsWith('https://')) {
    throw new Error(
      'Signed updates require an HTTPS VITE_ENTERPRISE_SERVER_URL',
    )
  }
  Object.assign(env, {
    CARGO_PROFILE_RELEASE_CODEGEN_UNITS: '16',
    CARGO_PROFILE_RELEASE_DEBUG: '0',
    CARGO_PROFILE_RELEASE_STRIP: 'debuginfo',
    NODE_OPTIONS: env.NODE_OPTIONS || '--max-old-space-size=4096',
  })
  run(process.execPath, ['scripts/prebuild.mjs', target])
  const started = Date.now()
  run(process.execPath, [
    'node_modules/@tauri-apps/cli/tauri.js',
    'build',
    '--target',
    target,
    '--config',
    JSON.stringify({ bundle: { createUpdaterArtifacts: signedUpdates } }),
  ])
  const bundle = path.resolve(
    env.CARGO_TARGET_DIR || 'target',
    target,
    'release/bundle',
  )
  const patterns = ['dmg/*.dmg', 'nsis/*.exe', 'deb/*.deb', 'rpm/*.rpm']
  if (signedUpdates) {
    patterns.push(
      'nsis/*.exe.sig',
      'deb/*.deb.sig',
      'rpm/*.rpm.sig',
      'macos/*.app.tar.gz',
      'macos/*.app.tar.gz.sig',
    )
  }
  const files = fs
    .globSync(patterns, { cwd: bundle })
    .map((file) => path.join(bundle, file))
    .filter((file) => fs.statSync(file).mtimeMs >= started - 1000)
  if (signedUpdates) {
    const updates = files.filter((file) =>
      /\.(exe|deb|rpm|app\.tar\.gz)$/.test(file),
    )
    if (
      !updates.length ||
      updates.some((file) => !files.includes(`${file}.sig`))
    ) {
      throw new Error(
        'Signed update packages or their matching .sig files are missing',
      )
    }
    const publicKey = JSON.parse(read('src-tauri/tauri.conf.json')).plugins
      .updater.pubkey
    const packet = (encoded) =>
      Buffer.from(
        Buffer.from(encoded.trim(), 'base64')
          .toString('utf8')
          .trim()
          .split('\n')[1] ?? '',
        'base64',
      )
    const publicPacket = packet(publicKey)
    for (const file of updates) {
      const signaturePacket = packet(fs.readFileSync(`${file}.sig`, 'utf8'))
      if (
        publicPacket.length !== 42 ||
        signaturePacket.length !== 74 ||
        !publicPacket.subarray(2, 10).equals(signaturePacket.subarray(2, 10))
      ) {
        throw new Error(
          `Update signature does not match the client public key: ${path.basename(file)}`,
        )
      }
    }
  }
  copyInstallers(files, 'desktop')
}

function android() {
  const versionCode = Number(versionCodeArgument)
  if (
    !Number.isInteger(versionCode) ||
    versionCode < 1 ||
    versionCode > 2100000000
  ) {
    throw new Error(
      'Provide an Android versionCode from 1 to 2100000000, higher than every published APK',
    )
  }
  if (
    !/^remove\.suffix\s*=\s*true\s*$/m.test(read('android/local.properties'))
  ) {
    throw new Error(
      'Set remove.suffix=true in android/local.properties to keep io.github.vergen.android',
    )
  }
  for (const file of [
    'android/signing.properties',
    'android/release.keystore',
  ]) {
    if (!fs.existsSync(path.join(root, file))) {
      throw new Error(
        `Missing ${file}; restore the existing release signing key before packaging`,
      )
    }
  }
  if (env.JAVA_HOME) {
    env.PATH = `${path.join(env.JAVA_HOME, 'bin')}${path.delimiter}${env.PATH ?? env.Path ?? ''}`
    delete env.Path
  }
  const java = execFileSync('java', ['--version'], {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (!/^(?:openjdk|java) 21[.\s]/m.test(java)) {
    throw new Error('Set JAVA_HOME to JDK 21 in .env.build.local')
  }
  run(
    process.platform === 'win32' ? 'cmd.exe' : './gradlew',
    [
      ...(process.platform === 'win32' ? ['/d', '/c', 'gradlew.bat'] : []),
      ':app:assembleAlphaRelease',
      '--console=plain',
      `-PvergenVersionName=${version}`,
      `-PvergenVersionCode=${versionCode}`,
    ],
    path.join(root, 'android'),
  )
  const apkDirectory = path.join(
    root,
    'android/app/build/outputs/apk/alpha/release',
  )
  const metadata = JSON.parse(
    fs.readFileSync(path.join(apkDirectory, 'output-metadata.json'), 'utf8'),
  )
  const apk = metadata.elements.find((element) =>
    element.filters.some(
      (filter) => filter.filterType === 'ABI' && filter.value === 'arm64-v8a',
    ),
  )
  if (
    metadata.applicationId !== 'io.github.vergen.android' ||
    apk?.versionName !== version ||
    apk?.versionCode !== versionCode
  ) {
    throw new Error(
      'APK identity or version does not match the requested release',
    )
  }
  copyInstallers([path.join(apkDirectory, apk.outputFile)], 'android', 'arm64')
}

try {
  if (
    !['desktop', 'android'].includes(platform) ||
    !/^\d+\.\d+\.\d+$/.test(version ?? '') ||
    extra.length ||
    (platform === 'desktop' && versionCodeArgument)
  ) {
    throw new Error(
      'Usage: pnpm package:desktop <X.Y.Z> | pnpm package:android <X.Y.Z> <versionCode>',
    )
  }
  if (platform === 'desktop') desktop()
  else android()
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
