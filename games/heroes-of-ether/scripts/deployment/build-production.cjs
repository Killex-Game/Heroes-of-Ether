'use strict';
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const { createHash } = require('node:crypto');
const { transform } = require('./production-code.cjs');
const root = path.resolve(__dirname, '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function build(destination) {
  const target = path.resolve(destination);
  if (target === root || root.startsWith(target + path.sep) || fs.existsSync(target))
    throw Error('Production destination must be a NEW separate directory');
  const tracked = cp.execFileSync('git', ['ls-files', '-z', '--', 'public', 'src', 'config', 'server.js', 'admin-control.js', 'package.json', 'package-lock.json'], { cwd: root }).toString().split('\0').filter(Boolean);
  // New runtime files are included only from the explicit source trees.
  function enumerate(directory) {
    return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(e => {
      const relative = `${directory}/${e.name}`;
      if (e.isSymbolicLink()) throw Error(`Unexpected source symlink: ${relative}`);
      return e.isDirectory() ? enumerate(relative) : [relative];
    });
  }
  const operations = enumerate('scripts/deployment').filter(file => /\.cjs$/.test(file) &&
    !/\/(?:build-production|production-code|finalize-production)\.cjs$/.test(file));
  const files = [...new Set([...tracked, ...enumerate('src'), ...operations])].sort();
  const manifest = { version: 1, sourceCommit: cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim(), files: [], commentsRemoved: 0, dependencies: 'npm ci --omit=dev; retain license notices', config: 'Runtime configuration and data are supplied separately' };
  fs.mkdirSync(target, { recursive: true });
  for (const relative of files) {
    if (/\.map$/.test(relative)) continue;
    const source = path.join(root, relative), before = fs.readFileSync(source), extension = path.extname(relative);
    const converted = /\.(?:js|cjs|mjs|css|html|svg)$/.test(relative) ? transform(before.toString('utf8'), extension) : { output: before, comments: 0 };
    const after = Buffer.isBuffer(converted.output) ? converted.output : Buffer.from(converted.output);
    const output = path.join(target, relative); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, after);
    manifest.files.push({ file: relative, sourceSha256: hash(before), sha256: hash(after), bytes: after.length, commentsRemoved: converted.comments });
    manifest.commentsRemoved += converted.comments;
  }
  fs.writeFileSync(path.join(target, 'production-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
if (require.main === module) {
  if (!process.argv[2]) throw Error('Usage: node scripts/deployment/build-production.cjs NEW_DIRECTORY');
  const manifest = build(process.argv[2]);
  console.log(JSON.stringify({ files: manifest.files.length, commentsRemoved: manifest.commentsRemoved }));
}
module.exports = { build };
