# shotsync — Mac menu-bar client

Auto-uploads every new screenshot to your shotsync Worker. Menu-bar only (no Dock icon), with a pause toggle.

## Requirements
- macOS 13+, Swift toolchain (Command Line Tools is enough — no full Xcode).
- A deployed shotsync Worker (see the repo root) and its access token.

## Build & install
```bash
cd mac
bash scripts/build.sh      # builds shotsync.app, self-signed
bash scripts/install.sh    # installs to /Applications + LaunchAgent (starts at login)
open /Applications/shotsync.app
```
First launch asks for your Worker base URL + token (stored in the Keychain), then offers to point the macOS screenshot location at `~/Pictures/shotsync` (restored when you quit or choose "Restore default screenshot location").

## How it works
- You keep taking screenshots with the macOS shortcuts — `⌘⇧3` (whole screen), `⌘⇧4` (selection), `⌘⇧5` (capture panel). shotsync registers no shortcuts of its own; it only changes where those shots land. The menu's **How to use…** panel restates this and reports whether the redirect and the Worker are actually set up.
- Watches `~/Pictures/shotsync` via FSEvents; files up to 90MB are thumbnailed client-side and POSTed to `/api/upload` (`X-Source: mac`), while larger files use resumable 50MB multipart uploads.
- Uploaded files are marked with an extended attribute so restarts don't re-upload.
- Multipart session IDs and part ETags are persisted under the app support directory, so failures and app restarts resume from the last completed part. Failures go to a persistent queue and retry with capped exponential backoff.

## Uninstall
```bash
launchctl unload ~/Library/LaunchAgents/com.jinkun.shotsync.plist
rm ~/Library/LaunchAgents/com.jinkun.shotsync.plist
rm -rf /Applications/shotsync.app
```
Quit the app first so it restores your original screenshot location.

## Dev
```bash
swift test          # ShotsyncCore unit tests (Swift Testing)
swift run shotsync  # run from source
```

Note: tests use Swift Testing (`import Testing`), not XCTest — Command Line Tools has no XCTest. The package is pinned to `swift-tools-version:5.9` (Swift 5 language mode) so the AppKit/menu-bar code isn't blocked by Swift 6 strict concurrency.
