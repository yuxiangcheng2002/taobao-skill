import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';
import {
  launchPersistentTaobaoContext,
  type BrowserSession,
  type BrowserSessionOptions
} from './browser.js';
import { doctor, loadConfig } from './config.js';
import { NetworkTap } from './network.js';
import {
  collectInterestingImageUrls,
  detectPlatform,
  extractMOQ,
  extractPriceTiers,
  extractShopFromHeadText,
  filterProductCandidates,
  isAllowedProductUrl,
  isDetailHost,
  parseIceContextDetail,
  pickProductImages,
  SHOP_NAME_BLACKLIST,
  summarizeCandidate
} from './parser.js';
import { inferPageState } from './state.js';
import {
  DownloadImagesResponse,
  OpenResultResponse,
  ProductCandidate,
  ProductDetail,
  PublicSmokeResult,
  SearchResult,
  SessionProbe,
  TaobaoPageState,
  VisualInspectionCloseResponse,
  VisualInspectionResponse
} from './types.js';

export interface DetailOptions {
  screenshot?: boolean;
}

// Read the SSR-injected detail data the page renders from. As of the 2025
// `tbpc_detail_2025` build the path is:
//   window.__ICE_APP_CONTEXT__.loaderData.home.data.res
// with `componentsVO.priceVO.price`, `seller`, `item`, and `skuCore.sku2info`
// holding everything we expose. This is dramatically more reliable than the
// DOM/innerText fallback, which misses fields rendered via React portals or
// behind interactive triggers (price often disappears that way).
//
// If the shape changes — Taobao bumps the SSR version every few months —
// every field here returns undefined and the caller silently falls back to
// the DOM extractor. That degradation is the right failure mode: a missing
// price beats a wrong one. We also emit `ICE_CONTEXT_PATH_DRIFT_SUSPECTED`
// in `detail.warnings` when this happens on a known detail-page host so the
// caller can surface the drop in fidelity rather than silently trusting
// weaker fields.
async function readIceContextRaw(page: Page): Promise<unknown | undefined> {
  const read = async () => await page
    .evaluate(() => {
      const ctx = (window as unknown as { __ICE_APP_CONTEXT__?: any }).__ICE_APP_CONTEXT__;
      const res = ctx?.loaderData?.home?.data?.res;
      if (!res) return undefined;
      // Cherry-pick the subtrees we use to keep the cross-process payload
      // bounded and serialization-safe (the full `res` graph is big and
      // can hold non-JSON-friendly values).
      return {
        componentsVO: res.componentsVO ? { priceVO: res.componentsVO.priceVO } : undefined,
        seller: res.seller,
        item: res.item
          ? { vagueSellCount: res.item.vagueSellCount, images: res.item.images }
          : undefined,
        skuCore: res.skuCore ? { sku2info: res.skuCore.sku2info } : undefined
      };
    })
    .catch(() => undefined);

  const immediate = await read();
  if (immediate) return immediate;

  // Current item.taobao.com sometimes paints a visible shell before the
  // inline ICE bootstrap assigns loaderData. `body: visible` is therefore
  // not sufficient proof that SSR context is ready. Wait briefly, then read
  // once more; do not turn a missing context into a fatal navigation error.
  await page
    .waitForFunction(
      () => Boolean((window as unknown as { __ICE_APP_CONTEXT__?: any }).__ICE_APP_CONTEXT__?.loaderData?.home?.data?.res),
      undefined,
      { timeout: 3000 }
    )
    .catch(() => undefined);
  return await read();
}

async function extractIceContextDetail(page: Page) {
  const raw = await readIceContextRaw(page);
  return parseIceContextDetail(raw);
}

async function snapshotText(page: Page): Promise<string> {
  return await page.locator('body').innerText().catch(() => '');
}

const MTOP_APP_KEY = '12574478';

// Ask mtop who the session user actually is. Returns true/false on a
// definitive answer, undefined when inconclusive (non-taobao origin, missing
// token, transport/CORS failure) so the caller can fall back to heuristics.
// The mtop sign is the documented client-side scheme:
// md5(`${h5tkToken}&${timestamp}&${appKey}&${data}`).
async function probeMtopSession(page: Page): Promise<boolean | undefined> {
  try {
    const hostname = new URL(page.url()).hostname;
    if (!/\.(taobao|tmall)\.com$/.test(hostname)) return undefined;

    const cookies = await page.context().cookies();
    const h5tk = cookies.find((cookie) => cookie.name === '_m_h5_tk')?.value;
    const token = h5tk?.split('_')[0];
    if (!token) return undefined;

    const t = Date.now().toString();
    const data = '{}';
    const sign = crypto.createHash('md5').update(`${token}&${t}&${MTOP_APP_KEY}&${data}`).digest('hex');
    const apiUrl =
      `https://h5api.m.taobao.com/h5/mtop.user.getusersimple/1.0/` +
      `?jsv=2.7.4&appKey=${MTOP_APP_KEY}&t=${t}&sign=${sign}` +
      `&api=mtop.user.getUserSimple&v=1.0&dataType=json&type=originaljson&data=${encodeURIComponent(data)}`;

    const body = await page.evaluate(async (url) => {
      const response = await fetch(url, { credentials: 'include' });
      return await response.text();
    }, apiUrl);

    const parsed = JSON.parse(body) as { ret?: unknown; data?: { nick?: string } };
    const ret = Array.isArray(parsed.ret) ? String(parsed.ret[0] ?? '') : '';
    if (ret.startsWith('SUCCESS') && parsed.data?.nick) return true;
    if (ret.includes('SESSION_EXPIRED') || ret.includes('SID_INVALID')) return false;
    return undefined; // token expired / illegal access — can't tell either way
  } catch {
    return undefined;
  }
}

async function detectLoggedIn(page: Page): Promise<boolean> {
  // Authoritative first: mtop knows whether the *session* is alive. The old
  // cookie heuristic false-positives because `tracknick` is a remembered
  // nick that survives session expiry.
  const mtop = await probeMtopSession(page);
  if (mtop !== undefined) return mtop;

  const text = (await snapshotText(page)).toLowerCase();
  if (text.includes('亲，请登录') || text.includes('please log in') || text.includes('session expired')) {
    return false;
  }

  const cookies = await page.context().cookies();
  return cookies.some((cookie) => cookie.name === 'tracknick' && Boolean(cookie.value));
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'taobao-item'
  );
}

// Persist a full-page screenshot under <projectRoot>/downloads/screenshots/.
// Multimodal callers can Read the resulting PNG to verify silkscreen / package
// / layout claims that text extraction misses. Failures are silent \u2014 a missing
// screenshot is a degraded result, not a fatal one.
async function captureScreenshot(page: Page, label: string): Promise<string | undefined> {
  const config = loadConfig();
  fs.mkdirSync(config.screenshotsDir, { recursive: true });
  const slug = slugify(label);
  const filePath = path.join(config.screenshotsDir, `${slug}-${Date.now()}.png`);
  try {
    await page.screenshot({ path: filePath, fullPage: true });
    return filePath;
  } catch {
    // Very long Taobao detail pages can exceed Chromium's maximum bitmap
    // height. Keep visual evidence by falling back to the current viewport.
    try {
      await page.screenshot({ path: filePath, fullPage: false });
      return filePath;
    } catch {
      return undefined;
    }
  }
}

function isUserActionState(state: TaobaoPageState): boolean {
  return state === 'verification-wall' || state === 'login-wall';
}

const VISUAL_TAB_MARKER = 'taobao-codex-visual-v1' as const;
const VISUAL_WINDOW_NAME_PREFIX = `${VISUAL_TAB_MARKER}:`;

async function visualWindowName(page: Page): Promise<string> {
  return await page.evaluate(() => window.name).catch(() => '');
}

async function findStagedVisualPages(session: BrowserSession): Promise<Page[]> {
  const matches: Page[] = [];
  for (const page of session.context.pages()) {
    if (page === session.page || page.isClosed()) continue;
    if ((await visualWindowName(page)).startsWith(VISUAL_WINDOW_NAME_PREFIX)) {
      matches.push(page);
    }
  }
  return matches;
}

function expectedHrefFromWindowName(name: string): string | undefined {
  if (!name.startsWith(VISUAL_WINDOW_NAME_PREFIX)) return undefined;
  try {
    return decodeURIComponent(name.slice(VISUAL_WINDOW_NAME_PREFIX.length));
  } catch {
    return undefined;
  }
}

function itemIdFromHref(href: string): string | undefined {
  try {
    return new URL(href).searchParams.get('id') ?? undefined;
  } catch {
    return undefined;
  }
}

function extensionFromUrl(url: string, contentType: string): string {
  const lowerUrl = url.toLowerCase();
  const match = lowerUrl.match(/\.(jpg|jpeg|png|webp|avif|gif)(?:$|[?#])/);
  if (match) {
    return `.${match[1]}`;
  }

  const lowerType = contentType.toLowerCase();
  if (lowerType.includes('png')) return '.png';
  if (lowerType.includes('webp')) return '.webp';
  if (lowerType.includes('avif')) return '.avif';
  if (lowerType.includes('gif')) return '.gif';
  return '.jpg';
}

async function collectDetailImageUrls(page: Page): Promise<string[]> {
  const rawUrls = await page
    .locator('img')
    .evaluateAll((nodes) => {
      const values: string[] = [];

      for (const node of nodes) {
        const img = node as HTMLImageElement;
        const attrs = [
          img.currentSrc,
          img.src,
          img.getAttribute('data-src'),
          img.getAttribute('data-lazy-img'),
          img.getAttribute('data-ks-lazyload'),
          img.getAttribute('source-src'),
          img.getAttribute('data-img'),
          img.getAttribute('data-original')
        ];

        for (const attr of attrs) {
          if (attr) values.push(attr);
        }
      }

      return values;
    })
    .catch(() => [] as string[]);

  return collectInterestingImageUrls(rawUrls).slice(0, 30);
}

function collectHtmlFallbackCandidates(html: string): ProductCandidate[] {
  const matches = html.match(/https:\/\/(?:item\.taobao\.com|detail\.tmall\.com)\/[^"'\s<>]+/g) ?? [];
  return filterProductCandidates(
    matches.map((href, index) => ({
      text: `HTML fallback candidate ${index + 1}`,
      href
    }))
  );
}

async function collectAnchorCandidates(page: Page): Promise<ProductCandidate[]> {
  const anchors = await page.locator('a').evaluateAll((nodes) => {
    return nodes.map((node) => {
      const anchor = node as HTMLAnchorElement;
      const imageNodes = Array.from(anchor.querySelectorAll('img'));
      const imageUrls = imageNodes.flatMap((img) => {
        const element = img as HTMLImageElement;
        return [
          element.currentSrc,
          element.src,
          element.getAttribute('data-src'),
          element.getAttribute('data-lazy-img'),
          element.getAttribute('data-ks-lazyload'),
          element.getAttribute('source-src'),
          element.getAttribute('data-img'),
          element.getAttribute('data-original')
        ].filter(Boolean) as string[];
      });

      const firstImageAlt = imageNodes[0]?.getAttribute('alt') ?? '';
      const text =
        [anchor.innerText, anchor.getAttribute('title'), anchor.getAttribute('aria-label'), firstImageAlt].find(
          (value) => typeof value === 'string' && value.trim()
        ) ?? '';

      return {
        text,
        href: anchor.href ?? '',
        thumbnailUrl: imageUrls[0],
        imageUrls
      };
    });
  });

  const filtered = filterProductCandidates(anchors);
  if (filtered.length > 0) {
    return filtered;
  }

  const html = await page.content();
  return collectHtmlFallbackCandidates(html);
}

async function assertExpectedDetailLanding(page: Page): Promise<void> {
  if (isAllowedProductUrl(page.url())) return;
  const title = await page.title();
  const text = await snapshotText(page);
  const state = inferPageState(page.url(), title, text);
  if (isUserActionState(state)) return;
  throw new Error(`Unexpected redirect outside the Taobao/Tmall product boundary: ${page.url()}`);
}

async function extractProductInfoFromPage(
  page: Page,
  opts: DetailOptions & { label: string } = { label: 'detail' }
): Promise<ProductDetail> {
  const title = await page.title();
  const text = await snapshotText(page);
  const state = inferPageState(page.url(), title, text);
  const wantsScreenshot = opts.screenshot !== false;

  // Verification / login walls have no useful product fields and may waste
  // time on selectors that never resolve. Capture evidence and bail.
  if (isUserActionState(state)) {
    const screenshotPath = await captureScreenshot(page, `${opts.label}-${state}`);
    return {
      state,
      url: page.url(),
      title,
      loggedInLikely: await detectLoggedIn(page),
      imageUrls: [],
      rawTextPreview: text.slice(0, 1200),
      screenshotPath,
      requiresUserAction: true
    };
  }

  const ice = await extractIceContextDetail(page);
  const priceMatch = text.match(/¥\s*([0-9]+(?:\s*\.\s*[0-9]+)?)/);
  const salesMatch = text.match(/(\d+(?:\.\d+)?(?:万|千)?\+?(?:人付款|人收货|已售))/);
  const heading = await page.locator('h1').first().innerText().catch(() => '');
  const shopCandidates = await page
    .locator('a')
    .evaluateAll((nodes) => {
      const matches: string[] = [];
      for (const node of nodes) {
        const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (/(旗舰店|企业店铺|专营店|专卖店|官方店|店铺)$/.test(text)) {
          matches.push(text);
        }
      }
      return matches;
    })
    .catch(() => [] as string[]);
  const shopText = shopCandidates.find((candidate) => !SHOP_NAME_BLACKLIST.has(candidate))
    ?? extractShopFromHeadText(text);
  const imageUrls = await collectDetailImageUrls(page);
  const candidateImages = ice?.itemImages && ice.itemImages.length > 0 ? ice.itemImages : imageUrls;
  const productImageUrls = pickProductImages(candidateImages, 5);
  const priceTiers = extractPriceTiers(text);
  const moq = extractMOQ(text);
  const screenshotPath = wantsScreenshot ? await captureScreenshot(page, opts.label) : undefined;

  // Prefer the SSR `__ICE_APP_CONTEXT__` data when available — it carries the
  // canonical values the page rendered from. DOM scraping stays as a fallback
  // for older builds, item.taobao.com listings that may use a different shape,
  // and any future SSR-version drift.
  const finalPrice = ice?.price
    ? `¥${ice.price}`
    : priceMatch
      ? `¥${priceMatch[1].replace(/\s+/g, '')}`
      : undefined;
  const finalShop = ice?.shop ?? shopText ?? undefined;
  const finalSales = ice?.vagueSellCount ?? salesMatch?.[1];
  const ssrSource = ice && (ice.price || ice.shop) ? 'ice-context' as const : 'dom' as const;

  // Drift detection: detail-host pages (detail.tmall.com / item.taobao.com)
  // are expected to expose `window.__ICE_APP_CONTEXT__.loaderData.home.data.res`
  // on the current Taobao SSR build. If we landed on one and still had to
  // fall back to DOM scraping, the SSR layout has likely changed — surface a
  // warning so callers don't quietly trust the weaker fields.
  const warnings: string[] = [];
  if (ssrSource === 'dom' && isDetailHost(page.url())) {
    warnings.push(
      'ICE_CONTEXT_PATH_DRIFT_SUSPECTED: __ICE_APP_CONTEXT__.loaderData.home.data.res ' +
        'not found on a detail-host page; price / shop / sellerEvaluates fell back to DOM scraping. ' +
        'Taobao may have shipped a new SSR layout — verify the values and consider updating ' +
        'parseIceContextDetail / readIceContextRaw if drift is confirmed.'
    );
  }

  return {
    state,
    url: page.url(),
    title,
    loggedInLikely: await detectLoggedIn(page),
    name: heading || title,
    price: finalPrice,
    priceTitle: ice?.priceTitle,
    sales: finalSales,
    shop: finalShop || undefined,
    shopId: ice?.shopId,
    sellerId: ice?.sellerId,
    sellerEvaluates: ice?.sellerEvaluates,
    quantity: ice?.quantity,
    quantityText: ice?.quantityText,
    imageUrls,
    productImageUrls: productImageUrls.length > 0 ? productImageUrls : undefined,
    priceTiers: priceTiers.length > 0 ? priceTiers : undefined,
    moq,
    rawTextPreview: text.slice(0, 1200),
    screenshotPath,
    ssrSource,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

export class TaobaoAgentAdapter {
  readonly networkTap = new NetworkTap();

  constructor(
    private readonly launchSession: (options?: BrowserSessionOptions) => Promise<BrowserSession> = launchPersistentTaobaoContext
  ) {}

  async runPublicSmoke(): Promise<PublicSmokeResult> {
    const session = await this.launchSession();
    this.networkTap.attach(session.page);
    try {
      await session.page.goto('https://www.taobao.com/', { waitUntil: 'domcontentloaded' });
      await session.page.locator('body').waitFor({ state: 'visible' });
      const title = await session.page.title();
      const text = await snapshotText(session.page);
      return {
        finalUrl: session.page.url(),
        title,
        state: inferPageState(session.page.url(), title, text)
      };
    } finally {
      await session.cleanup();
    }
  }

  async probeSession(): Promise<SessionProbe> {
    const session = await this.launchSession();
    this.networkTap.attach(session.page);
    try {
      await session.page.goto('https://www.taobao.com/', { waitUntil: 'domcontentloaded' });
      await session.page.locator('body').waitFor({ state: 'visible' });
      const title = await session.page.title();
      const text = await snapshotText(session.page);
      return {
        state: inferPageState(session.page.url(), title, text),
        url: session.page.url(),
        title,
        loggedInLikely: await detectLoggedIn(session.page)
      };
    } finally {
      await session.cleanup();
    }
  }

  async search(query: string): Promise<SearchResult> {
    const session = await this.launchSession();
    this.networkTap.attach(session.page);
    try {
      const url = `https://s.taobao.com/search?q=${encodeURIComponent(query)}`;
      await session.page.goto(url, { waitUntil: 'domcontentloaded' });
      await session.page.locator('body').waitFor({ state: 'visible' });
      const title = await session.page.title();
      const text = await snapshotText(session.page);
      const state = inferPageState(session.page.url(), title, text);

      // When Taobao serves a verification or login wall, search-result anchors
      // never appear. Capturing a screenshot lets the caller see the actual
      // challenge so they can act (slide CAPTCHA, re-login, switch IP) rather
      // than spinning on empty results.
      if (isUserActionState(state)) {
        const screenshotPath = await captureScreenshot(session.page, `search-${state}-${slugify(query)}`);
        return {
          query,
          state,
          url: session.page.url(),
          title,
          loggedInLikely: await detectLoggedIn(session.page),
          candidateCount: 0,
          candidates: [],
          networkTap: this.networkTap.records.slice(0, 12),
          screenshotPath,
          requiresUserAction: true,
          resume: {
            action: 'search',
            query,
            attemptsRemaining: 1
          }
        };
      }

      let rawCandidates = await collectAnchorCandidates(session.page);
      if (state === 'search-results' && rawCandidates.length === 0) {
        await session.page.waitForTimeout(1500);
        rawCandidates = await collectAnchorCandidates(session.page);
      }
      const allCandidates = rawCandidates.map((candidate, index) => summarizeCandidate(candidate, index + 1));
      const candidates = allCandidates.slice(0, 50);

      return {
        query,
        state,
        url: session.page.url(),
        title,
        loggedInLikely: await detectLoggedIn(session.page),
        candidateCount: candidates.length,
        totalCandidateCount: allCandidates.length,
        candidates,
        networkTap: this.networkTap.records.slice(0, 12)
      };
    } finally {
      await session.cleanup();
    }
  }

  async openResult(query: string, index: number, opts: DetailOptions = {}): Promise<OpenResultResponse> {
    const searchResult = await this.search(query);
    if (searchResult.requiresUserAction) {
      return {
        query,
        index,
        state: searchResult.state,
        url: searchResult.url,
        title: searchResult.title,
        screenshotPath: searchResult.screenshotPath,
        requiresUserAction: true,
        resume: {
          action: 'open-result',
          query,
          index,
          attemptsRemaining: 1
        },
        networkTap: searchResult.networkTap
      };
    }
    const picked = searchResult.candidates[index - 1];
    if (!picked) {
      throw new Error(`No candidate at index ${index}. Found ${searchResult.candidateCount} candidates.`);
    }

    const session = await this.launchSession();
    this.networkTap.attach(session.page);
    try {
      await session.page.goto(picked.href, { waitUntil: 'domcontentloaded' });
      await session.page.locator('body').waitFor({ state: 'visible' });
      await assertExpectedDetailLanding(session.page);
      const detail = await extractProductInfoFromPage(session.page, {
        screenshot: opts.screenshot,
        label: `open-result-${slugify(query)}-${index}`
      });
      return {
        query,
        index,
        picked,
        detail,
        state: detail.state,
        url: detail.url,
        title: detail.title,
        screenshotPath: detail.screenshotPath,
        requiresUserAction: detail.requiresUserAction,
        resume: detail.requiresUserAction
          ? { action: 'open-result', query, index, attemptsRemaining: 1 }
          : undefined,
        networkTap: this.networkTap.records.slice(0, 15)
      };
    } finally {
      await session.cleanup();
    }
  }

  // Direct-open flow that bypasses search entirely. Use this when you already
  // have a stable href from a prior search — search results re-rank between
  // calls (ad slots, personalization), so opening by index can drift to a
  // different listing than the agent intended.
  async openByHref(href: string, opts: DetailOptions = {}): Promise<OpenResultResponse> {
    if (!isAllowedProductUrl(href)) {
      throw new Error('open-href only accepts https://item.taobao.com or https://detail.tmall.com product URLs');
    }
    const session = await this.launchSession();
    this.networkTap.attach(session.page);
    try {
      await session.page.goto(href, { waitUntil: 'domcontentloaded' });
      await session.page.locator('body').waitFor({ state: 'visible' });
      await assertExpectedDetailLanding(session.page);
      const detail = await extractProductInfoFromPage(session.page, {
        screenshot: opts.screenshot,
        label: 'open-href'
      });
      const synthesizedTitle = detail.name ?? detail.title;
      const picked = {
        index: 0,
        title: synthesizedTitle,
        price: detail.price,
        sales: detail.sales,
        shop: detail.shop,
        href,
        rawText: synthesizedTitle,
        platform: detectPlatform(href, detail.shop)
      };
      return {
        query: '',
        index: 0,
        picked,
        detail,
        state: detail.state,
        url: detail.url,
        title: detail.title,
        screenshotPath: detail.screenshotPath,
        requiresUserAction: detail.requiresUserAction,
        resume: detail.requiresUserAction
          ? { action: 'open-href', href, attemptsRemaining: 1 }
          : undefined,
        networkTap: this.networkTap.records.slice(0, 15)
      };
    } finally {
      await session.cleanup();
    }
  }

  async stageVisualInspection(href: string): Promise<VisualInspectionResponse> {
    if (!isAllowedProductUrl(href)) {
      throw new Error('visual-open only accepts https://item.taobao.com or https://detail.tmall.com product URLs');
    }

    const session = await this.launchSession({ foreground: true });
    let keepPageOpen = false;
    try {
      if (!session.attached) {
        throw new Error('visual-open requires an attached CDP browser');
      }

      // Retire only tabs created by this workflow. Never close arbitrary user
      // tabs in the dedicated profile, even when their URL looks similar.
      for (const staged of await findStagedVisualPages(session)) {
        await staged.close().catch(() => {});
      }

      this.networkTap.attach(session.page);
      await session.page.goto(href, { waitUntil: 'domcontentloaded' });
      await session.page.locator('body').waitFor({ state: 'visible' });
      await assertExpectedDetailLanding(session.page);
      const detail = await extractProductInfoFromPage(session.page, {
        screenshot: true,
        label: 'visual-open'
      });
      await session.page.evaluate(
        (name) => { window.name = name; },
        `${VISUAL_WINDOW_NAME_PREFIX}${encodeURIComponent(href)}`
      );
      await session.page.bringToFront();
      keepPageOpen = true;

      const synthesizedTitle = detail.name ?? detail.title;
      return {
        query: '',
        index: 0,
        picked: {
          index: 0,
          title: synthesizedTitle,
          price: detail.price,
          sales: detail.sales,
          shop: detail.shop,
          href,
          rawText: synthesizedTitle,
          platform: detectPlatform(href, detail.shop)
        },
        detail,
        state: detail.state,
        url: detail.url,
        title: detail.title,
        screenshotPath: detail.screenshotPath,
        requiresUserAction: detail.requiresUserAction,
        resume: detail.requiresUserAction
          ? { action: 'visual-resume', href, attemptsRemaining: 1 }
          : undefined,
        networkTap: this.networkTap.records.slice(0, 15),
        visualInspection: {
          staged: true,
          tabLeftOpen: true,
          marker: VISUAL_TAB_MARKER,
          expectedHref: href,
          expectedItemId: itemIdFromHref(href),
          observedUrl: detail.url,
          observedTitle: detail.title
        }
      };
    } finally {
      await session.cleanup({ keepPageOpen });
    }
  }

  async resumeVisualInspection(): Promise<VisualInspectionResponse> {
    const session = await this.launchSession();
    let keepPageOpen = false;
    try {
      if (!session.attached) {
        throw new Error('visual-resume requires an attached CDP browser');
      }
      const stagedPages = await findStagedVisualPages(session);
      if (stagedPages.length !== 1) {
        throw new Error(`visual-resume requires exactly one staged tab; found ${stagedPages.length}`);
      }

      const staged = stagedPages[0];
      const expectedHref = expectedHrefFromWindowName(await visualWindowName(staged));
      if (!expectedHref || !isAllowedProductUrl(expectedHref)) {
        throw new Error('staged visual tab lost its exact product URL ownership marker');
      }
      await session.page.close().catch(() => {});
      this.networkTap.attach(staged);
      await staged.locator('body').waitFor({ state: 'visible' });
      await assertExpectedDetailLanding(staged);
      const detail = await extractProductInfoFromPage(staged, {
        screenshot: true,
        label: 'visual-resume'
      });
      await staged.bringToFront();
      keepPageOpen = true;

      const synthesizedTitle = detail.name ?? detail.title;
      return {
        query: '',
        index: 0,
        picked: {
          index: 0,
          title: synthesizedTitle,
          price: detail.price,
          sales: detail.sales,
          shop: detail.shop,
          href: expectedHref,
          rawText: synthesizedTitle,
          platform: detectPlatform(expectedHref, detail.shop)
        },
        detail,
        state: detail.state,
        url: detail.url,
        title: detail.title,
        screenshotPath: detail.screenshotPath,
        requiresUserAction: detail.requiresUserAction,
        resume: detail.requiresUserAction
          ? { action: 'visual-resume', href: expectedHref, attemptsRemaining: 0 }
          : undefined,
        networkTap: this.networkTap.records.slice(0, 15),
        visualInspection: {
          staged: true,
          tabLeftOpen: true,
          marker: VISUAL_TAB_MARKER,
          expectedHref,
          expectedItemId: itemIdFromHref(expectedHref),
          observedUrl: detail.url,
          observedTitle: detail.title
        }
      };
    } finally {
      await session.cleanup({ keepPageOpen });
    }
  }

  async closeVisualInspection(): Promise<VisualInspectionCloseResponse> {
    const session = await this.launchSession();
    try {
      if (!session.attached) {
        throw new Error('visual-close requires an attached CDP browser');
      }
      const stagedPages = await findStagedVisualPages(session);
      for (const page of stagedPages) {
        await page.close().catch(() => {});
      }
      return { marker: VISUAL_TAB_MARKER, closedCount: stagedPages.length };
    } finally {
      await session.cleanup();
    }
  }

  async downloadImages(query: string, index: number, outputDir?: string): Promise<DownloadImagesResponse> {
    const result = await this.openResult(query, index);
    if (result.requiresUserAction || !result.detail || !result.picked) {
      throw new Error(
        `Image download blocked by ${result.state ?? 'user-action'} at ${result.url ?? 'unknown URL'}`
      );
    }
    const imageUrls = collectInterestingImageUrls([...result.detail.imageUrls, result.picked.thumbnailUrl]).slice(0, 20);

    const config = loadConfig();
    const baseDir = outputDir ?? path.join(config.downloadsDir, 'galleries', `${slugify(result.picked.title)}-${Date.now()}`);
    fs.mkdirSync(baseDir, { recursive: true });

    const files = [];
    for (const [position, url] of imageUrls.entries()) {
      const response = await fetch(url, {
        headers: {
          'user-agent':
            'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
          referer: result.detail.url || 'https://www.taobao.com/'
        }
      });

      if (!response.ok) {
        continue;
      }

      const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
      const bytes = Buffer.from(await response.arrayBuffer());
      const filename = `${String(position + 1).padStart(2, '0')}${extensionFromUrl(url, contentType)}`;
      const filePath = path.join(baseDir, filename);
      fs.writeFileSync(filePath, bytes);
      files.push({
        url,
        filePath,
        contentType,
        bytes: bytes.length
      });
    }

    return {
      query,
      index,
      picked: result.picked,
      detail: result.detail,
      downloadDir: baseDir,
      files
    };
  }

  doctor() {
    return doctor();
  }
}
