import { ProductCandidate, ProductPlatform, ProductSummary, SellerEvaluate } from './types.js';

export interface IceContextDetail {
  price?: string;
  priceMoney?: number;
  priceTitle?: string;
  shop?: string;
  shopId?: string;
  sellerId?: string;
  sellerEvaluates?: SellerEvaluate[];
  vagueSellCount?: string;
  itemImages?: string[];
  quantity?: number;
  quantityText?: string;
}

// Pure, browser-free version of the SSR-detail extractor. Takes the raw
// `res` subtree (as `readIceContextRaw` cherrypicks it from
// `window.__ICE_APP_CONTEXT__.loaderData.home.data.res`) and returns a
// flat IceContextDetail. Lives here, separate from the Playwright glue, so
// snapshot tests can pin behaviour against real captured Taobao payloads
// without launching a browser.
export function parseIceContextDetail(raw: unknown): IceContextDetail | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, any>;

  const priceVO = r?.componentsVO?.priceVO?.price;
  const seller = r?.seller;
  const item = r?.item;
  const sku0 = r?.skuCore?.sku2info?.['0'];

  const evaluates = Array.isArray(seller?.evaluates)
    ? seller.evaluates.map((e: any) => ({
        type: String(e?.type ?? ''),
        title: e?.title ? String(e.title).trim() : undefined,
        score: e?.score ? String(e.score).trim() : undefined,
        levelText: e?.levelText ? String(e.levelText).trim() : undefined
      }) as SellerEvaluate)
    : undefined;

  const out: IceContextDetail = {
    price: priceVO?.priceText ? String(priceVO.priceText) : undefined,
    priceMoney: priceVO?.priceMoney !== undefined ? Number(priceVO.priceMoney) : undefined,
    priceTitle: priceVO?.priceTitle ? String(priceVO.priceTitle) : undefined,
    shop: seller?.shopName ? String(seller.shopName) : undefined,
    shopId: seller?.shopId ? String(seller.shopId) : undefined,
    sellerId: seller?.sellerId ? String(seller.sellerId) : undefined,
    sellerEvaluates: evaluates,
    vagueSellCount: item?.vagueSellCount ? String(item.vagueSellCount) : undefined,
    itemImages: Array.isArray(item?.images) ? item.images.map(String) : undefined,
    quantity: typeof sku0?.quantity === 'number' ? sku0.quantity : undefined,
    quantityText: sku0?.quantityText ? String(sku0.quantityText) : undefined
  };

  // If every meaningful field is empty, treat the input as unrecognized.
  const hasAnyField =
    out.price || out.shop || out.sellerId ||
    (out.itemImages && out.itemImages.length > 0) ||
    (out.sellerEvaluates && out.sellerEvaluates.length > 0);
  return hasAnyField ? out : undefined;
}

// Detail-host classification — used to decide whether DOM-fallback on a
// page that *should* expose ICE context is worth warning about.
const DETAIL_HOSTS = ['detail.tmall.com', 'item.taobao.com'] as const;

export function parseAllowedProductUrl(raw: string): URL | undefined {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return undefined;
    if (!(DETAIL_HOSTS as readonly string[]).includes(parsed.hostname.toLowerCase())) return undefined;
    if (parsed.port) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function isAllowedProductUrl(raw: string): boolean {
  return Boolean(parseAllowedProductUrl(raw));
}

export function isDetailHost(url: string): boolean {
  return isAllowedProductUrl(url);
}

const IMAGE_HOST_SUFFIXES = ['taobao.com', 'tmall.com', 'alicdn.com'];

// Province / municipality / SAR names used as the search-result location field.
// Whitelist beats blacklist here: '券后价' and similar 3-character Chinese
// price-modifier tokens used to slip past the old "first Chinese-only token"
// heuristic and end up as the location.
const LOCATION_WHITELIST = [
  '广东', '北京', '上海', '天津', '重庆', '江苏', '浙江', '安徽', '福建',
  '江西', '山东', '河南', '湖北', '湖南', '广西', '海南', '四川', '贵州',
  '云南', '陕西', '甘肃', '青海', '台湾', '内蒙古', '辽宁', '吉林',
  '黑龙江', '山西', '河北', '新疆', '宁夏', '西藏', '香港', '澳门'
];

// Promotional, fulfilment and guarantee labels surfaced in search-result rawText.
// Extracted as structured `tags` so callers can score listings without re-parsing.
const TAG_PATTERNS: Array<{ tag: string; pattern: RegExp }> = [
  { tag: '包邮', pattern: /包邮/ },
  { tag: '免运费', pattern: /免运费/ },
  { tag: '可开发票', pattern: /可开发票/ },
  { tag: '对公支付', pattern: /对公支付/ },
  { tag: '假一赔四', pattern: /假一赔四/ },
  { tag: '退货宝', pattern: /退货宝/ },
  { tag: '公益宝贝', pattern: /公益宝贝/ },
  { tag: '次日达', pattern: /次日达/ },
  { tag: '24小时内发', pattern: /24\s*小时内发/ },
  { tag: '48小时内发', pattern: /48\s*小时内发/ },
  { tag: '券后价', pattern: /券后价/ }
];

const SHOP_SUFFIX_REGEX = /(旗舰店|官方店|专营店|专卖店|店铺|店|电子|科技|商行|商城|科创|国际|有限公司)$/;

// Generic UI-chrome strings that match SHOP_SUFFIX_REGEX but are not real
// shop names (left-nav buttons, footer prompts, account widgets). Used to
// filter both anchor-based and rawText-based shop extraction.
export const SHOP_NAME_BLACKLIST = new Set([
  '收藏的店铺',
  '我的店铺',
  '店铺收藏',
  '关注店铺',
  '本店推荐',
  '进店',
  '搜本店',
  '店铺',
  '收藏',
  '收藏店铺',
  '免费开店',
  '我要开店',
  '我的店',
  '本店',
  '老店',
  '总店',
  '分店',
  '网店'
]);

export function extractShopFromHeadText(text: string): string | undefined {
  // Detail-page shop names (e.g. "示例旗舰店") usually sit in the first
  // ~500 chars of the rendered body, near a 4.x rating and 好评/退款 stats.
  // The anchor-based selector misses them when the link uses a non-text
  // child (icon + nested span). Token-scan the head as a fallback.
  const head = text.slice(0, 500);
  const tokens = head.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (!SHOP_SUFFIX_REGEX.test(token)) continue;
    if (SHOP_NAME_BLACKLIST.has(token)) continue;
    // Single-character bare "店" is too noisy.
    if (token.length < 2) continue;
    return token;
  }
  return undefined;
}

// Title patterns indicating a domestic clone/replacement, not the original
// brand-name IC. We track a small allow-list of vendor-suffix codes (e.g.
// `-HXY` = 华轩阳, ICM-42688P clone) and a few marketing keywords used on
// listings for clones / second-source parts.
const CLONE_SUFFIX_PATTERNS: RegExp[] = [
  /-HXY\b/i,
  /-CMSEMICON\b/i,
  /-CXSC\b/i
];

const CLONE_KEYWORD_PATTERNS: RegExp[] = [
  /替代品/,
  /平替/,
  /国产替代/,
  /国产化(?!装|工艺)/
];

// Product-image curation. Search-result candidates and product-detail pages
// expose every <img>, including store-banner JPGs and small UI chrome PNGs.
// `pickProductImages` returns only the most-likely product photos so callers
// can show 1–3 images for verification without scrolling through 30 URLs.
//
// Two dimension forms appear in alicdn URLs:
//   `-W-H.<ext>`  (filename suffix, both `tps/...` and `imgextra/...` paths)
//   `_WxH<flags>.<ext>`  (CDN resize directive, e.g. `_760x760q30.jpg`)
// We only need the smaller of the two to be below the threshold to bail.
const DIMENSION_DASH_REGEX = /-(\d{2,4})-(\d{2,4})\.(?:jpg|jpeg|png|webp|avif|gif)/i;
const DIMENSION_X_REGEX = /_(\d{2,4})x(\d{2,4})(?:q\d+)?\./i;
const MIN_PRODUCT_IMAGE_DIMENSION = 200;

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizePrice(raw?: string): string | undefined {
  if (!raw) return undefined;
  return `¥${raw.replace(/\s+/g, '')}`;
}

function normalizeImageUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (!value || value.startsWith('data:')) return undefined;
  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  return undefined;
}

function isAllowedImageHost(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return IMAGE_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

export function collectInterestingImageUrls(urls: Array<string | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of urls) {
    const normalized = normalizeImageUrl(raw);
    if (!normalized) continue;

    const lower = normalized.toLowerCase();
    const looksLikeImage =
      /(\.jpg|\.jpeg|\.png|\.webp|\.avif|\.gif)(?:$|[?#])/.test(lower) ||
      lower.includes('/imgextra/') ||
      lower.includes('/bao/uploaded/') ||
      lower.includes('/uploaded/') ||
      lower.includes('/img/') ||
      lower.includes('tbcdn');

    if (!isAllowedImageHost(normalized) || !looksLikeImage) continue;
    if (seen.has(normalized)) continue;

    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

export function filterProductCandidates(items: ProductCandidate[]): ProductCandidate[] {
  const seen = new Map<string, ProductCandidate>();
  const out: ProductCandidate[] = [];

  for (const item of items) {
    const href = item.href.trim();
    const text = normalizeWhitespace(item.text);

    if (!href || !text) continue;
    if (!isAllowedProductUrl(href)) continue;

    const imageUrls = collectInterestingImageUrls(item.imageUrls ?? [item.thumbnailUrl]);
    const thumbnailUrl = normalizeImageUrl(item.thumbnailUrl) ?? imageUrls[0];

    const existing = seen.get(href);
    if (existing) {
      existing.imageUrls = collectInterestingImageUrls([...(existing.imageUrls ?? []), ...imageUrls]);
      existing.thumbnailUrl = existing.thumbnailUrl ?? thumbnailUrl;
      if (!existing.text && text) {
        existing.text = text;
      }
      continue;
    }

    const normalized: ProductCandidate = { text, href };
    if (thumbnailUrl) normalized.thumbnailUrl = thumbnailUrl;
    if (imageUrls.length > 0) normalized.imageUrls = imageUrls;

    seen.set(href, normalized);
    out.push(normalized);
  }

  return out;
}

export function detectPlatform(href: string, shop?: string): ProductPlatform {
  const isTmall = parseAllowedProductUrl(href)?.hostname.toLowerCase() === 'detail.tmall.com';
  if (!isTmall) return 'taobao';
  return shop && /旗舰店$/.test(shop) ? 'tmall-flagship' : 'tmall';
}

export function extractTags(rawText: string): string[] {
  const out: string[] = [];
  for (const { tag, pattern } of TAG_PATTERNS) {
    if (pattern.test(rawText) && !out.includes(tag)) {
      out.push(tag);
    }
  }
  return out;
}

export function detectPreviouslyBought(rawText: string): boolean {
  return /买过的店|我买过的宝贝/.test(rawText);
}

export function extractShopAgeYears(rawText: string): number | undefined {
  const match = rawText.match(/(\d+)\s*年老店/);
  if (!match) return undefined;
  const years = Number.parseInt(match[1], 10);
  return Number.isFinite(years) ? years : undefined;
}

export interface CloneDetection {
  suspect: boolean;
  reason?: string;
}

export function detectClone(title: string): CloneDetection {
  for (const re of CLONE_SUFFIX_PATTERNS) {
    const match = title.match(re);
    if (match) {
      return { suspect: true, reason: `suffix:${match[0]}` };
    }
  }
  for (const re of CLONE_KEYWORD_PATTERNS) {
    const match = title.match(re);
    if (match) {
      return { suspect: true, reason: `keyword:${match[0]}` };
    }
  }
  return { suspect: false };
}

function extractImageDimensions(url: string): { w: number; h: number } | undefined {
  const dashMatch = url.match(DIMENSION_DASH_REGEX);
  if (dashMatch) return { w: Number.parseInt(dashMatch[1], 10), h: Number.parseInt(dashMatch[2], 10) };

  const xMatch = url.match(DIMENSION_X_REGEX);
  if (xMatch) return { w: Number.parseInt(xMatch[1], 10), h: Number.parseInt(xMatch[2], 10) };

  return undefined;
}

function isLikelyProductImage(url: string): boolean {
  const lower = url.toLowerCase();

  // Skip obvious shop chrome (banners, manager-uploaded asset, store icons).
  if (lower.includes('shopmanager')) return false;

  const dims = extractImageDimensions(lower);
  if (dims && (dims.w < MIN_PRODUCT_IMAGE_DIMENSION || dims.h < MIN_PRODUCT_IMAGE_DIMENSION)) {
    return false;
  }

  return true;
}

export function pickProductImages(imageUrls: string[], limit = 3): string[] {
  const filtered = imageUrls.filter(isLikelyProductImage);

  // Item-picture URLs are the strongest signal — these are the explicit
  // gallery shots Taobao serves for the listing.
  const primary = filtered.filter((url) => url.toLowerCase().includes('item_pic'));
  if (primary.length >= limit) return primary.slice(0, limit);

  const rest = filtered.filter((url) => !url.toLowerCase().includes('item_pic'));
  return [...primary, ...rest].slice(0, limit);
}

// Best-effort price-tier extraction from rendered detail-page text. Real
// staircase pricing usually lives in the SKU panel (rendered behind a
// click) or the mtop detail API, neither of which we currently parse — so
// these regexes only catch tiers that have leaked into the visible body.
export interface PriceTier {
  qty: string;
  price: string;
}

export function extractPriceTiers(text: string): PriceTier[] {
  const out: PriceTier[] = [];
  const seen = new Set<string>();
  const re = /(\d+\+?\s*(?:件|个|颗|片|只|pcs))(?:\s*以上|\s*及以上)?\s*[¥￥]\s*([0-9]+(?:\.[0-9]+)?)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const key = `${match[1]}|${match[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ qty: match[1].replace(/\s+/g, ''), price: `¥${match[2]}` });
  }
  return out;
}

export function extractMOQ(text: string): string | undefined {
  const match = text.match(/起订(?:量|数)?[:：]?\s*(\d+)\s*(件|个|颗|片|只|pcs)?/);
  if (!match) return undefined;
  return `${match[1]}${match[2] ?? '件'}`;
}

export function summarizeCandidate(candidate: ProductCandidate, index: number): ProductSummary {
  const rawText = normalizeWhitespace(candidate.text);
  const priceMatch = rawText.match(/¥\s*([0-9]+(?:\s*\.\s*[0-9]+)?)/);
  const salesMatch = rawText.match(/(\d+(?:\.\d+)?(?:万|千)?\+?(?:人付款|人收货|已售))/);

  let title = rawText;
  if (priceMatch && typeof priceMatch.index === 'number') {
    title = rawText.slice(0, priceMatch.index).trim();
  }
  if (!title) {
    title = `Item ${index + 1}`;
  }

  let tail = rawText;
  if (priceMatch && typeof priceMatch.index === 'number') {
    tail = rawText.slice(priceMatch.index + priceMatch[0].length).trim();
  }
  if (salesMatch) {
    tail = tail.replace(salesMatch[0], '').trim();
  }

  const tokens = tail.split(' ').filter(Boolean);
  const location = tokens.find((token) => LOCATION_WHITELIST.includes(token));
  const shopToken = [...tokens].reverse().find((token) => SHOP_SUFFIX_REGEX.test(token));
  const shop = shopToken;

  const tags = extractTags(rawText);
  const previouslyBought = detectPreviouslyBought(rawText) || undefined;
  const shopAgeYears = extractShopAgeYears(rawText);
  const platform = detectPlatform(candidate.href, shop);
  const cloneCheck = detectClone(title);

  return {
    index,
    title,
    price: normalizePrice(priceMatch?.[1]),
    sales: salesMatch?.[1],
    location,
    shop,
    href: candidate.href,
    thumbnailUrl: candidate.thumbnailUrl ?? candidate.imageUrls?.[0],
    rawText,
    platform,
    previouslyBought,
    shopAgeYears,
    tags: tags.length > 0 ? tags : undefined,
    suspectClone: cloneCheck.suspect || undefined,
    suspectReason: cloneCheck.reason
  };
}
