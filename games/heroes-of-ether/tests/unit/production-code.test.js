'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { javascript, css, markup } = require('../../scripts/deployment/production-code.cjs');
test('production JS preserves literals, regex, token separation, ASI and Unicode', () => {
  const source = '/* header */\nconst url="https://game.test/a//b"; const text=`/* kept */\\n${2/* note */+3}`;\nconst re=/a\\/\\/b/;\nfunction f(){return/* line\n note */42}\nresult={url,text,match:re.test("a//b"),answer:f(),value:1/*a*/+/*b*/2,emoji:"👋"}; // end';
  const { output, comments } = javascript(source), before = {}, after = {};
  vm.runInNewContext(source, before); vm.runInNewContext(output, after);
  assert.equal(JSON.stringify(after.result), JSON.stringify(before.result)); assert.equal(comments, 6);
  assert.ok(output.includes('/* kept */')); assert.equal(javascript(output).comments, 0);
});
test('production JS retains module semantics and interpreter directive', () => {
  assert.equal(javascript('export const n=1;//note').comments, 1);
  const result = javascript('#!/usr/bin/env node\n/* note */\nconsole.log("ok")');
  assert.ok(result.output.startsWith('#!/usr/bin/env node')); assert.equal(result.comments, 1);
});
test('production CSS retains URLs, strings and custom property values', () => {
  const source = '/* comment */\n.a{--x:"/* literal */";background:url("https://x/a//b"); color:red /* c */;}';
  const result = css(source); assert.equal(result.comments, 2); assert.ok(result.output.includes('/* literal */'));
  assert.equal(css(result.output).comments, 0);
});
test('production markup strips nested template comments and inline code comments', () => {
  const source = '<!doctype html><title>A</title><!-- note --><template><div>a<!--note-->b</div></template><style>/*a*/.x{color:red}</style><script>const url="https://x";/*note*/</script><svg><!--x--><path d="M0 0"/></svg>';
  const result = markup(source); assert.equal(result.comments, 5); assert.ok(!result.output.includes('<!--'));
  assert.ok(result.output.includes('https://x')); assert.equal(markup(result.output).comments, 0);
});
