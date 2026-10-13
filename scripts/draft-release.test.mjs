import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { run } from './draft-release.mjs'
import { packageName, releaseAssetName } from './package-name.mjs'

const env = {
  RELEASE_TAG: 'v0.1.1',
  ANDROID_VERSION_CODE: '9',
  VERGEN_BUILD_UPDATER: 'false',
  GITHUB_SHA: 'a'.repeat(40),
  GITHUB_REPOSITORY: 'example/vergen',
  GITHUB_RUN_ID: '123',
  RELEASE_ID: '42',
  GH_TOKEN: 'test-token',
}
const draft = {
  id: 42,
  tag_name: env.RELEASE_TAG,
  target_commitish: env.GITHUB_SHA,
  body: `<!-- vergen-build:${env.GITHUB_SHA}:9:false -->`,
  draft: true,
  published_at: null,
  upload_url:
    'https://uploads.github.com/repos/example/vergen/releases/42/assets{?name,label}',
}
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status })

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'vergen-draft-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test('prepare creates an unpublished draft at the exact source commit', async (t) => {
  const directory = await workspace(t)
  const output = join(directory, 'output')
  const calls = []
  await run(
    ['prepare'],
    { ...env, GITHUB_OUTPUT: output },
    async (url, options) => {
      calls.push([url, options.method || 'GET'])
      if (url.includes('/git/ref/')) return json({}, 404)
      if (!options.method) return json([])
      const body = JSON.parse(options.body)
      assert.equal(body.draft, true)
      assert.equal(body.target_commitish, env.GITHUB_SHA)
      assert.equal(body.tag_name, env.RELEASE_TAG)
      assert.ok(body.body.includes(draft.body))
      return json({ ...draft, ...body }, 201)
    },
  )
  assert.equal(await readFile(output, 'utf8'), 'release_id=42\n')
  assert.deepEqual(
    calls.map(([, method]) => method),
    ['GET', 'GET', 'POST'],
  )
})

test('prepare reuses a draft only for the same version, source, Android code, and signing mode', async (t) => {
  const directory = await workspace(t)
  const output = join(directory, 'output')
  await run(
    ['prepare'],
    { ...env, GITHUB_OUTPUT: output },
    async (url, options) => {
      assert.equal(options.method, undefined)
      return url.includes('/git/ref/') ? json({}, 404) : json([draft])
    },
  )
  assert.equal(await readFile(output, 'utf8'), 'release_id=42\n')

  for (const changed of [
    { draft: false, published_at: '2026-10-13T00:00:00Z' },
    { target_commitish: 'b'.repeat(40) },
    { body: `<!-- vergen-build:${env.GITHUB_SHA}:10:false -->` },
    { body: `<!-- vergen-build:${env.GITHUB_SHA}:9 -->` },
  ]) {
    await assert.rejects(
      run(
        ['prepare'],
        { ...env, GITHUB_OUTPUT: output },
        async (url, options) => {
          assert.equal(options.method, undefined)
          return url.includes('/git/ref/')
            ? json({}, 404)
            : json([{ ...draft, ...changed }])
        },
      ),
      /published release|differs/,
    )
  }
})

test('prepare and upload refuse changed signing modes before mutating a draft', async (t) => {
  const directory = await workspace(t)
  await writeFile(join(directory, 'VergeN.exe'), 'installer fixture')
  for (const existingMode of ['true', 'false']) {
    const changedEnvironment = {
      ...env,
      VERGEN_BUILD_UPDATER: existingMode === 'true' ? 'false' : 'true',
      GITHUB_OUTPUT: join(directory, 'output'),
    }
    const existingDraft = {
      ...draft,
      body: `<!-- vergen-build:${env.GITHUB_SHA}:9:${existingMode} -->`,
    }
    for (const args of [['prepare'], ['upload', directory]]) {
      await assert.rejects(
        run(args, changedEnvironment, async (url, options) => {
          assert.equal(options.method, undefined)
          if (url.includes('/git/ref/')) return json({}, 404)
          return json(args[0] === 'prepare' ? [existingDraft] : existingDraft)
        }),
        /signing mode differs/,
      )
    }
  }
})

test('prepare refuses a pre-existing Git tag without creating or changing a release', async () => {
  await assert.rejects(
    run(
      ['prepare'],
      { ...env, GITHUB_OUTPUT: 'unused' },
      async (url, options) => {
        assert.ok(url.endsWith('/git/ref/tags/v0.1.1'))
        assert.equal(options.method, undefined)
        return json({ ref: 'refs/tags/v0.1.1' })
      },
    ),
    /Git tag already exists/,
  )
})

test('upload keeps the Chinese label and replaces only the matching ASCII asset', async (t) => {
  const directory = await workspace(t)
  const name = 'VergeN_0.1.1_安卓_ARM64_安装包.apk'
  const assetName = 'VergeN_0.1.1_Android_ARM64_setup.apk'
  await writeFile(join(directory, name), 'installer fixture')
  await writeFile(join(directory, 'VergeN.apk.sig'), 'not an installer')
  const methods = []
  await run(['upload', directory], env, async (url, options) => {
    methods.push(options.method || 'GET')
    if (options.method === 'DELETE') {
      assert.ok(url.endsWith('/releases/assets/7'))
      return new Response(null, { status: 204 })
    }
    if (options.method === 'POST') {
      assert.equal(new URL(url).searchParams.get('name'), assetName)
      assert.equal(new URL(url).searchParams.get('label'), name)
      assert.ok(options.body instanceof Blob)
      assert.equal(await options.body.text(), 'installer fixture')
      assert.equal(options.headers['Content-Length'], '17')
      return json({ name: assetName, state: 'uploaded', size: 17 }, 201)
    }
    return url.includes('/assets?')
      ? json([
          { id: 7, name: assetName },
          { id: 8, name: 'VergeN.dmg' },
        ])
      : json(draft)
  })
  assert.deepEqual(methods, ['GET', 'GET', 'DELETE', 'POST'])
})

test('upload refuses a published release and absent or empty installer files', async (t) => {
  const directory = await workspace(t)
  const noRequest = async () => assert.fail('No network request expected')
  await assert.rejects(
    run(['upload', directory], env, noRequest),
    /No installer files/,
  )
  await writeFile(join(directory, 'VergeN.apk'), '')
  await assert.rejects(
    run(['upload', directory], env, noRequest),
    /Installer is empty/,
  )
  await writeFile(join(directory, 'VergeN.apk'), 'installer')
  await assert.rejects(
    run(['upload', directory], env, async (_url, options) => {
      assert.equal(options.method, undefined)
      return json({ ...draft, draft: false })
    }),
    /published release/,
  )
})

test('upload keeps signed desktop updates and their matching signatures', async (t) => {
  const directory = await workspace(t)
  const names = [
    'VergeN_0.1.1_苹果电脑_ARM64_升级包.app.tar.gz',
    'VergeN_0.1.1_苹果电脑_ARM64_升级包.app.tar.gz.sig',
    'VergeN_0.1.1_Windows_x64_安装及升级包.exe',
    'VergeN_0.1.1_Windows_x64_安装及升级包.exe.sig',
    'VergeN_0.1.1_Linux_x64_安装及升级包.deb',
    'VergeN_0.1.1_Linux_x64_安装及升级包.deb.sig',
    'VergeN_0.1.1_Linux_x64_安装及升级包.rpm',
    'VergeN_0.1.1_Linux_x64_安装及升级包.rpm.sig',
  ]
  const contents = new Map()
  for (const name of [...names, 'private.key', 'build.log']) {
    const bytes = Buffer.from(`\0${name}\nfixture\xff`, 'utf8')
    contents.set(name, bytes)
    await writeFile(join(directory, name), bytes)
  }
  const uploaded = []
  await run(
    ['upload', directory],
    { ...env, VERGEN_BUILD_UPDATER: 'true' },
    async (url, options) => {
      if (options.method === 'POST') {
        const query = new URL(url).searchParams
        const name = query.get('label')
        const assetName = query.get('name')
        uploaded.push(name)
        assert.equal(assetName, releaseAssetName(name))
        assert.match(assetName, /^[\x20-\x7e]+$/)
        assert.deepEqual(
          Buffer.from(await options.body.arrayBuffer()),
          contents.get(name),
        )
        return json(
          {
            name: assetName,
            state: 'uploaded',
            size: contents.get(name).length,
          },
          201,
        )
      }
      return url.includes('/assets?')
        ? json([])
        : json({
            ...draft,
            body: `<!-- vergen-build:${env.GITHUB_SHA}:9:true -->`,
          })
    },
  )
  assert.deepEqual(uploaded, names.sort())
})

test('package names identify the platform and keep signature pairs together', () => {
  for (const [file, arch, name] of [
    ['VergeN.exe', 'x64', 'Windows_x64_安装及升级包.exe'],
    ['VergeN.dmg', 'arm64', '苹果电脑_ARM64_安装包.dmg'],
    ['VergeN.app.tar.gz', 'arm64', '苹果电脑_ARM64_升级包.app.tar.gz'],
    ['VergeN.deb', 'x64', 'Linux_x64_安装及升级包.deb'],
    ['VergeN.rpm', 'x64', 'Linux_x64_安装及升级包.rpm'],
    ['VergeN.apk', 'arm64', '安卓_ARM64_安装包.apk'],
  ]) {
    const expected = `VergeN_0.1.1_${name}`
    assert.equal(packageName(file, '0.1.1', arch), expected)
    assert.equal(packageName(`${file}.sig`, '0.1.1', arch), `${expected}.sig`)
    assert.equal(
      releaseAssetName(`${expected}.sig`),
      `${releaseAssetName(expected)}.sig`,
    )
  }
})
