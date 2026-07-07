# Browser quick guide

This skill attaches to a dedicated Chromium-family browser via
`--remote-debugging-port=9222`. Any browser that honors that flag and speaks
the Chrome DevTools Protocol will work. Use the notes below when `setup.sh`
asks which browser to pick, or when you need to install one.

All browsers the skill launches open in their **own dedicated profile window**
(`~/.taobao-agent/profiles/taobao-chromium`, overridable via `TAOBAO_DATA_DIR`),
independent from whatever you use for daily browsing. Installing a second
browser does not disturb your primary one.

---

## Google Chrome — recommended default

- **Install**
  - macOS: https://www.google.com/chrome/ (or `brew install --cask google-chrome`)
  - Linux: download `.deb` / `.rpm` from https://www.google.com/chrome/
  - Windows: installer from https://www.google.com/chrome/
- **Trust**: signed and notarized on macOS; no Gatekeeper issues.
- **Remote debugging**: fully supported, stable across versions.
- **Pick this** if you have no other reason.

## Microsoft Edge

- **Install**
  - macOS: https://www.microsoft.com/edge (or `brew install --cask microsoft-edge`)
  - Linux: Microsoft's `.deb` / `.rpm` repos
  - Windows: pre-installed on Windows 10/11
- **Trust**: signed, no Gatekeeper issues on macOS.
- **Remote debugging**: fully supported.
- **Pick this** if you already use Edge daily or can't install Chrome.

## Brave

- **Install**
  - macOS: https://brave.com (or `brew install --cask brave-browser`)
  - Linux: Brave's apt/yum/dnf repos
  - Windows: installer from https://brave.com
- **Trust**: signed.
- **Remote debugging**: fully supported.
- **Pick this** if Brave is already your main browser — but remember the
  skill still opens its own separate window, not your current Brave session.

## Chromium (open-source build)

- **Install**
  - macOS: `brew install --cask chromium` is **deprecated** and ships an
    unsigned build that macOS tags with `com.apple.quarantine`. Remote
    debugging will silently fail to start until the flag is removed:
    ```sh
    sudo xattr -dr com.apple.quarantine /Applications/Chromium.app
    ```
    Consider Chrome instead unless you specifically need the open-source build.
  - Linux: `apt install chromium` / `dnf install chromium` / `snap install chromium`
    (no quarantine issue on Linux).
  - Windows: https://www.chromium.org/getting-involved/download-chromium/
- **Trust**: unsigned on macOS; signed on most Linux distros.
- **Remote debugging**: fully supported once Gatekeeper is satisfied.

## Google Chrome Canary

- **Install**: https://www.google.com/chrome/canary/
- **Trust**: signed.
- **Remote debugging**: supported; occasionally breaks on dev builds.
- **Pick this** only if you need a bleeding-edge Chromium for unrelated
  reasons and are OK with occasional breakage.

## Arc — not recommended

- **Engine**: Chromium, but Arc wraps launch with a custom CLI layer that
  overrides some flags. `--remote-debugging-port` is not reliably honored;
  the port may silently fail to bind with no log output.
- **Recommendation**: keep using Arc as your daily browser, but install
  Chrome/Edge/Brave for the skill to attach to. The skill always opens its
  own dedicated window regardless, so you are not giving anything up.

## Other forks (Vivaldi, Opera, Yandex, etc.)

Untested. May work if the fork respects `--remote-debugging-port`. To try:

```sh
./scripts/taobao.sh setup --browser /path/to/binary
./scripts/taobao.sh browser-start
```

If `browser-start` reports "Started browser with remote debugging on port
9222", you're good. If it times out, check the quarantine hint (macOS) or
look in `~/.taobao-agent/playwright/taobao-browser.log`
(or `$TAOBAO_DATA_DIR/playwright/taobao-browser.log` if overridden).

## Cached / bundled Chromium (Playwright, Puppeteer, terminal tools)

`setup` also discovers Chromium binaries that terminal tools, Node projects,
or CI harnesses may have already downloaded. These are usually the fastest
path to a working browser: pre-downloaded, not Gatekeeper-quarantined (they
come via `curl` without a mark-of-the-web), and appear in the setup menu as
e.g. `Chromium (Playwright cache)`.

Locations checked automatically:

- **Playwright**
  - macOS: `~/Library/Caches/ms-playwright/chromium-*/chrome-mac/Chromium.app/Contents/MacOS/Chromium`
  - Linux: `~/.cache/ms-playwright/chromium-*/chrome-linux/chrome`
  - Windows: `%LOCALAPPDATA%/ms-playwright/chromium-*/chrome-win/chrome.exe`
- **Puppeteer / Chrome for Testing**
  - macOS: `~/.cache/puppeteer/chrome/mac*/chrome-mac*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
  - Linux: `~/.cache/puppeteer/chrome/linux-*/chrome-linux64/chrome`

If a terminal tool or application installs Chromium into a non-standard
location, point `setup` at it directly:

```sh
# Single explicit path
./scripts/taobao.sh setup --browser /path/to/Chromium

# Or expose multiple paths to the auto-discovery menu:
export TAOBAO_EXTRA_BROWSERS="/Applications/cmux.app/.../Chromium:/opt/my-tool/chrome"
./scripts/taobao.sh setup
```

`TAOBAO_EXTRA_BROWSERS` is colon-separated (`:` on macOS/Linux, works inside
Git Bash on Windows). Entries that exist are added to the menu alongside the
auto-discovered ones; non-existent entries are silently ignored.

---

## macOS launch mechanics — LaunchServices, not nohup

On macOS, `browser-start` launches `.app` bundles via LaunchServices
(`open -na <App.app> --args …`) instead of `nohup <binary> … &`. Two
reasons, both learned the hard way:

- **Process lifetime.** Some agent runtimes (observed under Codex's shell
  tool) tear down the tool process group after each call; a GUI Chrome
  child launched with `nohup … &` dies with it, so `browser-start` reports
  success but `probe-attached` finds port 9222 refused moments later.
  LaunchServices owns the app process independently of the invoking shell,
  so the browser survives.
- **Instance isolation.** `open -na` starts a *new* app instance with the
  dedicated `--user-data-dir`, rather than handing the URL to an
  already-running daily-profile Chrome. The user's daily browsing profile
  is never touched or merged into.

Non-`.app` binaries (Playwright cache on Linux, plain `chrome` binaries)
keep the `nohup` path — the lifetime issue is macOS-GUI-specific. One side
effect: LaunchServices launches don't write the browser-launch log
(`~/.taobao-agent/playwright/taobao-browser.log`); use
`browser-status` / `curl 127.0.0.1:9222/json/version` to diagnose instead.

## Recommended preference order

When several browsers are available, prefer in this order:

1. **Isolated binaries** — Chrome for Testing, Playwright / Puppeteer
   cached Chromium. Pre-downloaded, not quarantined, fully separate from
   daily browsing.
2. **Trusted system browsers** — Google Chrome, Edge, Brave. Fine as
   defaults; the dedicated `--user-data-dir` keeps Taobao state out of the
   daily profile, and on macOS `open -na` keeps the instances separate.
3. **Homebrew Chromium — last choice.** The cask is unsigned; Gatekeeper
   quarantine silently prevents the remote-debugging port from binding
   until `sudo xattr -dr com.apple.quarantine` is run. Only use it when
   setup has detected and explained the quarantine fix.

Do not auto-switch users to Homebrew Chromium to "avoid" their daily
Chrome — the dedicated profile plus `open -na` already provides the
isolation, without the quarantine trap.

---

## How the skill picks a browser

Resolution order used by `remote-browser.sh` and the adapter's `config.ts`:

1. `CHROMIUM_PATH` environment variable (if set and executable)
2. Value persisted in `~/.taobao-agent/config.sh`
   (or `$TAOBAO_DATA_DIR/config.sh`) by `setup.sh --browser` or the
   interactive menu (sourced automatically by `scripts/taobao.sh`)
3. OS-specific candidate list (first match wins)

To change the persisted choice:

```sh
./scripts/taobao.sh setup                      # interactive menu
./scripts/taobao.sh setup --browser /path      # non-interactive
./scripts/taobao.sh setup --clear-browser      # forget the choice
```
