import { openAsBlob } from 'node:fs'
import { appendFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function run(args, env = process.env, fetchAPI = fetch) {
  const [command, directory] = args
  if (
    (command !== 'prepare' && command !== 'upload') ||
    args.length !== (command === 'prepare' ? 1 : 2)
  ) {
    throw new Error('Usage: draft-release.mjs prepare | upload <directory>')
  }

  const tag = env.RELEASE_TAG
  const code = env.ANDROID_VERSION_CODE
  const sha = env.GITHUB_SHA
  const repository = env.GITHUB_REPOSITORY
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag ?? '')) {
    throw new Error('RELEASE_TAG must be vX.Y.Z, for example v0.1.1')
  }
  if (!/^[1-9]\d*$/.test(code ?? '') || Number(code) > 2100000000) {
    throw new Error(
      'ANDROID_VERSION_CODE must be an integer from 1 to 2100000000',
    )
  }
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) {
    throw new Error('GITHUB_SHA must be the full source commit SHA')
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !env.GH_TOKEN) {
    throw new Error('GITHUB_REPOSITORY and GH_TOKEN are required')
  }

  const api = env.GITHUB_API_URL || 'https://api.github.com'
  const base = `${api}/repos/${repository}`
  const marker = `<!-- vergen-build:${sha}:${code} -->`

  async function request(url, options = {}, missingOK = false) {
    const response = await fetchAPI(url, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${env.GH_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...options.headers,
      },
      signal: AbortSignal.timeout(
        options.body instanceof Blob ? 1800000 : 60000,
      ),
    })
    if (missingOK && response.status === 404) return null
    if (!response.ok) {
      throw new Error(
        `GitHub API ${options.method || 'GET'} failed: HTTP ${response.status}`,
      )
    }
    return response.status === 204 ? null : response.json()
  }

  async function list(url) {
    const entries = []
    for (let page = 1; ; page++) {
      const batch = await request(`${url}?per_page=100&page=${page}`)
      entries.push(...batch)
      if (batch.length < 100) return entries
    }
  }

  function assertDraft(release) {
    if (release.draft !== true || release.published_at) {
      throw new Error('Refusing to modify a published release')
    }
    if (
      release.tag_name !== tag ||
      release.target_commitish !== sha ||
      !release.body?.includes(marker)
    ) {
      throw new Error(
        'Draft version, source commit, or Android versionCode differs; use a new version',
      )
    }
  }

  if (command === 'prepare') {
    if (!env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required')
    const tagRef = await request(`${base}/git/ref/tags/${tag}`, {}, true)
    if (tagRef)
      throw new Error(
        'This Git tag already exists; use a new version for the private draft',
      )

    const matches = (await list(`${base}/releases`)).filter(
      (release) => release.tag_name === tag,
    )
    if (matches.length > 1)
      throw new Error(
        'Multiple releases use this version; resolve them before building',
      )
    let release = matches[0]
    if (!release) {
      const runURL = `${env.GITHUB_SERVER_URL || 'https://github.com'}/${repository}/actions/runs/${env.GITHUB_RUN_ID}`
      release = await request(`${base}/releases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tag_name: tag,
          target_commitish: sha,
          name: `VergeN ${tag}`,
          draft: true,
          prerelease: false,
          make_latest: 'false',
          body: [
            'Private installer staging. Keep this release as a draft.',
            'Download the installers and upload them through the ops panel.',
            '',
            `Source commit: ${sha}`,
            `Android versionCode: ${code}`,
            `Build: ${runURL}`,
            '',
            marker,
          ].join('\n'),
        }),
      })
    }
    assertDraft(release)
    await appendFile(env.GITHUB_OUTPUT, `release_id=${release.id}\n`)
    if (env.GITHUB_STEP_SUMMARY) {
      await appendFile(
        env.GITHUB_STEP_SUMMARY,
        `[Download ${tag} draft installers](${release.html_url})\n\nWait for all four platform builds to succeed before distributing the files. Keep the release unpublished.\n`,
      )
    }
    console.log(`Draft ${tag} is ready (release ${release.id})`)
    return
  }

  if (!/^[1-9]\d*$/.test(env.RELEASE_ID ?? '')) {
    throw new Error('RELEASE_ID from the prepare job is required')
  }
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.(dmg|pkg|exe|msi|deb|rpm|AppImage|apk)$/.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort()
  if (!files.length) throw new Error(`No installer files found in ${directory}`)

  for (const name of files) {
    const blob = await openAsBlob(join(directory, name))
    if (blob.size === 0) throw new Error(`Installer is empty: ${name}`)
    const release = await request(`${base}/releases/${env.RELEASE_ID}`)
    assertDraft(release)
    const assets = await list(`${base}/releases/${env.RELEASE_ID}/assets`)
    for (const asset of assets.filter((entry) => entry.name === name)) {
      await request(`${base}/releases/assets/${asset.id}`, { method: 'DELETE' })
    }
    const uploadURL = new URL(release.upload_url.split('{')[0])
    uploadURL.searchParams.set('name', name)
    console.log(
      `Uploading ${name} (${(blob.size / 1048576).toFixed(1)} MiB) to draft ${tag}`,
    )
    const asset = await request(uploadURL.href, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(blob.size),
      },
      body: blob,
    })
    if (asset.state !== 'uploaded' || asset.size !== blob.size) {
      throw new Error(`GitHub did not confirm a complete upload for ${name}`)
    }
  }
  console.log(`Uploaded ${files.length} installer(s); release remains a draft`)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
