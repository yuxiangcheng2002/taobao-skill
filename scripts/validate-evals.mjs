import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(scriptDir, '..');
const evalPath = path.join(skillDir, 'evals', 'evals.json');
const parsed = JSON.parse(fs.readFileSync(evalPath, 'utf8'));
const ultrasourcePath = path.join(skillDir, 'evals', 'ultrasource-evals.json');
const ultrasource = JSON.parse(fs.readFileSync(ultrasourcePath, 'utf8'));
const triggerPath = path.join(skillDir, 'evals', 'ultrasource-trigger-evals.json');
const triggerEvals = JSON.parse(fs.readFileSync(triggerPath, 'utf8'));

assert.equal(parsed.skill_name, 'taobao');
assert.ok(Array.isArray(parsed.evals));
assert.equal(parsed.evals.length, 9, 'expected the standard nine-prompt behavior set');

const ids = parsed.evals.map((entry) => entry.id);
assert.equal(new Set(ids).size, ids.length, 'eval ids must be unique');
for (const entry of parsed.evals) {
  assert.equal(typeof entry.prompt, 'string');
  assert.ok(entry.prompt.trim().length >= 20, `eval ${entry.id}: prompt is too short`);
  assert.equal(typeof entry.expected_output, 'string');
  assert.ok(Array.isArray(entry.expectations) && entry.expectations.length > 0, `eval ${entry.id}: expectations missing`);
  assert.ok(entry.expectations.every((value) => typeof value === 'string' && value.trim()), `eval ${entry.id}: invalid expectation`);
}

const visual = parsed.evals.find((entry) => entry.id === 8);
const resume = parsed.evals.find((entry) => entry.id === 9);
assert.match(JSON.stringify(visual), /visual-open-attached/);
assert.match(JSON.stringify(visual), /visual-close-attached/);
assert.match(JSON.stringify(resume), /visual-resume-attached/);
assert.match(JSON.stringify(resume), /attemptsRemaining=0/);

assert.equal(ultrasource.skill_name, 'taobao/Ultrasource');
assert.ok(Array.isArray(ultrasource.evals));
assert.equal(ultrasource.evals.length, 6, 'expected the six-prompt Ultrasource behavior set');
for (const entry of ultrasource.evals) {
  assert.equal(typeof entry.prompt, 'string');
  assert.ok(entry.prompt.trim().length >= 20, `Ultrasource eval ${entry.id}: prompt is too short`);
  assert.equal(typeof entry.expected_output, 'string');
  assert.ok(
    Array.isArray(entry.expectations) && entry.expectations.length > 0,
    `Ultrasource eval ${entry.id}: expectations missing`
  );
}

assert.ok(Array.isArray(triggerEvals));
assert.equal(triggerEvals.length, 20, 'expected twenty Ultrasource trigger evals');
assert.equal(triggerEvals.filter((entry) => entry.should_trigger).length, 10);
assert.equal(triggerEvals.filter((entry) => !entry.should_trigger).length, 10);
const exactTrigger = /(^|[^A-Za-z0-9_])Ultrasource(?=$|[^A-Za-z0-9_])/;
for (const entry of triggerEvals) {
  assert.equal(typeof entry.query, 'string');
  assert.equal(typeof entry.should_trigger, 'boolean');
  assert.equal(
    exactTrigger.test(entry.query),
    entry.should_trigger,
    `trigger label disagrees with exact-token contract: ${entry.query}`
  );
}

console.log(
  JSON.stringify(
    {
      status: 'pass',
      skill: parsed.skill_name,
      taobaoEvalCount: parsed.evals.length,
      ultrasourceEvalCount: ultrasource.evals.length,
      ultrasourceTriggerEvalCount: triggerEvals.length
    },
    null,
    2
  )
);
