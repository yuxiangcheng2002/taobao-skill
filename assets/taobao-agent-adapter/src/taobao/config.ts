import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { TaobaoConfig } from './types.js';

function resolveChromiumExecutable(): string {
  const env = process.env.CHROMIUM_PATH;
  if (env && fs.existsSync(env)) {
    return env;
  }

  const candidates = [
    // Linux
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/microsoft-edge',
    '/usr/bin/brave-browser',
    '/opt/google/chrome/chrome',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('Could not resolve a Chromium executable. Set CHROMIUM_PATH explicitly.');
}

function resolveProjectRoot(): string {
  let current = path.dirname(fileURLToPath(import.meta.url));

  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return process.cwd();
}

// Resolve the per-user data directory. Single env var (TAOBAO_DATA_DIR)
// is the umbrella for everything that grows over time: the persistent
// browser profile, generated screenshots, image downloads, the
// remote-browser log. Default ~/.taobao-agent keeps it out of the skill
// folder so the skill itself can be packaged / replaced without touching
// the user's login state.
export function resolveDataDir(): string {
  const override = process.env.TAOBAO_DATA_DIR;
  if (override && override.trim().length > 0) {
    return override;
  }
  return path.join(os.homedir(), '.taobao-agent');
}

export function loadConfig(): TaobaoConfig {
  const projectRoot = resolveProjectRoot();
  const dataDir = resolveDataDir();
  // TAOBAO_PROFILE_DIR keeps working for advanced users / scripts that
  // already set it. Without an override the profile lives under the data
  // dir, not under the skill folder.
  const userDataDir = process.env.TAOBAO_PROFILE_DIR ?? path.join(dataDir, 'profiles', 'taobao-chromium');
  const downloadsDir = path.join(dataDir, 'downloads');
  const screenshotsDir = path.join(downloadsDir, 'screenshots');
  const headless = process.env.TAOBAO_HEADLESS === '1';

  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(screenshotsDir, { recursive: true });

  return {
    projectRoot,
    dataDir,
    chromiumExecutablePath: resolveChromiumExecutable(),
    userDataDir,
    downloadsDir,
    screenshotsDir,
    headless,
    viewport: { width: 1440, height: 1100 },
    defaultTimeoutMs: 60_000
  };
}

export function doctor() {
  const config = loadConfig();
  return {
    platform: process.platform,
    arch: os.arch(),
    projectRoot: config.projectRoot,
    dataDir: config.dataDir,
    chromiumExecutablePath: config.chromiumExecutablePath,
    userDataDir: config.userDataDir,
    userDataDirExists: fs.existsSync(config.userDataDir),
    downloadsDir: config.downloadsDir,
    headless: config.headless
  };
}
