import type { XianyuPageState } from './types.js';

const ITEM_HOST = 'www.goofish.com';
const STANDALONE_TRIGGER = /(^|[^A-Za-z0-9_])Ultrasource(?=$|[^A-Za-z0-9_])/;

export function hasStandaloneUltrasource(input: string): boolean {
  return STANDALONE_TRIGGER.test(input);
}

export function parseAllowedXianyuItemUrl(input: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== ITEM_HOST ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    parsed.pathname !== '/item'
  ) {
    return null;
  }

  const itemId = parsed.searchParams.get('id');
  if (!itemId || !/^\d{6,20}$/.test(itemId)) return null;

  const canonical = new URL(`https://${ITEM_HOST}/item`);
  canonical.searchParams.set('id', itemId);
  const categoryId = parsed.searchParams.get('categoryId');
  if (categoryId && /^\d{1,20}$/.test(categoryId)) {
    canonical.searchParams.set('categoryId', categoryId);
  }
  return canonical;
}

export function isAllowedXianyuItemUrl(input: string): boolean {
  return parseAllowedXianyuItemUrl(input) !== null;
}

export function inferXianyuPageState(input: {
  url: string;
  title: string;
  bodyText: string;
  candidateCount?: number;
  hasItemDetail?: boolean;
  hasVerificationOverlay?: boolean;
}): XianyuPageState {
  const title = input.title.trim();
  const body = input.bodyText.replace(/\s+/g, ' ').trim();
  let parsed: URL | null = null;
  try {
    parsed = new URL(input.url);
  } catch {
    // The structured signals below still produce an actionable state.
  }

  const verificationTitle = /^(安全验证|访问验证|非法访问)(?:\s*[-_|].*)?$/i.test(title);
  const verificationPhrase =
    /为了保障您的体验，请使用正常浏览器访问闲鱼|请.{0,12}(?:拖动|按住|完成).{0,12}(?:滑块|拼图|安全)?验证|访问过于频繁|操作过于频繁/.test(
      body
    );
  if (input.hasVerificationOverlay || verificationTitle || verificationPhrase) {
    return 'verification-wall';
  }

  const loginHostOrPath = Boolean(
    parsed &&
      (parsed.hostname === 'login.taobao.com' ||
        parsed.hostname === 'login.goofish.com' ||
        /(?:^|\/)(?:login|signin)(?:\/|$)/i.test(parsed.pathname))
  );
  const loginPhrase = /(?:扫码登录|密码登录|手机号登录|登录后才能继续|请先登录)/.test(body);
  if (loginHostOrPath && loginPhrase) return 'login-wall';

  if (parsed?.hostname === ITEM_HOST && parsed.pathname === '/item' && input.hasItemDetail) {
    return 'item-detail';
  }
  if (
    parsed?.hostname === ITEM_HOST &&
    parsed.pathname === '/search' &&
    (input.candidateCount ?? 0) > 0
  ) {
    return 'search-results';
  }
  return 'unknown';
}

export function detectXianyuRiskSignals(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ');
  const signals = new Set<string>();

  if (/非实物|虚拟商品|网盘|链接发货|自动发货|电子档/.test(normalized)) {
    signals.add('digital-or-nonphysical');
  }
  if (/不退不换|概不退(?:货|款)|售出不退|不要申请退款/.test(normalized)) {
    signals.add('no-returns');
  }
  if (/微信转账|支付宝直转|私下交易|脱离平台|先款后货|线下转账/.test(normalized)) {
    signals.add('off-platform-payment');
  }
  if (/高仿|复刻|原单|莆田|一比一|顶级版本/.test(normalized)) {
    signals.add('counterfeit-language');
  }
  if (/实名账号|账号出售|接码|代实名|cookie\b|session\s*token|盗号/.test(normalized)) {
    signals.add('account-or-credential');
  }
  if (/赃物|偷来的|来路不明|无锁机.*捡|丢失模式.*解锁/.test(normalized)) {
    signals.add('stolen-goods-language');
  }
  if (/无实拍|盗图|图片仅供参考|随机发货|货不对板/.test(normalized)) {
    signals.add('weak-provenance');
  }
  return [...signals];
}
