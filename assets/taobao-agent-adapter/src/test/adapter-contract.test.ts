import test from 'node:test';
import assert from 'node:assert/strict';
import { TaobaoAgentAdapter } from '../taobao/adapter.js';
import type { SearchResult } from '../taobao/types.js';

test('openResult propagates a search verification wall without losing evidence', async () => {
  const adapter = new TaobaoAgentAdapter();
  const wall: SearchResult = {
    query: '直线导轨滑块 MGN12',
    state: 'verification-wall',
    url: 'https://punish.taobao.com/punish',
    title: '安全验证',
    loggedInLikely: true,
    candidateCount: 0,
    candidates: [],
    networkTap: [{ url: 'https://punish.taobao.com/punish', status: 200, contentType: 'text/html', bodyPreview: '' }],
    screenshotPath: '/evidence/verification.png',
    requiresUserAction: true
  };
  adapter.search = async () => wall;

  const result = await adapter.openResult(wall.query, 1);
  assert.equal(result.requiresUserAction, true);
  assert.equal(result.state, 'verification-wall');
  assert.equal(result.screenshotPath, '/evidence/verification.png');
  assert.equal(result.networkTap.length, 1);
  assert.deepEqual(result.resume, {
    action: 'open-result',
    query: wall.query,
    index: 1,
    attemptsRemaining: 1
  });
  assert.equal(result.picked, undefined);
  assert.equal(result.detail, undefined);
});

test('openByHref rejects non-product hosts before browser launch', async () => {
  const adapter = new TaobaoAgentAdapter();
  await assert.rejects(
    adapter.openByHref('https://item.taobao.com.evil.example/item.htm?id=1'),
    /only accepts https:\/\/item\.taobao\.com/
  );
});
