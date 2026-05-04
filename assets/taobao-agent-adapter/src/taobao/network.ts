import type { Page, Response } from 'playwright-core';
import { TaobaoNetworkRecord } from './types.js';

const PREVIEW_CHARS = 600;
// Cap per-body capture to keep memory bounded when the tap stays attached for
// many requests. mtop responses are typically well under this; HTML pages can
// exceed it but we only retain text/* anyway.
const FULL_BODY_CHAR_CAP = 200_000;

// Patterns whose responses we retain in full (subject to the cap above) so a
// downstream parser can read structured fields without re-fetching. Anything
// not matching is still recorded with a short preview, which is enough to
// audit traffic shape without bloating the result.
//
// The /h5/ prefix anchors these to the actual API path so query-string content
// (`PcTaobao`, `PcTranslateConfig`, etc.) does not produce false matches.
const FULL_BODY_URL_PATTERNS: RegExp[] = [
  /\/h5\/mtop\.taobao\.detail\.getdetail/i,
  /\/h5\/mtop\.taobao\.detail\.getdesc/i,
  /\/h5\/mtop\.taobao\.pcdetail\./i
];

function looksInteresting(url: string, contentType: string): boolean {
  const u = url.toLowerCase();
  const c = contentType.toLowerCase();
  return (
    u.includes('taobao') &&
    (c.includes('json') || c.includes('javascript') || u.includes('search') || u.includes('detail') || u.includes('h5api'))
  );
}

export function shouldKeepFullBody(url: string): boolean {
  return FULL_BODY_URL_PATTERNS.some((pattern) => pattern.test(url));
}

export class NetworkTap {
  readonly records: TaobaoNetworkRecord[] = [];

  attach(page: Page) {
    page.on('response', async (response: Response) => {
      try {
        const url = response.url();
        const headers = await response.allHeaders();
        const contentType = headers['content-type'] ?? '';
        if (!looksInteresting(url, contentType)) return;

        const text = await response.text();
        const keepFull = shouldKeepFullBody(url);
        this.records.push({
          url,
          status: response.status(),
          contentType,
          bodyPreview: text.slice(0, PREVIEW_CHARS),
          fullBody: keepFull ? text.slice(0, FULL_BODY_CHAR_CAP) : undefined
        });
      } catch {
        // Best-effort capture only.
      }
    });
  }
}
