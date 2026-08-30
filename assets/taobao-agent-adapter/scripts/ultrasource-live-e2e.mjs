import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

if (process.env.ULTRASOURCE_TRIGGER !== 'Ultrasource') {
  throw new Error('ULTRASOURCE_TRIGGER_REQUIRED');
}

const outputDir = path.resolve(process.argv[2] ?? 'test-results/ultrasource-live');
fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
fs.chmodSync(outputDir, 0o700);

const { XianyuAgentAdapter } = await import('../dist/src/xianyu/adapter.js');
const { isAllowedXianyuItemUrl } = await import('../dist/src/xianyu/parser.js');
const adapter = new XianyuAgentAdapter();
const startedAt = new Date().toISOString();
const queries = ['直线导轨滑块 MGN12', '验证码识别 OCR 模块', 'KEYENCE LK-G5001 控制器'];
const results = [];
let finalStatus = 'pass';
let detailCaptured = false;
let searchIndex = 0;

function writeJson(name, value) {
  fs.writeFileSync(path.join(outputDir, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

try {
  for (const query of queries) {
    const search = await adapter.search(query);
    searchIndex += 1;
    writeJson(`search-${searchIndex}.json`, search);
    if (search.requiresUserAction) {
      finalStatus = 'blocked';
      results.push({ query, status: 'blocked', state: search.state, screenshotPath: search.screenshotPath });
      break;
    }

    assert.equal(search.state, 'search-results', `${query}: expected search-results`);
    assert.ok(search.candidateCount >= 5, `${query}: expected at least 5 public candidates`);
    assert.ok(search.candidates.every((candidate) => isAllowedXianyuItemUrl(candidate.href)), `${query}: invalid href`);
    assert.equal(new Set(search.candidates.map((candidate) => candidate.itemId)).size, search.candidates.length, `${query}: duplicate item id`);
    assert.deepEqual(search.candidates.map((candidate) => candidate.index), search.candidates.map((_, index) => index + 1));
    results.push({ query, status: 'pass', candidateCount: search.candidateCount });

    if (!detailCaptured && query.includes('MGN12')) {
      const picked = search.candidates.find((candidate) =>
        /MGN\s*12/i.test(candidate.title) && !candidate.riskSignals.includes('digital-or-nonphysical')
      ) ?? search.candidates[0];
      const detail = await adapter.openByHref(picked.href);
      writeJson('detail.json', detail);
      if (detail.requiresUserAction) {
        finalStatus = 'blocked';
        results.push({ query: 'open-href', status: 'blocked', state: detail.state, screenshotPath: detail.screenshotPath });
        break;
      }

      assert.equal(detail.state, 'item-detail');
      assert.equal(detail.itemId, picked.itemId, 'open-href drifted from selected item id');
      const populated = [detail.description, detail.price, detail.seller].filter(Boolean).length;
      assert.ok(populated >= 2, `detail extraction populated only ${populated}/3 identity fields`);
      assert.ok(detail.screenshotPath, 'detail screenshot missing');
      const header = fs.readFileSync(detail.screenshotPath).subarray(0, 8).toString('hex');
      assert.equal(header, '89504e470d0a1a0a', 'detail screenshot is not a PNG');
      detailCaptured = true;
      results.push({
        query: 'open-href',
        status: 'pass',
        itemId: detail.itemId,
        screenshotPath: detail.screenshotPath
      });
    }
  }
  if (finalStatus === 'pass') {
    assert.equal(detailCaptured, true, 'no Xianyu detail page was inspected');
  }
} catch (error) {
  finalStatus = 'fail';
  results.push({ status: 'fail', error: error instanceof Error ? error.message : String(error) });
}

const summary = {
  status: finalStatus,
  startedAt,
  finishedAt: new Date().toISOString(),
  environment: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    hostname: os.hostname(),
    cdpUrl: process.env.TAOBAO_CDP_URL
  },
  policy: 'read-only; sequential attached actions; no chat, want, favorite, offer, publish, checkout, or purchase',
  results
};
writeJson('summary.json', summary);
console.log(JSON.stringify(summary, null, 2));
if (finalStatus === 'fail') process.exitCode = 1;
else if (finalStatus === 'blocked') process.exitCode = 2;
