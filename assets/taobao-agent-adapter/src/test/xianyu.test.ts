import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectXianyuRiskSignals,
  hasStandaloneUltrasource,
  inferXianyuPageState,
  parseAllowedXianyuItemUrl
} from '../xianyu/parser.js';

test('Ultrasource trigger is standalone and case-sensitive', () => {
  for (const positive of [
    'Ultrasource',
    'Ultrasource find MGN12 on 闲鱼',
    '请用 Ultrasource，找拆机件',
    '[Ultrasource] inspect this listing'
  ]) {
    assert.equal(hasStandaloneUltrasource(positive), true, positive);
  }
  for (const negative of [
    'ultrasource',
    'ULTRASOURCE',
    'UltraSource',
    'UltrasourceX',
    'preUltrasource',
    '找一下闲鱼的 MGN12'
  ]) {
    assert.equal(hasStandaloneUltrasource(negative), false, negative);
  }
});

test('Xianyu item URL boundary accepts only canonical public listing URLs', () => {
  const good = parseAllowedXianyuItemUrl(
    'https://www.goofish.com/item?spm=a21ybx&id=1068945084433&categoryId=126858011#photo'
  );
  assert.equal(
    good?.toString(),
    'https://www.goofish.com/item?id=1068945084433&categoryId=126858011'
  );

  for (const bad of [
    'http://www.goofish.com/item?id=1068945084433',
    'https://goofish.com/item?id=1068945084433',
    'https://www.goofish.com.evil.example/item?id=1068945084433',
    'https://www.goofish.com@evil.example/item?id=1068945084433',
    'https://foo.www.goofish.com/item?id=1068945084433',
    'https://www.goofish.com./item?id=1068945084433',
    'https://www.goofish.com/search?q=https://www.goofish.com/item?id=1068945084433',
    'javascript:https://www.goofish.com/item?id=1068945084433',
    'https://www.goofish.com/item?id=not-a-number'
  ]) {
    assert.equal(parseAllowedXianyuItemUrl(bad), null, bad);
  }
});

test('ordinary product vocabulary does not become a Xianyu verification wall', () => {
  for (const term of ['直线导轨滑块 MGN12', '验证码识别 OCR 模块', '安全验证芯片', 'verify compatible sensor']) {
    assert.equal(
      inferXianyuPageState({
        url: `https://www.goofish.com/search?q=${encodeURIComponent(term)}`,
        title: `${term}_闲鱼`,
        bodyText: `${term} ¥30 广东 卖家信用极好`,
        candidateCount: 5
      }),
      'search-results',
      term
    );
  }
});

test('structured Xianyu walls outrank search/detail URL classification', () => {
  assert.equal(
    inferXianyuPageState({
      url: 'https://www.goofish.com/search?q=MGN12',
      title: '安全验证',
      bodyText: '请拖动滑块完成安全验证',
      candidateCount: 20
    }),
    'verification-wall'
  );
  assert.equal(
    inferXianyuPageState({
      url: 'https://www.goofish.com/item?id=1068945084433',
      title: '非法访问',
      bodyText: '为了保障您的体验，请使用正常浏览器访问闲鱼~',
      hasItemDetail: true
    }),
    'verification-wall'
  );
});

test('risk signals identify listing hazards without blocking ordinary used parts', () => {
  assert.deepEqual(
    detectXianyuRiskSignals('百度网盘链接发货，虚拟商品，售出不退不换，请微信转账'),
    ['digital-or-nonphysical', 'no-returns', 'off-platform-payment']
  );
  assert.deepEqual(
    detectXianyuRiskSignals('MGN12 拆机导轨，实物拍摄，功能正常'),
    []
  );
});
