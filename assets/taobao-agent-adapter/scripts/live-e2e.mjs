import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const outputDir = path.resolve(process.argv[2] ?? 'test-results/live');
fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
fs.chmodSync(outputDir, 0o700);

const { TaobaoAgentAdapter } = await import('../dist/src/taobao/adapter.js');
const { isAllowedProductUrl } = await import('../dist/src/taobao/parser.js');
const adapter = new TaobaoAgentAdapter();
const startedAt = new Date().toISOString();
const queries = ['直线导轨滑块 MGN12', '验证码识别 OCR 模块', 'ICM-42688-P 原装'];
const results = [];
let finalStatus = 'pass';
let detailResult;

function sanitizedSearch(result) {
  return { ...result, networkTap: undefined };
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(outputDir, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

try {
  const probe = await adapter.probeSession();
  writeJson('probe.json', probe);

  for (const query of queries) {
    const result = await adapter.search(query);
    writeJson(`search-${results.length + 1}.json`, sanitizedSearch(result));
    if (result.requiresUserAction) {
      finalStatus = 'blocked';
      results.push({ query, status: 'blocked', state: result.state, screenshotPath: result.screenshotPath });
      break;
    }

    assert.equal(result.state, 'search-results', `${query}: expected search-results`);
    assert.ok(result.candidateCount >= 5, `${query}: expected at least 5 candidates`);
    assert.ok(result.candidates.every((candidate) => isAllowedProductUrl(candidate.href)), `${query}: invalid candidate URL`);
    assert.equal(new Set(result.candidates.map((candidate) => candidate.href)).size, result.candidates.length, `${query}: duplicate href`);
    assert.deepEqual(result.candidates.map((candidate) => candidate.index), result.candidates.map((_, index) => index + 1));

    if (query.includes('ICM-42688')) {
      const modelMatches = result.candidates.slice(0, 5).filter((candidate) => /ICM[-\s]?42688/i.test(candidate.title)).length;
      assert.ok(modelMatches >= 3, `ICM query quality: only ${modelMatches}/5 top titles retained the model`);
    }
    results.push({ query, status: 'pass', candidateCount: result.candidateCount });

    if (!detailResult) {
      const picked = result.candidates[0];
      detailResult = await adapter.openByHref(picked.href);
      writeJson('detail.json', { ...detailResult, networkTap: undefined });
      if (detailResult.requiresUserAction) {
        finalStatus = 'blocked';
        results.push({ query: 'open-href', status: 'blocked', state: detailResult.state, screenshotPath: detailResult.screenshotPath });
        break;
      }
      assert.ok(detailResult.picked && detailResult.detail, 'detail result missing picked/detail');
      assert.equal(detailResult.picked.href, picked.href, 'open-href drifted from selected candidate');
      assert.equal(detailResult.detail.state, 'product-detail');
      const populated = [detailResult.detail.name, detailResult.detail.shop, detailResult.detail.price].filter(Boolean).length;
      assert.ok(populated >= 2, `detail extraction only populated ${populated}/3 identity fields`);
      if (detailResult.detail.warnings?.some((warning) => warning.includes('ICE_CONTEXT_PATH_DRIFT_SUSPECTED'))) {
        finalStatus = 'drift';
      }
      assert.ok(detailResult.detail.screenshotPath, 'detail screenshot was not captured');
      const header = fs.readFileSync(detailResult.detail.screenshotPath).subarray(0, 8).toString('hex');
      assert.equal(header, '89504e470d0a1a0a', 'detail screenshot is not a PNG');
      results.push({
        query: 'open-href',
        status: finalStatus === 'drift' ? 'drift' : 'pass',
        ssrSource: detailResult.detail.ssrSource,
        screenshotPath: detailResult.detail.screenshotPath
      });
    }
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
  policy: 'read-only; sequential attached actions; no cart, messages, checkout, or purchase',
  results
};
writeJson('summary.json', summary);
console.log(JSON.stringify(summary, null, 2));
if (finalStatus === 'fail') process.exitCode = 1;
else if (finalStatus === 'blocked') process.exitCode = 2;
else if (finalStatus === 'drift') process.exitCode = 3;
