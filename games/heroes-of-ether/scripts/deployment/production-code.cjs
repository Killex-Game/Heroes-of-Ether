'use strict';
const assert = require('node:assert/strict');
const acorn = require('acorn');
const csstree = require('css-tree');
const parse5 = require('parse5');

// Spaces preserve token boundaries, line endings and automatic semicolons.
function erase(source, ranges) {
  let output = source;
  for (const [start, end] of ranges.toSorted((a, b) => b[0] - a[0]))
    output = output.slice(0, start) + output.slice(start, end).replace(/[^\r\n]/g, ' ') + output.slice(end);
  return output;
}
function javascript(source) {
  let tree, comments, options;
  for (const sourceType of ['script', 'module']) {
    comments = [];
    options = { ecmaVersion: 'latest', sourceType, allowHashBang: true, onComment: comments };
    try { tree = acorn.parse(source, options); break; } catch (error) { if (sourceType === 'module') throw error; }
  }
  // A hashbang is an interpreter directive, not a removable source comment.
  const removable = comments.filter(c => !(c.start === 0 && source.startsWith('#!')));
  const output = erase(source, removable.map(c => [c.start, c.end]));
  const remaining = [];
  assert.deepEqual(acorn.parse(output, { ...options, onComment: remaining }), tree);
  assert.equal(remaining.filter(c => !(c.start === 0 && output.startsWith('#!'))).length, 0);
  return { output, comments: removable.length };
}
function css(source) {
  let count = 0;
  const options = { parseCustomProperty: true, onComment: () => count++ };
  const tree = csstree.parse(source, options), comments = count;
  if (!comments) return { output: source, comments: 0 };
  const output = csstree.generate(tree);
  count = 0;
  assert.deepEqual(csstree.toPlainObject(csstree.parse(output, options)), csstree.toPlainObject(tree));
  assert.equal(count, 0);
  return { output, comments };
}
function markup(source) {
  const tree = parse5.parse(source, { sourceCodeLocationInfo: true }), edits = [];
  let count = 0;
  function walk(node) {
    const loc = node.sourceCodeLocation;
    if (node.nodeName === '#comment' && loc) {
      edits.push([loc.startOffset, loc.endOffset, '']); count++; return;
    }
    if (loc?.startTag && loc?.endTag && ['script', 'style'].includes(node.tagName)) {
      const start = loc.startTag.endOffset, end = loc.endTag.startOffset;
      const type = node.attrs?.find(a => a.name === 'type')?.value || '';
      if (node.tagName === 'style' || !type || /^(?:module|(?:text|application)\/(?:java|ecma)script)$/.test(type)) {
        const result = node.tagName === 'style' ? css(source.slice(start, end)) : javascript(source.slice(start, end));
        edits.push([start, end, result.output]); count += result.comments;
      }
    }
    for (const child of node.childNodes || []) walk(child);
    if (node.content) walk(node.content);
  }
  walk(tree);
  let output = source;
  for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0]))
    output = output.slice(0, start) + replacement + output.slice(end);
  // Deleting a comment must not turn text into a new element or change attrs.
  const structure = node => ({ name: node.nodeName, tag: node.tagName, attrs: node.attrs,
    value: node.nodeName === '#text' && !['script', 'style'].includes(node.parentNode?.tagName) ? node.value : undefined,
    children: node.childNodes?.filter(n => n.nodeName !== '#comment').map(structure),
    content: node.content ? structure(node.content) : undefined });
  // Adjacent text nodes can merge after deletion, so compare serialized trees.
  function stripTree(node) {
    if (node.childNodes) node.childNodes = node.childNodes.filter(n => n.nodeName !== '#comment');
    for (const child of node.childNodes || []) stripTree(child);
    if (node.content) stripTree(node.content);
    if (['script', 'style'].includes(node.tagName)) node.childNodes = [];
  }
  const next = parse5.parse(output); stripTree(tree); stripTree(next);
  assert.deepEqual(structure(parse5.parse(parse5.serialize(tree))), structure(parse5.parse(parse5.serialize(next))));
  return { output, comments: count };
}
function transform(source, extension) {
  if (['.js', '.cjs', '.mjs'].includes(extension)) return javascript(source);
  if (extension === '.css') return css(source);
  if (['.html', '.svg'].includes(extension)) return markup(source);
  return { output: source, comments: 0 };
}
module.exports = { transform, javascript, css, markup };
