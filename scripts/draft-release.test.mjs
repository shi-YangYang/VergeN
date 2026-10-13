import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { run } from './draft-release.mjs'

const env = {
  RELEASE_TAG: 'v0.1.1',
  ANDROID_VERSION_CODE: '9',
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
  body: `<!-- vergen-build:${env.GITHUB_SHA}:9 -->`,
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

test('prepare reuses a draft only for the same version, source, and Android code', async (t) => {
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
    { body: `<!-- vergen-build:${env.GITHUB_SHA}:10 -->` },
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

test('upload replaces only the matching draft asset and streams the actual installer', async (t) => {
  const directory = await workspace(t)
  await writeFile(join(directory, 'VergeN.apk'), 'installer fixture')
  await writeFile(join(directory, 'VergeN.apk.sig'), 'not an installer')
  const methods = []
  await run(['upload', directory], env, async (url, options) => {
    methods.push(options.method || 'GET')
    if (options.method === 'DELETE') {
      assert.ok(url.endsWith('/releases/assets/7'))
      return new Response(null, { status: 204 })
    }
    if (options.method === 'POST') {
      assert.equal(new URL(url).searchParams.get('name'), 'VergeN.apk')
      assert.ok(options.body instanceof Blob)
      assert.equal(await options.body.text(), 'installer fixture')
      assert.equal(options.headers['Content-Length'], '17')
      return json({ state: 'uploaded', size: 17 }, 201)
    }
    return url.includes('/assets?')
      ? json([
          { id: 7, name: 'VergeN.apk' },
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
