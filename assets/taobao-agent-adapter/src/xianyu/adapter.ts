import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { launchPersistentTaobaoContext, type BrowserSession } from '../taobao/browser.js';
import { loadConfig } from '../taobao/config.js';
import {
  detectXianyuRiskSignals,
  inferXianyuPageState,
  parseAllowedXianyuItemUrl
} from './parser.js';
import type {
  XianyuCandidate,
  XianyuDetailResult,
  XianyuPageState,
  XianyuSearchResult
} from './types.js';

type LaunchSession = () => Promise<BrowserSession>;

interface PageSignals {
  state: XianyuPageState;
  url: string;
  title: string;
  bodyText: string;
}

function normalizeAssetUrl(input?: string): string | undefined {
  if (!input) return undefined;
  if (input.startsWith('//')) return `https:${input}`;
  try {
    const url = new URL(input);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export class XianyuAgentAdapter {
  constructor(private readonly launchSession: LaunchSession = launchPersistentTaobaoContext) {}

  private async waitForSurface(page: Page): Promise<void> {
    await page
      .waitForFunction(
        () => {
          const body = document.body?.innerText ?? '';
          return (
            document.querySelectorAll('a[href*="/item?"]').length > 0 ||
            Boolean(document.querySelector('[class^="item-main-info--"]')) ||
            /非法访问|安全验证|访问验证|扫码登录|密码登录/.test(body)
          );
        },
        undefined,
        { timeout: 15_000 }
      )
      .catch(() => {});
  }

  private async readSignals(page: Page): Promise<PageSignals> {
    const raw = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      bodyText: document.body?.innerText ?? '',
      candidateCount: document.querySelectorAll('a[href*="/item?"]').length,
      hasItemDetail: Boolean(document.querySelector('[class^="item-main-info--"]')),
      hasVerificationOverlay: Boolean(
        document.querySelector(
          'iframe[src*="captcha"], iframe[src*="punish"], [class*="baxia"], [class*="captcha"]'
        )
      )
    }));
    return {
      ...raw,
      state: inferXianyuPageState(raw)
    };
  }

  private async saveScreenshot(page: Page, label: string): Promise<string> {
    const screenshotDir = path.join(loadConfig().screenshotsDir, 'ultrasource');
    fs.mkdirSync(screenshotDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(screenshotDir, 0o700);
    const filename = `${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    const outputPath = path.join(screenshotDir, filename);
    await page.screenshot({ path: outputPath, fullPage: false });
    fs.chmodSync(outputPath, 0o600);
    return outputPath;
  }

  private async extractCandidates(page: Page): Promise<XianyuCandidate[]> {
    const raw = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLAnchorElement>('a[href*="/item?"]')].slice(0, 80).map((card) => {
        const titleNode = card.querySelector<HTMLElement>('[class^="row1-wrap-title--"]');
        const priceWrap = card.querySelector<HTMLElement>('[class^="price-wrap--"]');
        const price = priceWrap?.innerText.replace(/\s+/g, '') || undefined;
        const wants = card.querySelector<HTMLElement>('[class^="price-desc--"] [title]')?.title;
        const locationNode = card.querySelector<HTMLElement>('[class^="seller-text-wrap--"]');
        const sellerSignal = card.querySelector<HTMLElement>('[class^="credit-container--"] [title]')?.title;
        const serviceTags = [...card.querySelectorAll<HTMLElement>('[class^="row2-wrap-"] [title]')]
          .map((node) => node.title.trim())
          .filter(Boolean);
        return {
          href: card.href,
          title: titleNode?.title?.trim() || titleNode?.innerText.trim() || card.innerText.trim(),
          price,
          wants,
          location: locationNode?.title?.trim() || locationNode?.innerText.trim() || undefined,
          sellerSignal,
          serviceTags,
          imageUrl: card.querySelector<HTMLImageElement>('img')?.currentSrc || card.querySelector<HTMLImageElement>('img')?.src
        };
      })
    );

    const seen = new Set<string>();
    const candidates: XianyuCandidate[] = [];
    for (const entry of raw) {
      const allowed = parseAllowedXianyuItemUrl(entry.href);
      if (!allowed) continue;
      const itemId = allowed.searchParams.get('id')!;
      if (seen.has(itemId)) continue;
      seen.add(itemId);
      const riskText = [entry.title, ...entry.serviceTags].join(' ');
      candidates.push({
        index: candidates.length + 1,
        itemId,
        title: entry.title,
        price: entry.price,
        wants: entry.wants,
        location: entry.location,
        sellerSignal: entry.sellerSignal,
        serviceTags: entry.serviceTags,
        riskSignals: detectXianyuRiskSignals(riskText),
        href: allowed.toString(),
        imageUrl: normalizeAssetUrl(entry.imageUrl)
      });
    }
    return candidates;
  }

  async search(query: string): Promise<XianyuSearchResult> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error('Ultrasource search requires a non-empty query');

    const session = await this.launchSession();
    try {
      const target = new URL('https://www.goofish.com/search');
      target.searchParams.set('q', normalizedQuery);
      await session.page.goto(target.toString(), { waitUntil: 'domcontentloaded' });
      await this.waitForSurface(session.page);
      const signals = await this.readSignals(session.page);
      const candidates = signals.state === 'search-results' ? await this.extractCandidates(session.page) : [];
      const actionable = signals.state === 'login-wall' || signals.state === 'verification-wall';
      const screenshotPath = actionable
        ? await this.saveScreenshot(session.page, `xianyu-${signals.state}`)
        : undefined;
      return {
        platform: 'xianyu',
        mode: 'Ultrasource',
        query: normalizedQuery,
        state: signals.state,
        url: signals.url,
        title: signals.title,
        candidateCount: candidates.length,
        candidates,
        requiresUserAction: actionable ? true : undefined,
        screenshotPath
      };
    } finally {
      await session.cleanup();
    }
  }

  async openByHref(input: string, options: { screenshot?: boolean } = {}): Promise<XianyuDetailResult> {
    const allowed = parseAllowedXianyuItemUrl(input);
    if (!allowed) {
      throw new Error('Ultrasource open-href only accepts an HTTPS www.goofish.com/item URL with a numeric id');
    }
    const expectedItemId = allowed.searchParams.get('id')!;

    const session = await this.launchSession();
    try {
      await session.page.goto(allowed.toString(), { waitUntil: 'domcontentloaded' });
      await this.waitForSurface(session.page);
      const signals = await this.readSignals(session.page);
      const actionable = signals.state === 'login-wall' || signals.state === 'verification-wall';
      if (actionable) {
        return {
          platform: 'xianyu',
          mode: 'Ultrasource',
          state: signals.state,
          url: signals.url,
          title: signals.title,
          sellerSignals: [],
          imageUrls: [],
          riskSignals: [],
          requiresUserAction: true,
          screenshotPath: await this.saveScreenshot(session.page, `xianyu-${signals.state}`)
        };
      }

      const finalUrl = parseAllowedXianyuItemUrl(signals.url);
      if (!finalUrl || finalUrl.searchParams.get('id') !== expectedItemId) {
        throw new Error(`Ultrasource unexpected redirect: ${signals.url}`);
      }
      if (signals.state !== 'item-detail') {
        throw new Error(`Ultrasource expected an item detail page, observed ${signals.state}`);
      }

      const raw = await session.page.evaluate(() => {
        const main = document.querySelector<HTMLElement>('[class^="item-main-info--"]');
        const description = main?.querySelector<HTMLElement>('[class^="desc--"]')?.innerText.trim();
        const mainText = main?.innerText.replace(/\s+/g, ' ').trim() ?? '';
        const sellerSignals = [...document.querySelectorAll<HTMLElement>('[class^="item-user-info-label--"]')]
          .map((node) => node.innerText.trim())
          .filter(Boolean);
        const imageUrls = [...document.querySelectorAll<HTMLImageElement>('[class^="item-main-window--"] img')]
          .map((image) => image.currentSrc || image.src)
          .filter(Boolean);
        return {
          description,
          mainText,
          price: main?.querySelector<HTMLElement>('[class^="price--"]')?.innerText.trim(),
          postage: main?.querySelector<HTMLElement>('[class^="post--"]')?.innerText.trim(),
          condition: main?.querySelector<HTMLElement>('[class^="labels--"] [class^="value--"]')?.innerText.trim(),
          seller: document.querySelector<HTMLElement>('[class^="item-user-info-nick--"]')?.innerText.trim(),
          sellerSignals,
          imageUrls
        };
      });
      const wants = raw.mainText.match(/([\d.万+]+人想要)/)?.[1];
      const views = raw.mainText.match(/([\d.万+]+浏览)/)?.[1];
      const description = raw.description || signals.title.replace(/_闲鱼$/, '');
      const imageUrls = [...new Set(raw.imageUrls.map(normalizeAssetUrl).filter((value): value is string => Boolean(value)))];
      const screenshotPath = options.screenshot === false
        ? undefined
        : await this.saveScreenshot(session.page, `xianyu-item-${expectedItemId}`);

      return {
        platform: 'xianyu',
        mode: 'Ultrasource',
        state: 'item-detail',
        url: finalUrl.toString(),
        title: description.slice(0, 240),
        itemId: expectedItemId,
        description,
        price: raw.price ? `¥${raw.price}` : undefined,
        postage: raw.postage,
        wants,
        views,
        condition: raw.condition,
        seller: raw.seller,
        sellerSignals: raw.sellerSignals,
        imageUrls,
        riskSignals: detectXianyuRiskSignals([description, raw.mainText].join(' ')),
        screenshotPath
      };
    } finally {
      await session.cleanup();
    }
  }
}
