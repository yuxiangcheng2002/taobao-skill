import { chromium, type BrowserContext, type Page, type Browser } from 'playwright-core';
import { loadConfig } from './config.js';

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
  attached: boolean;
  cleanup: (options?: { keepPageOpen?: boolean }) => Promise<void>;
}

export interface BrowserSessionOptions {
  // Ordinary adapter work stays in background tabs. Visual verification is
  // the deliberate exception: Computer Use needs a genuinely foreground-
  // created target so macOS Chrome paints the compositor surface reliably.
  foreground?: boolean;
}

// Open a new tab without macOS focus theft.
//
// The default `context.newPage()` resolves to CDP `Target.createTarget(url)`
// without the `background` flag, which on macOS causes Chrome to become the
// frontmost app on every skill call — disruptive when the user is typing in
// another window. CDP exposes `background: true` for exactly this case, but
// Playwright does not surface the parameter, so we issue the call ourselves
// via a browser-level CDP session and pick up the resulting Page through
// the context's `page` event.
async function createBackgroundPage(browser: Browser, context: BrowserContext): Promise<Page> {
  let resolvePage!: (p: Page) => void;
  let rejectPage!: (e: Error) => void;
  const pagePromise = new Promise<Page>((resolve, reject) => {
    resolvePage = resolve;
    rejectPage = reject;
  });

  const onPage = (p: Page) => {
    context.off('page', onPage);
    resolvePage(p);
  };
  context.on('page', onPage);

  const timer = setTimeout(() => {
    context.off('page', onPage);
    rejectPage(new Error('Background tab creation timed out (CDP Target.createTarget did not produce a page event within 8s)'));
  }, 8000);

  try {
    const cdp = await browser.newBrowserCDPSession();
    await cdp.send('Target.createTarget', {
      url: 'about:blank',
      background: true
    });
  } catch (error) {
    clearTimeout(timer);
    context.off('page', onPage);
    throw error;
  }

  const page = await pagePromise;
  clearTimeout(timer);
  return page;
}

async function attachToRunningBrowser(cdpUrl: string, options: BrowserSessionOptions = {}): Promise<BrowserSession> {
  const browser: Browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = options.foreground ? await context.newPage() : await createBackgroundPage(browser, context);
  page.setDefaultTimeout(loadConfig().defaultTimeoutMs);
  return {
    context,
    page,
    attached: true,
    cleanup: async (options = {}) => {
      try {
        if (!options.keepPageOpen) {
          await page.close().catch(() => {});
        }
      } finally {
        await browser.close().catch(() => {});
      }
    }
  };
}

export async function launchPersistentTaobaoContext(options: BrowserSessionOptions = {}): Promise<BrowserSession> {
  const cdpUrl = process.env.TAOBAO_CDP_URL;
  if (cdpUrl) {
    return attachToRunningBrowser(cdpUrl, options);
  }

  const config = loadConfig();
  const context = await chromium.launchPersistentContext(config.userDataDir, {
    executablePath: config.chromiumExecutablePath,
    headless: config.headless,
    viewport: config.viewport,
    locale: 'zh-CN',
    userAgent:
      'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-default-browser-check',
      '--disable-dev-shm-usage'
    ]
  });

  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(config.defaultTimeoutMs);
  return {
    context,
    page,
    attached: false,
    cleanup: async (options = {}) => {
      if (options.keepPageOpen) {
        throw new Error('Keeping a visual inspection tab open requires an attached CDP browser');
      }
      await context.close();
    }
  };
}
