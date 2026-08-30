import { TaobaoPageState } from './types.js';

function parseUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function isHost(hostname: string, expected: string): boolean {
  return hostname === expected || hostname.endsWith(`.${expected}`);
}

export function inferPageState(url: string, title: string, visibleText: string): TaobaoPageState {
  const parsed = parseUrl(url);
  const hostname = parsed?.hostname.toLowerCase() ?? '';
  const pathname = parsed?.pathname.toLowerCase() ?? '';
  const normalizedTitle = title.replace(/\s+/g, ' ').trim().toLowerCase();
  const evidenceText = `${title}\n${visibleText.slice(0, 4000)}`.toLowerCase();

  const loginHost = hostname === 'login.taobao.com' || hostname === 'login.tmall.com';
  // "亲，请登录" is ordinary header chrome on otherwise-readable product
  // pages. Only a dedicated login host or an explicit blocking prompt is a
  // login wall.
  const loginPrompt = /请登录后(?:继续|查看|操作|购买)|登录后才能(?:继续|查看|操作)|账号登录\s+短信登录|扫码登录\s+密码登录|please log in to continue|sign in to (?:taobao|tmall) to continue/i;
  if (loginHost || loginPrompt.test(evidenceText)) {
    return 'login-wall';
  }

  const verificationHost =
    isHost(hostname, 'sec.taobao.com') ||
    isHost(hostname, 'punish.taobao.com') ||
    pathname.includes('/_____tmd_____/');
  const verificationTitle = /^(?:淘宝\s*[-—|]\s*)?(?:安全验证|访问验证|security verification|verify you are human)$/i;
  const verificationPrompt =
    /(?:请|需要|完成|进行|通过|按住|拖动|滑动).{0,24}(?:安全验证|访问验证|人机验证|滑块|拼图)|(?:输入|填写|刷新|获取).{0,12}验证码|验证码.{0,12}(?:输入|错误|过期|刷新|看不清)|verify (?:that )?you are human|complete (?:the )?(?:security )?verification/i;
  if (verificationHost || verificationTitle.test(normalizedTitle) || verificationPrompt.test(evidenceText)) {
    return 'verification-wall';
  }

  if (hostname === 'item.taobao.com' || hostname === 'detail.tmall.com') {
    return 'product-detail';
  }

  if (hostname === 's.taobao.com' && pathname === '/search') {
    return 'search-results';
  }

  if ((hostname === 'taobao.com' || hostname === 'www.taobao.com') && /淘宝|taobao/i.test(evidenceText)) {
    return 'home';
  }

  return 'unknown';
}
