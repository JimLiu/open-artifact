# macOS signing and releases

[简体中文](RELEASING.zh-CN.md)

Open Artifact Desktop ships for macOS Apple Silicon as a Developer ID signed, hardened, notarized and stapled app
inside a ZIP and a signed, notarized, stapled DMG. Its stable bundle ID is `dev.openartifact.desktop`. Desktop,
its lockfile and the bundled runtime use the same version. App updates currently require downloading a new release;
the runtime's own updates are separate. Artifact apps created on the user's Mac still receive local ad hoc signatures.

## Signing material

Use a **Developer ID Application** certificate with its matching private key, exported as a password-protected `.p12`
(include the Developer ID intermediate certificate). An Apple Developer website `.cer` download alone cannot sign.
Keep the encrypted `.p12` and private-key backup outside the repository and store the password separately in a keychain
or password manager. Verify restoration by importing into a temporary keychain and signing a real executable.

The local setup stores encrypted material under `~/.open-artifact-release/signing/`, with an inventory identifying
the certificate, Team ID and the password's keychain service/account. A local backup still needs a separate secure
backup for recovery on another Mac. Never commit or upload private keys, `.p12`, `.p8`, passwords or keychain databases
as release files or Actions artifacts.

Public identity lookup:

```bash
security find-identity -v -p codesigning
```

For notarization use either an Apple Account with an **app-specific password** or a team App Store Connect API key.
The normal Apple Account password is not a notarization credential. Configure a local profile interactively:

```bash
xcrun notarytool store-credentials open-artifact-notary \
  --apple-id '<Apple Account>' --team-id '<TEAM_ID>'
xcrun notarytool history --keychain-profile open-artifact-notary
```

For a team API key, use `--key /secure/AuthKey_<KEY_ID>.p8 --key-id <KEY_ID> --issuer <ISSUER_ID>` instead.
Do not put passwords in commands you paste into chat or logs.

## GitHub configuration

Create the repository Environment **`macos-release`**, allowing the `main` branch and `desktop-v*` tags. Configure:

| Name | Kind | Value |
| --- | --- | --- |
| `OA_MAC_CERTIFICATE_BASE64` | Secret | Base64 of the encrypted `.p12` |
| `OA_MAC_CERTIFICATE_PASSWORD` | Secret | `.p12` password |
| `OA_MAC_SIGNING_SHA1` | Variable | Exact uppercase certificate SHA-1, 40 hex characters |
| `OA_APPLE_TEAM_ID` | Variable | Apple Team ID, 10 characters |
| `OA_NOTARY_APPLE_ID` | Secret | Apple Account used for notarization |
| `OA_NOTARY_APP_PASSWORD` | Secret | Its app-specific password |

Alternatively replace the two Apple Account secrets with `OA_NOTARY_API_KEY_BASE64`, `OA_NOTARY_KEY_ID` and
`OA_NOTARY_ISSUER_ID` (team API key). Configure one notarization method. Secrets are supplied only to the credential
step. It imports the certificate into a temporary keychain, signs/runs a probe, checks the exact fingerprint and
Apple access, and stores a temporary `open-artifact-notary` profile. The keychain password is generated for each run.
An `always()` cleanup step restores the keychain search list and deletes the temporary material on success or failure.

Start with the **Desktop macOS** workflow, `mode=validate`, on `main`. This checks credentials without building or
publishing an app. After the workflow is on `main`:

```bash
gh workflow run desktop-macos.yml --ref main -f mode=validate
gh workflow run desktop-macos.yml --ref main -f mode=package
```

All modes validate the tag input before checkout and require its commit to be on `origin/main` before executing
repository code or accessing signing credentials. `package` builds and tests the runtime and desktop app, signs and notarizes the app and DMG, and uploads only the ZIP,
DMG, two `.sha256` files and `release.json` as the `open-artifact-desktop-macos-arm64` Actions artifact (14 days).
It creates no GitHub Release. The workflow uses a native arm64 `macos-15` runner; no Rust/WASM rebuild is needed because
the generated WASM is committed.

## Publish

1. Raise desktop `package.json` / `package-lock.json` with the runtime and other packages. Write the matching
   `CHANGELOG.md` entry and run `node scripts/changelog.mjs --check <version>`.
2. Commit the tested sources and push to `main`. Tag that commit as `desktop-v<MAJOR>.<MINOR>.<PATCH>` and push the tag.
   Only stable versions without leading zeros are accepted. The tag must match the app, lockfile and runtime, and its
   commit must be on `origin/main`.
3. The tag automatically runs **Desktop macOS** in `publish` mode. To publish an existing desktop tag manually:

```bash
gh workflow run desktop-macos.yml --ref main -f mode=publish -f tag=desktop-v<VERSION>
```

Both paths build from the tag, run desktop checks, notarize/staple the app before archiving, verify the extracted ZIP's
signature, fingerprint, ticket and Gatekeeper assessment, separately sign/notarize/staple the DMG, and test the signed
packaged app and artifact apps. URL-scheme registration remains the existing explicit `OA_DESKTOP_URL_SCHEME=1` packaging option.

The separate publisher receives no Apple secrets. It checks the source, signer and file hashes, creates a draft,
uploads and downloads every asset for comparison, publishes, then checks anonymous public downloads. Desktop tags
and releases are independent of npm's `v*` workflow and leave GitHub's existing Latest release unchanged.

Existing assets are immutable: retry the failed **publish job** to reuse the same build artifact. Different bytes
for an existing filename are refused, including a partially uploaded draft. A rebuild that differs needs a new
version/tag. The source commit, signer, Apple submission IDs and SHA-256 hashes are recorded in `release.json`.

## Local packaging and checks

Build the runtime at the repository root first:

```bash
npm run build
node scripts/build-skill.mjs
cd apps/desktop
npm run setup
npm run package                  # local ad hoc .app; no notarization credentials required
npm run test:release             # release validation unit tests, without contacting Apple
```

For a release, set `OA_MAC_SIGNING_SHA1`, `OA_APPLE_TEAM_ID`, `OA_NOTARY_PROFILE` and optionally `OA_MAC_KEYCHAIN`
to the dedicated keychain holding the identity and profile. Commit the sources first (release packaging requires a clean
checkout). Run `npm run package:release`, then
`npm run test:packaged` sequentially. `dist/release/` contains the public files; a failed notarization keeps its result
and rejection log under `dist/notary-*/`. Missing credentials, rejected notarization or failed signature/Gatekeeper
checks stop the release; they never fall back to ad hoc signing.

References: [Electron signing](https://www.electronjs.org/docs/latest/tutorial/code-signing),
[Apple app-specific passwords](https://support.apple.com/102654),
[GitHub macOS runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
