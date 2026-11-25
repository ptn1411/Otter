/**
 * Đối chiếu protocol/types.ts với code đang chạy.
 * Chạy: node protocol/check.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const types = fs.readFileSync(path.join(__dirname, 'types.ts'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server', 'server.js'), 'utf8');
const socket = fs.readFileSync(path.join(root, 'android/app/src/main/java/vn/phonecloud/agent/SocketClient.kt'), 'utf8');

function list(name) {
  const m = types.match(new RegExp('export const ' + name + ' = \\[([\\s\\S]*?)\\] as const'));
  if (!m) throw new Error('không thấy ' + name);
  return m[1].match(/'[^']+'|\d+/g).map((s) => s.replace(/'/g, ''));
}
function setOf(source, name) {
  const m = source.match(new RegExp(name + ' = new Set\\(\\[([^\\]]+)\\]\\)'));
  if (!m) throw new Error('không thấy ' + name);
  return m[1].split(',').map((s) => s.trim());
}
const errors = [];
function same(label, a, b) {
  const as = [...a].sort().join(',');
  const bs = [...b].sort().join(',');
  if (as !== bs) errors.push(label + ': types=' + as + ' code=' + bs);
}
same('quality', list('QUALITIES'), setOf(server, 'ALLOWED_QUALITY'));
same('fps', list('FRAME_RATES'), setOf(server, 'ALLOWED_FPS'));

const commandBlock = types.slice(types.indexOf('export type Command ='), types.indexOf('export type CommandAction'));
const actions = [...commandBlock.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
for (const action of actions) {
  if (!socket.includes('"' + action + '"')) errors.push('SocketClient.kt thiếu "' + action + '"');
}
if (errors.length) {
  console.error('[protocol] FAIL\n' + errors.join('\n'));
  process.exit(1);
}
console.log('[protocol] PASS', new Set(actions).size, 'mã lệnh trong Command');
