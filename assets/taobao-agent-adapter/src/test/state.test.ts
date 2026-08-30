import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  collectInterestingImageUrls,
  detectClone,
  detectPlatform,
  detectPreviouslyBought,
  extractMOQ,
  extractPriceTiers,
  extractShopAgeYears,
  extractShopFromHeadText,
  extractTags,
  filterProductCandidates,
  isAllowedProductUrl,
  isDetailHost,
  parseIceContextDetail,
  pickProductImages,
  summarizeCandidate
} from '../taobao/parser.js';
import { inferPageState } from '../taobao/state.js';

test('detects search results pages', () => {
  assert.equal(
    inferPageState('https://s.taobao.com/search?q=esp32', '淘宝搜索', '搜索结果 ESP32'),
    'search-results'
  );
});

test('detects product detail pages', () => {
  assert.equal(
    inferPageState('https://item.taobao.com/item.htm?id=123', '商品详情', '立即购买'),
    'product-detail'
  );
});

test('detects login walls', () => {
  assert.equal(
    inferPageState('https://login.taobao.com/', 'Login', '亲，请登录'),
    'login-wall'
  );
});

test('does not treat the anonymous header login link as a login wall', () => {
  assert.equal(
    inferPageState(
      'https://item.taobao.com/item.htm?id=123',
      'MGN12 商品详情',
      '亲，请登录 免费注册 示例旗舰店 MGN12 立即购买 用户评价'
    ),
    'product-detail'
  );
});

test('detects verification walls', () => {
  assert.equal(
    inferPageState('https://www.taobao.com/', '淘宝', '请输入验证码 安全验证 滑块'),
    'verification-wall'
  );
});

test('does not confuse product vocabulary with verification walls', () => {
  assert.equal(
    inferPageState('https://s.taobao.com/search?q=MGN12', '直线导轨滑块 MGN12 - 淘宝', '直线导轨滑块 MGN12 搜索结果'),
    'search-results'
  );
  assert.equal(
    inferPageState('https://s.taobao.com/search?q=ocr', '验证码识别 OCR 模块 - 淘宝', '验证码识别 OCR 模块 verify compatible sensor'),
    'search-results'
  );
  assert.equal(
    inferPageState('https://item.taobao.com/item.htm?id=1', '安全验证芯片', '安全验证芯片 原装 商品详情'),
    'product-detail'
  );
});

test('detects verification overlays even on search and detail URLs', () => {
  assert.equal(
    inferPageState('https://s.taobao.com/search?q=esp32', '淘宝搜索', '请拖动滑块完成安全验证'),
    'verification-wall'
  );
  assert.equal(
    inferPageState('https://item.taobao.com/item.htm?id=1', '商品详情', '请输入验证码，验证码看不清可刷新'),
    'verification-wall'
  );
  assert.equal(
    inferPageState('https://punish.taobao.com/punish', '淘宝', ''),
    'verification-wall'
  );
});

test('filters candidate product links', () => {
  const out = filterProductCandidates([
    {
      text: 'ESP32 Dev Board',
      href: 'https://item.taobao.com/item.htm?id=1',
      thumbnailUrl: '//img.alicdn.com/item.jpg'
    },
    {
      text: 'ESP32 Dev Board',
      href: 'https://item.taobao.com/item.htm?id=1',
      imageUrls: ['https://img.alicdn.com/item-alt.jpg']
    },
    { text: 'Store', href: 'https://shop.taobao.com/' },
    { text: 'Evil suffix', href: 'https://item.taobao.com.evil.example/item.htm?id=9' },
    { text: 'Userinfo trick', href: 'https://item.taobao.com@evil.example/item.htm?id=10' },
    { text: '', href: 'https://item.taobao.com/item.htm?id=2' },
    { text: 'Tmall Item', href: 'https://detail.tmall.com/item.htm?id=3' }
  ]);

  assert.deepEqual(out, [
    {
      text: 'ESP32 Dev Board',
      href: 'https://item.taobao.com/item.htm?id=1',
      thumbnailUrl: 'https://img.alicdn.com/item.jpg',
      imageUrls: ['https://img.alicdn.com/item.jpg', 'https://img.alicdn.com/item-alt.jpg']
    },
    { text: 'Tmall Item', href: 'https://detail.tmall.com/item.htm?id=3' }
  ]);
});

test('product URL boundary requires https, exact host, and default port', () => {
  const valid = [
    'https://item.taobao.com/item.htm?id=1',
    'https://detail.tmall.com/item.htm?id=2#sku'
  ];
  const invalid = [
    'http://item.taobao.com/item.htm?id=1',
    'https://item.taobao.com.evil.example/item.htm?id=1',
    'https://item.taobao.com@evil.example/item.htm?id=1',
    'https://sub.item.taobao.com/item.htm?id=1',
    'https://item.taobao.com.:443/item.htm?id=1',
    'https://item.taobao.com:8443/item.htm?id=1',
    'javascript:https://item.taobao.com/item.htm?id=1',
    'https://evil.example/?next=https://item.taobao.com/item.htm?id=1'
  ];
  for (const href of valid) assert.equal(isAllowedProductUrl(href), true, href);
  for (const href of invalid) assert.equal(isAllowedProductUrl(href), false, href);
});

test('keeps only interesting taobao-family image urls', () => {
  assert.deepEqual(
    collectInterestingImageUrls([
      '//img.alicdn.com/item.jpg',
      'data:image/png;base64,abc',
      'https://example.com/not-taobao.jpg',
      'https://img.alicdn.com/item.jpg?x=1'
    ]),
    ['https://img.alicdn.com/item.jpg', 'https://img.alicdn.com/item.jpg?x=1']
  );
});

test('summarizeCandidate exposes thumbnailUrl', () => {
  const summary = summarizeCandidate(
    {
      text: 'ESP32 board ¥12.90 200人付款 深圳 官方店',
      href: 'https://item.taobao.com/item.htm?id=1',
      thumbnailUrl: 'https://img.alicdn.com/item.jpg'
    },
    1
  );

  assert.equal(summary.thumbnailUrl, 'https://img.alicdn.com/item.jpg');
  assert.equal(summary.price, '¥12.90');
});

test('detectPlatform splits taobao / tmall / tmall-flagship', () => {
  assert.equal(detectPlatform('https://item.taobao.com/item.htm?id=1'), 'taobao');
  assert.equal(detectPlatform('https://detail.tmall.com/item.htm?id=2'), 'tmall');
  assert.equal(
    detectPlatform('https://detail.tmall.com/item.htm?id=3', '示例旗舰店'),
    'tmall-flagship'
  );
});

test('extractTags pulls promo and guarantee labels from rawText', () => {
  const tags = extractTags('原装 ¥13 包邮 退货宝 假一赔四 可开发票 6年老店 示例旗舰店');
  assert.deepEqual(tags, ['包邮', '可开发票', '假一赔四', '退货宝']);
});

test('detectPreviouslyBought catches 买过的店 marker', () => {
  assert.equal(detectPreviouslyBought('深圳 买过的店 示例电子'), true);
  assert.equal(detectPreviouslyBought('深圳 示例旗舰店'), false);
});

test('extractShopAgeYears reads X 年老店 patterns', () => {
  assert.equal(extractShopAgeYears('广东 深圳 13年老店 示例电子'), 13);
  assert.equal(extractShopAgeYears('广东 6年老店 示例旗舰店'), 6);
  assert.equal(extractShopAgeYears('深圳 示例旗舰店'), undefined);
});

test('summarizeCandidate skips 券后价 and finds the real province', () => {
  // Regression: the old "first Chinese-only token" heuristic let the price-modifier
  // 券后价 slip into `location` for promotion-priced listings.
  const summary = summarizeCandidate(
    {
      text: '原装正品 ICM-42688-P ¥31.22 券后价 700+人付款 广东 深圳 48小时内发 7年老店 示例电子',
      href: 'https://item.taobao.com/item.htm?id=712725522737'
    },
    2
  );

  assert.equal(summary.location, '广东');
  assert.equal(summary.shop, '示例电子');
  assert.equal(summary.shopAgeYears, 7);
  assert.deepEqual(summary.tags, ['48小时内发', '券后价']);
  assert.equal(summary.platform, 'taobao');
});

test('summarizeCandidate marks Tmall flagship and previouslyBought', () => {
  const summary = summarizeCandidate(
    {
      text: '原装 LSM6DSVTR ¥13.3 20人付款 广东 深圳 退货宝 包邮 6年老店 示例旗舰店',
      href: 'https://detail.tmall.com/item.htm?id=783527118897'
    },
    1
  );

  assert.equal(summary.platform, 'tmall-flagship');
  assert.equal(summary.shop, '示例旗舰店');
  assert.equal(summary.shopAgeYears, 6);
  assert.equal(summary.location, '广东');
  assert.deepEqual(summary.tags, ['包邮', '退货宝']);
  assert.equal(summary.previouslyBought, undefined);
});

test('detectClone flags vendor-suffix clones (e.g. -HXY)', () => {
  const hxy = detectClone('华轩阳 ICM-42688P-HXY 封装LGA-14 姿态传感器');
  assert.equal(hxy.suspect, true);
  assert.match(hxy.reason ?? '', /HXY/i);

  const original = detectClone('原装ICM-42688-P LGA-14 6轴MEMS运动传感器');
  assert.equal(original.suspect, false);
});

test('detectClone flags marketing keywords for replacements', () => {
  assert.equal(detectClone('STM32F103 国产替代 GD32F103').suspect, true);
  assert.equal(detectClone('LM358 平替 全新原装').suspect, true);
  assert.equal(detectClone('BMI270 替代品 兼容寄存器').suspect, true);
  // "兼容" alone is too broad — legitimate parts often advertise compatibility.
  assert.equal(detectClone('LSM6DSV 模块 支持SPI/IIC 兼容Smol/SlimeVR').suspect, false);
});

test('summarizeCandidate exposes suspectClone for HXY listings', () => {
  const summary = summarizeCandidate(
    {
      text: '华轩阳 ICM-42688P-HXY 封装LGA-14 ¥7.95 14人付款 广东 深圳',
      href: 'https://item.taobao.com/item.htm?id=1010768206723'
    },
    1
  );

  assert.equal(summary.suspectClone, true);
  assert.match(summary.suspectReason ?? '', /HXY/i);
});

test('pickProductImages drops UI chrome and prefers item_pic urls', () => {
  const urls = [
    'https://img.alicdn.com/imgextra/i2/O1CN01a69z6z1hJklCkBqOU_!!6000000004257-2-tps-174-106.png',
    'https://gtms04.alicdn.com/tps/i4/TB1wA25HpXXXXcwXVXXCBGNFFXX-24-24.png',
    'https://img.alicdn.com/imgextra/i2/2206784173097/O1CN01l6drF61YkTS8g4bGs_!!2206784173097-0-shopmanager.jpg',
    'https://img.alicdn.com/imgextra/i2/2206784173097/main_!!4611686018427384873-0-item_pic.jpg',
    'https://img.alicdn.com/imgextra/i1/2206784173097/alt_!!0-item_pic.jpg',
    'https://img.alicdn.com/imgextra/i3/2206784173097/third_!!2-item_pic.png',
    'https://img.alicdn.com/imgextra/i2/2206784173097/extra_!!2206784173097.jpg'
  ];

  const picked = pickProductImages(urls, 3);
  assert.equal(picked.length, 3);
  // All three picks should be item_pic — not the small TPS, shopmanager, or 24x24 icon.
  for (const url of picked) {
    assert.match(url, /item_pic/);
  }
});

test('extractPriceTiers parses staircase patterns from rendered text', () => {
  const tiers = extractPriceTiers('1件 ¥48.20 10件以上 ¥45.00 100件以上 ¥40.00');
  assert.deepEqual(tiers, [
    { qty: '1件', price: '¥48.20' },
    { qty: '10件', price: '¥45.00' },
    { qty: '100件', price: '¥40.00' }
  ]);
});

test('extractMOQ parses 起订量 patterns', () => {
  assert.equal(extractMOQ('起订量: 100 件'), '100件');
  assert.equal(extractMOQ('起订数：50 颗'), '50颗');
  assert.equal(extractMOQ('随便买'), undefined);
});

test('extractShopFromHeadText pulls shop name from rendered detail-page head', () => {
  // Mirrors the structure of detail-page rawText where the shop sits near the
  // top with a numeric rating and review-count summary.
  const head = '搜索 搜本店 示例旗舰店 4.7 90天新增21条好评 平均17小时发货 平均2天退款 客服 进店';
  assert.equal(extractShopFromHeadText(head), '示例旗舰店');
});

test('extractShopFromHeadText skips UI-chrome blacklist tokens', () => {
  // 收藏的店铺 should never be returned even if it appears earlier than a real
  // shop name — that's what burned us before.
  const head = '搜索 收藏的店铺 我的店铺 进店 示例旗舰店 4.7';
  assert.equal(extractShopFromHeadText(head), '示例旗舰店');
});

test('isDetailHost recognizes Taobao detail-page URLs', () => {
  assert.equal(isDetailHost('https://detail.tmall.com/item.htm?id=1'), true);
  assert.equal(isDetailHost('https://item.taobao.com/item.htm?id=1'), true);
  assert.equal(isDetailHost('https://s.taobao.com/search?q=esp32'), false);
  assert.equal(isDetailHost('https://www.taobao.com/'), false);
  assert.equal(isDetailHost('not a url'), false);
});

test('parseIceContextDetail extracts every documented field from a snapshot fixture', () => {
  // The fixture mirrors the cherrypicked subtree readIceContextRaw extracts
  // from window.__ICE_APP_CONTEXT__.loaderData.home.data.res. When this test
  // breaks, regenerate the fixture from a real Taobao detail page — the
  // failure is the canary that Taobao bumped the SSR layout.
  const fixturePath = join(process.cwd(), 'src', 'test', 'fixtures', 'ice-context-detail.json');
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const result = parseIceContextDetail(fixture);

  assert.ok(result, 'parser returned undefined for a known-good fixture');
  assert.equal(result!.price, '13.3');
  assert.equal(result!.priceTitle, '优惠促销');
  assert.equal(result!.priceMoney, 1330);
  assert.equal(result!.shop, '示例旗舰店');
  assert.equal(result!.shopId, '100000001');
  assert.equal(result!.sellerId, '200000002');
  assert.equal(result!.vagueSellCount, '1000+');
  assert.equal(result!.quantity, 200);
  assert.equal(result!.quantityText, '有货');
  assert.equal(result!.itemImages?.length, 3);
  assert.match(result!.itemImages![0], /item_pic/);

  assert.equal(result!.sellerEvaluates?.length, 3);
  assert.deepEqual(
    result!.sellerEvaluates?.map((e) => ({ type: e.type, score: e.score, levelText: e.levelText })),
    [
      { type: 'desc', score: '4.8', levelText: '高' },
      { type: 'serv', score: '4.8', levelText: '高' },
      { type: 'post', score: '4.9', levelText: '高' }
    ]
  );
});

test('parseIceContextDetail returns undefined when the SSR shape is missing or empty', () => {
  assert.equal(parseIceContextDetail(undefined), undefined);
  assert.equal(parseIceContextDetail(null), undefined);
  assert.equal(parseIceContextDetail({}), undefined);
  // A shape that doesn't carry any of our fields should also be rejected so
  // the adapter falls back to DOM extraction and emits the drift warning.
  assert.equal(parseIceContextDetail({ unrelated: { stuff: 1 } }), undefined);
});

test('parseIceContextDetail tolerates partial SSR payloads', () => {
  // Tmall sometimes ships listings without sellerEvaluates or sku2info.
  // The parser should still surface what's present.
  const partial = {
    componentsVO: { priceVO: { price: { priceText: '99', priceMoney: '9900' } } },
    seller: { shopName: '示例小店' }
  };
  const result = parseIceContextDetail(partial);
  assert.ok(result);
  assert.equal(result!.price, '99');
  assert.equal(result!.priceMoney, 9900);
  assert.equal(result!.shop, '示例小店');
  assert.equal(result!.sellerEvaluates, undefined);
  assert.equal(result!.quantity, undefined);
});
