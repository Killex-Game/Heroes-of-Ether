'use strict';
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const acorn = require('acorn'), { javascript } = require('./production-code.cjs');
function finalize(directory) {
  const target = fs.realpathSync(directory), manifestFile = path.join(target, 'production-manifest.json');
  if (target === path.resolve(__dirname, '../..') || !fs.existsSync(manifestFile)) throw Error('Expected a separate production build');
  const deps = path.join(target, 'node_modules'), rows = [], notices = [], removedDevelopmentFiles = [];
  if (fs.realpathSync(deps) !== deps) throw Error('Dependencies must belong to this build, not a symlink');
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name), relative = path.relative(target, file).split(path.sep).join('/');
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { walk(file); continue; }
      if (/\.(?:ts|map)$/.test(file)) {
        if (!path.resolve(file).startsWith(deps + path.sep)) throw Error('Unexpected dependency path');
        fs.unlinkSync(file); removedDevelopmentFiles.push(relative); continue;
      }
      if (!/\.(?:js|cjs|mjs)$/.test(file)) continue;
      const source = fs.readFileSync(file, 'utf8'), result = javascript(source), comments = [];
      try { acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script', onComment: comments }); }
      catch { comments.length = 0; acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', onComment: comments }); }
      for (const comment of comments)
        if (/copyright|@license|SPDX-License|Permission is hereby granted/i.test(comment.value)) notices.push(relative + '\n' + comment.value.trim());
      fs.writeFileSync(file, result.output);
      const hash = value => createHash('sha256').update(value).digest('hex');
      rows.push({ file: relative, sourceSha256: hash(source), sha256: hash(result.output), commentsRemoved: result.comments });
    }
  }
  walk(deps);
  fs.writeFileSync(path.join(target, 'THIRD_PARTY_NOTICES.txt'), 'Dependency LICENSE files are retained alongside their packages.\n\n' + notices.join('\n\n'));
  const report = { files: rows, removedDevelopmentFiles, commentsRemoved: rows.reduce((sum, row) => sum + row.commentsRemoved, 0) };
  fs.writeFileSync(path.join(target, 'dependency-manifest.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}
if (require.main === module) {
  const result = finalize(process.argv[2]); console.log(JSON.stringify({ files: result.files.length, commentsRemoved: result.commentsRemoved }));
}
module.exports = { finalize };
