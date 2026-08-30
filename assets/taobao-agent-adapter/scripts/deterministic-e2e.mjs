import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';

const outputDir = path.resolve(process.argv[2] ?? 'test-results/deterministic');
fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
fs.chmodSync(outputDir, 0o700);
process.env.TAOBAO_DATA_DIR ||= path.join(outputDir, 'data');

const { TaobaoAgentAdapter } = await import('../dist/src/taobao/adapter.js');
const { isAllowedProductUrl } = await import('../dist/src/taobao/parser.js');
const { XianyuAgentAdapter } = await import('../dist/src/xianyu/adapter.js');
const { isAllowedXianyuItemUrl } = await import('../dist/src/xianyu/parser.js');

function resolveBrowser() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('Deterministic E2E needs CHROMIUM_PATH or a standard Chrome/Chromium install');
  return found;
}

const detailHtml = `<!doctype html><html><head><title>MGN12 直线导轨详情</title></head><body>
<h1>MGN12H 直线导轨滑块</h1><div>¥ 12.80 100人付款 示例旗舰店 广东</div>
<img src="https://img.alicdn.com/imgextra/i1/example/main_!!0-item_pic.jpg">
<script>window.__ICE_APP_CONTEXT__={loaderData:{home:{data:{res:{
  componentsVO:{priceVO:{price:{priceText:'12.80',priceMoney:1280,priceTitle:'促销价'}}},
  seller:{shopName:'示例旗舰店',shopId:'1001',sellerId:'2002',evaluates:[{type:'desc',title:'宝贝描述',score:'4.8',levelText:'高'}]},
  item:{vagueSellCount:'100+',images:['https://img.alicdn.com/imgextra/i1/example/main_!!0-item_pic.jpg']},
  skuCore:{sku2info:{'0':{quantity:50,quantityText:'有货'}}}
}}}}};</script></body></html>`;

function searchHtml(query) {
  if (query === 'force verification wall') {
    return '<!doctype html><html><head><title>安全验证</title></head><body>请拖动滑块完成安全验证</body></html>';
  }
  return `<!doctype html><html><head><title>${query} - 淘宝搜索</title></head><body>
    <div>搜索结果 ${query}</div>
    <a href="https://item.taobao.com/item.htm?id=1001">MGN12H 直线导轨滑块 ¥12.80 100人付款 广东 示例旗舰店</a>
    <a href="https://detail.tmall.com/item.htm?id=1002">MGN12 验证码识别测试滑块 ¥18.00 20人付款 浙江 测试旗舰店</a>
    <a href="https://item.taobao.com.evil.example/item.htm?id=9999">Evil candidate</a>
  </body></html>`;
}

function xianyuSearchHtml(query) {
  if (query === 'force xianyu verification wall') {
    return '<!doctype html><html><head><title>非法访问</title></head><body>为了保障您的体验，请使用正常浏览器访问闲鱼~</body></html>';
  }
  return `<!doctype html><html><head><title>${query}_闲鱼</title></head><body>
    <a class="feeds-item-wrap--fixture" href="https://www.goofish.com/item?id=1068945084433&categoryId=126858011">
      <img src="https://img.alicdn.com/bao/uploaded/fixture-mgn12.webp">
      <div class="row1-wrap-title--fixture" title="MGN12直线导轨滑块，拆机件，实物拍摄，功能正常"></div>
      <div class="row2-wrap-service--fixture"><span title="14天内降价"></span></div>
      <div class="price-wrap--fixture">¥<span>30</span></div>
      <div class="price-desc--fixture"><span title="18人想要"></span></div>
      <div class="seller-text-wrap--fixture" title="河北"></div>
      <div class="credit-container--fixture"><span title="百分百好评"></span></div>
    </a>
    <a class="feeds-item-wrap--fixture" href="https://www.goofish.com/item?id=1072496307738&categoryId=202036301">
      <div class="row1-wrap-title--fixture" title="MGN12 电子档模型，网盘链接发货，售出不退"></div>
      <div class="price-wrap--fixture">¥<span>1</span></div>
      <div class="seller-text-wrap--fixture" title="广东"></div>
    </a>
    <a href="https://www.goofish.com.evil.example/item?id=999999999999">evil</a>
  </body></html>`;
}

const xianyuDetailHtml = `<!doctype html><html><head><title>MGN12直线导轨滑块_闲鱼</title></head><body>
  <div class="item-user-info-nick--fixture">我的朋友</div>
  <div class="item-user-info-label--fixture">保定</div>
  <div class="item-user-info-label--fixture">来闲鱼3年</div>
  <div class="item-user-info-label--fixture">卖出19件宝贝</div>
  <div class="item-main-window--fixture"><img src="https://img.alicdn.com/bao/uploaded/fixture-mgn12.webp"></div>
  <div class="item-main-info--fixture">
    <div class="price--fixture">30</div><div class="post--fixture">包邮</div>
    <div>18人想要 403浏览</div>
    <span class="desc--fixture">MGN12直线导轨滑块，拆机件，实物拍摄，功能正常，售出不退不换。</span>
    <div class="labels--fixture"><div class="value--fixture">轻微使用痕迹</div></div>
  </div>
</body></html>`;

const browser = await chromium.launch({ executablePath: resolveBrowser(), headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } });

const launchSession = async () => {
  const page = await context.newPage();
  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.hostname === 's.taobao.com' && requestUrl.pathname === '/search') {
      const query = requestUrl.searchParams.get('q') ?? '';
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: searchHtml(query) });
      return;
    }
    if (requestUrl.hostname === 'item.taobao.com' || requestUrl.hostname === 'detail.tmall.com') {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: detailHtml });
      return;
    }
    if (requestUrl.hostname === 'www.goofish.com' && requestUrl.pathname === '/search') {
      const query = requestUrl.searchParams.get('q') ?? '';
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: xianyuSearchHtml(query) });
      return;
    }
    if (requestUrl.hostname === 'www.goofish.com' && requestUrl.pathname === '/item') {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: xianyuDetailHtml });
      return;
    }
    await route.abort('blockedbyclient');
  });
  return {
    context,
    page,
    attached: true,
    cleanup: async (options = {}) => {
      if (!options.keepPageOpen) await page.close();
    }
  };
};

const adapter = new TaobaoAgentAdapter(launchSession);
const xianyu = new XianyuAgentAdapter(launchSession);
const checks = [];
try {
  for (const query of ['直线导轨滑块 MGN12', '验证码识别 OCR 模块']) {
    const result = await adapter.search(query);
    assert.equal(result.state, 'search-results');
    assert.equal(result.requiresUserAction, undefined);
    assert.equal(result.candidateCount, 2);
    assert.ok(result.candidates.every((candidate) => isAllowedProductUrl(candidate.href)));
    checks.push({ name: `false-wall guard: ${query}`, status: 'pass' });
  }

  const opened = await adapter.openResult('直线导轨滑块 MGN12', 1, { screenshot: false });
  assert.ok(opened.picked && opened.detail);
  assert.equal(opened.picked.href, 'https://item.taobao.com/item.htm?id=1001');
  assert.equal(opened.detail.state, 'product-detail');
  assert.equal(opened.detail.ssrSource, 'ice-context');
  assert.equal(opened.detail.price, '¥12.80');
  assert.equal(opened.detail.shop, '示例旗舰店');
  checks.push({ name: 'search -> stable candidate -> detail SSR extraction', status: 'pass' });

  const wall = await adapter.openResult('force verification wall', 1, { screenshot: false });
  assert.equal(wall.requiresUserAction, true);
  assert.equal(wall.state, 'verification-wall');
  assert.ok(wall.screenshotPath && fs.existsSync(wall.screenshotPath));
  assert.equal(wall.picked, undefined);
  assert.deepEqual(wall.resume, {
    action: 'open-result',
    query: 'force verification wall',
    index: 1,
    attemptsRemaining: 1
  });
  checks.push({ name: 'verification evidence propagation', status: 'pass' });

  const staged = await adapter.stageVisualInspection('https://item.taobao.com/item.htm?id=1001');
  assert.equal(staged.visualInspection.staged, true);
  assert.equal(staged.visualInspection.tabLeftOpen, true);
  assert.equal(staged.visualInspection.expectedItemId, '1001');
  const stagedTabs = await Promise.all(
    context.pages().map(async (page) => ({ page, name: await page.evaluate(() => window.name).catch(() => '') }))
  );
  assert.equal(stagedTabs.filter(({ name }) => name.startsWith('taobao-codex-visual-v1:')).length, 1);

  const resumed = await adapter.resumeVisualInspection();
  assert.equal(resumed.detail?.state, 'product-detail');
  assert.equal(resumed.visualInspection.expectedHref, 'https://item.taobao.com/item.htm?id=1001');
  const closed = await adapter.closeVisualInspection();
  assert.equal(closed.closedCount, 1);
  checks.push({ name: 'Codex visual tab stage -> resume -> owned close', status: 'pass' });

  await assert.rejects(
    adapter.openByHref('https://item.taobao.com.evil.example/item.htm?id=1'),
    /only accepts/
  );
  checks.push({ name: 'URL trust boundary', status: 'pass' });

  const xianyuSearch = await xianyu.search('MGN12 直线导轨');
  assert.equal(xianyuSearch.state, 'search-results');
  assert.equal(xianyuSearch.candidateCount, 2);
  assert.ok(xianyuSearch.candidates.every((candidate) => isAllowedXianyuItemUrl(candidate.href)));
  assert.deepEqual(xianyuSearch.candidates[1].riskSignals, ['digital-or-nonphysical', 'no-returns']);
  checks.push({ name: 'Ultrasource search extraction + risk signals', status: 'pass' });

  const xianyuDetail = await xianyu.openByHref(xianyuSearch.candidates[0].href);
  assert.equal(xianyuDetail.state, 'item-detail');
  assert.equal(xianyuDetail.itemId, '1068945084433');
  assert.equal(xianyuDetail.price, '¥30');
  assert.equal(xianyuDetail.seller, '我的朋友');
  assert.ok(xianyuDetail.screenshotPath && fs.existsSync(xianyuDetail.screenshotPath));
  checks.push({ name: 'Ultrasource stable href -> detail + screenshot', status: 'pass' });

  const xianyuWall = await xianyu.search('force xianyu verification wall');
  assert.equal(xianyuWall.state, 'verification-wall');
  assert.equal(xianyuWall.requiresUserAction, true);
  assert.ok(xianyuWall.screenshotPath && fs.existsSync(xianyuWall.screenshotPath));
  checks.push({ name: 'Ultrasource verification evidence propagation', status: 'pass' });

  await assert.rejects(
    xianyu.openByHref('https://www.goofish.com.evil.example/item?id=1068945084433'),
    /only accepts/
  );
  checks.push({ name: 'Ultrasource URL trust boundary', status: 'pass' });
} finally {
  await context.close();
  await browser.close();
}

const summary = {
  status: 'pass',
  kind: 'deterministic-browser-e2e',
  networkPolicy: 'all undeclared requests aborted',
  browser: resolveBrowser(),
  checks
};
const summaryPath = path.join(outputDir, 'summary.json');
fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(summary, null, 2));
