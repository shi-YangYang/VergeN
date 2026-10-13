## Clash Meta for Android

A Graphical user interface of [Clash.Meta](https://github.com/MetaCubeX/Clash.Meta) for Android

### Feature

Feature of [Clash.Meta](https://github.com/MetaCubeX/Clash.Meta)

[<img src="https://fdroid.gitlab.io/artwork/badge/get-it-on.png"
     alt="Get it on F-Droid"
     height="80">](https://f-droid.org/packages/com.github.metacubex.clash.meta/)

### Requirement

- Android 5.0+ (minimum)
- Android 7.0+ (recommend)
- `arm64-v8a` Architecture (VergeN packages only this ABI)

### Build VergeN locally

From the repository root, initialize the core submodule with
`git submodule update --init --recursive`. Install JDK 21, Go (the version in
`core/src/foss/golang/clash/go.mod` or newer), and these Android SDK components:

- `platforms;android-35`
- `build-tools;35.0.0`
- `ndk;29.0.14206865`
- `cmake;3.22.1`

Set the local build paths in `.env.build.local` at the repository root. This file
is ignored by Git and affects packaging commands only:

```properties
JAVA_HOME=/path/to/jdk-21
ANDROID_HOME=/path/to/android-sdk
```

Keep `android/local.properties` configured with:

```properties
sdk.dir=/path/to/android-sdk
remove.suffix=true
```

Preserve the signing key used by previously distributed APKs as
`android/release.keystore`, together with `android/signing.properties`:

```properties
keystore.password=<existing key store password>
key.alias=<existing key alias>
key.password=<existing key password>
```

Do not generate a replacement key for an existing installation: Android upgrades
require the same signing certificate. The packaging command refuses to silently
fall back to debug signing if these files are missing. The configured key must
still be checked against the certificate of previously distributed APKs.

Build one arm64 APK, specifying a version and a strictly increasing Android
versionCode (the example assumes the last published versionCode was below 9):

```bash
pnpm package:android 0.1.1 9
```

The upload-ready installer is
`release-local/0.1.1/android/vergen-0.1.1-android-arm64-v8a.apk`.
The package identity remains `io.github.vergen.android`.
The server address is currently defined in
`app/src/main/java/com/github/kr328/clash/enterprise/EnterpriseKit.kt`.

### Automation

APP package name is `com.github.metacubex.clash.meta`

- Toggle Clash.Meta service status
  - Send intent to activity `com.github.kr328.clash.ExternalControlActivity` with action `com.github.metacubex.clash.meta.action.TOGGLE_CLASH`
- Start Clash.Meta service
  - Send intent to activity `com.github.kr328.clash.ExternalControlActivity` with action `com.github.metacubex.clash.meta.action.START_CLASH`
- Stop Clash.Meta service
  - Send intent to activity `com.github.kr328.clash.ExternalControlActivity` with action `com.github.metacubex.clash.meta.action.STOP_CLASH`
- Import a profile
  - URL Scheme `clash://install-config?url=<encoded URI>` or `clashmeta://install-config?url=<encoded URI>`

### Contribution and Project Maintenance

#### Meta Kernel

- CMFA uses the kernel from `android-real` branch under `MetaCubeX/Clash.Meta`, which is a merge of the main `Alpha` branch and `android-open`.
  - If you want to contribute to the kernel, make PRs to `Alpha` branch of the Meta kernel repository.
  - If you want to contribute Android-specific patches to the kernel, make PRs to  `android-open` branch of the Meta kernel repository.

#### Maintenance

- When `MetaCubeX/Clash.Meta` kernel is updated to a new version, the `Update Dependencies` actions in this repo will be triggered automatically.
  - It will pull the new version of the meta kernel, update all the golang dependencies, and create a PR without manual intervention.
  - If there is any compile error in PR, you need to fix it before merging. Alternatively, you may merge the PR directly.
- Manually triggering `Build Pre-Release` actions will compile and publish a `PreRelease` version.
- Manually triggering `Build Release` actions will compile, tag and publish a `Release` version.
  - You must fill the blank `Release Tag` with the tag you want to release in the format of `v1.2.3`.
  - `versionName` and `versionCode` in `build.gradle.kts` will be automatically bumped to the tag you filled above.
