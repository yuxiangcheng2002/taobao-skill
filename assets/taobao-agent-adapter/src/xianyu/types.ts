export type XianyuPageState =
  | 'search-results'
  | 'item-detail'
  | 'login-wall'
  | 'verification-wall'
  | 'unknown';

export interface XianyuCandidate {
  index: number;
  itemId: string;
  title: string;
  price?: string;
  wants?: string;
  location?: string;
  sellerSignal?: string;
  serviceTags: string[];
  riskSignals: string[];
  href: string;
  imageUrl?: string;
}

export interface XianyuSearchResult {
  platform: 'xianyu';
  mode: 'Ultrasource';
  query: string;
  state: XianyuPageState;
  url: string;
  title: string;
  candidateCount: number;
  candidates: XianyuCandidate[];
  requiresUserAction?: true;
  screenshotPath?: string;
}

export interface XianyuDetailResult {
  platform: 'xianyu';
  mode: 'Ultrasource';
  state: XianyuPageState;
  url: string;
  title: string;
  itemId?: string;
  description?: string;
  price?: string;
  postage?: string;
  wants?: string;
  views?: string;
  condition?: string;
  seller?: string;
  sellerSignals: string[];
  imageUrls: string[];
  riskSignals: string[];
  requiresUserAction?: true;
  screenshotPath?: string;
}
