export type TaobaoPageState =
  | 'home'
  | 'search-results'
  | 'product-detail'
  | 'login-wall'
  | 'verification-wall'
  | 'unknown';

export interface TaobaoConfig {
  projectRoot: string;
  // Per-user data dir (~/.taobao-agent by default, overridable via
  // TAOBAO_DATA_DIR). Holds the browser profile, generated screenshots,
  // image downloads, and the browser-launch log — anything stateful that
  // should outlive a re-extraction of the skill folder.
  dataDir: string;
  chromiumExecutablePath: string;
  userDataDir: string;
  downloadsDir: string;
  screenshotsDir: string;
  headless: boolean;
  viewport: { width: number; height: number };
  defaultTimeoutMs: number;
}

export interface TaobaoNetworkRecord {
  url: string;
  status: number;
  contentType: string;
  bodyPreview: string;
  fullBody?: string;
}

export interface ProductCandidate {
  text: string;
  href: string;
  thumbnailUrl?: string;
  imageUrls?: string[];
}

export type ProductPlatform = 'taobao' | 'tmall' | 'tmall-flagship';

export interface ProductSummary {
  index: number;
  title: string;
  price?: string;
  sales?: string;
  location?: string;
  shop?: string;
  href: string;
  thumbnailUrl?: string;
  rawText: string;
  platform: ProductPlatform;
  previouslyBought?: boolean;
  shopAgeYears?: number;
  tags?: string[];
  suspectClone?: boolean;
  suspectReason?: string;
}

export interface PriceTier {
  qty: string;
  price: string;
}

export interface SellerEvaluate {
  type: string;          // 'desc' | 'serv' | 'post'
  title?: string;        // human-readable label, e.g. '宝贝描述'
  score?: string;        // e.g. '4.8'
  levelText?: string;    // e.g. '高'
}

export interface ProductDetail {
  state: TaobaoPageState;
  url: string;
  title: string;
  loggedInLikely: boolean;
  name?: string;
  price?: string;
  priceTitle?: string;        // e.g. '优惠促销'
  sales?: string;
  shop?: string;
  shopId?: string;
  sellerId?: string;
  sellerEvaluates?: SellerEvaluate[];
  quantity?: number;
  quantityText?: string;
  imageUrls: string[];
  productImageUrls?: string[];
  priceTiers?: PriceTier[];
  moq?: string;
  rawTextPreview: string;
  screenshotPath?: string;
  requiresUserAction?: boolean;
  // True when the primary fields (price, shop, sellerEvaluates, item images)
  // came from window.__ICE_APP_CONTEXT__ rather than DOM scraping. This is
  // the more reliable source — DOM-only listings should be treated with
  // a bit more skepticism, especially for shop and price.
  ssrSource?: 'ice-context' | 'dom';
  // Non-fatal advisories the caller should surface. Currently emitted when
  // SSR drift is suspected (Tmall / Taobao item URL but ssrSource fell back
  // to dom — usually means Taobao bumped the __ICE_APP_CONTEXT__ layout).
  warnings?: string[];
}

export interface SessionProbe {
  state: TaobaoPageState;
  url: string;
  title: string;
  loggedInLikely: boolean;
}

export interface PublicSmokeResult {
  finalUrl: string;
  title: string;
  state: TaobaoPageState;
}

export interface SearchResult {
  query: string;
  state: TaobaoPageState;
  url: string;
  title: string;
  loggedInLikely: boolean;
  candidateCount: number;
  candidates: ProductSummary[];
  networkTap: TaobaoNetworkRecord[];
  screenshotPath?: string;
  requiresUserAction?: boolean;
}

export interface OpenResultResponse {
  query: string;
  index: number;
  picked: ProductSummary;
  detail: ProductDetail;
  networkTap: TaobaoNetworkRecord[];
}

export interface DownloadedImage {
  url: string;
  filePath: string;
  contentType: string;
  bytes: number;
}

export interface DownloadImagesResponse {
  query: string;
  index: number;
  picked: ProductSummary;
  detail: ProductDetail;
  downloadDir: string;
  files: DownloadedImage[];
}
