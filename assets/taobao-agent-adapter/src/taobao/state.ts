import { TaobaoPageState } from './types.js';

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

export function inferPageState(url: string, title: string, visibleText: string): TaobaoPageState {
  const u = url.toLowerCase();
  const t = `${title}
${visibleText}`.toLowerCase();

  if (includesAny(u, ['login.taobao.com', 'login.tmall.com']) || includesAny(t, ['登录', 'sign in', 'please log in', '亲，请登录'])) {
    return 'login-wall';
  }

  if (includesAny(t, ['验证码', 'verify', '安全验证', 'security verification', '滑块'])) {
    return 'verification-wall';
  }

  if (includesAny(u, ['item.taobao.com', 'detail.tmall.com'])) {
    return 'product-detail';
  }

  if (u.includes('s.taobao.com/search')) {
    return 'search-results';
  }

  if (includesAny(u, ['taobao.com', 'www.taobao.com'])) {
    if (includesAny(t, ['淘宝', 'taobao'])) {
      return 'home';
    }
  }

  return 'unknown';
}
