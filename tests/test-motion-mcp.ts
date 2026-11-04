/**
 * Test Motion MCP free (live, cần mạng tới mcp.motion.dev):
 *  1. Đọc example thật motion://examples/react/accordion -> phải chứa
 *     source import từ motion/react.
 *  2. URI không phải motion:// -> bị từ chối (không gọi mạng).
 *  3. URI motion:// không tồn tại -> lỗi rõ ràng, không crash.
 * Chạy: bun scripts/test-motion-mcp.ts
 */
import { readMotionResource, isMotionUri } from "../src/daemon/motion-mcp";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name} ${extra}`); }
}

ok("isMotionUri chấp nhận motion://", isMotionUri("motion://examples/react/accordion"));
ok("isMotionUri từ chối https://", !isMotionUri("https://motion.dev/docs"));

try {
  const text = await readMotionResource("motion://examples/react/accordion");
  ok("đọc accordion thật có motion/react", text.includes("motion/react") && text.includes("Accordion"));
  console.log(`  (accordion ${text.length} ký tự)`);
} catch (e: any) {
  ok("đọc accordion thật có motion/react", false, e.message);
}

try {
  await readMotionResource("https://motion.dev/docs");
  ok("URI https bị từ chối", false, "không throw");
} catch (e: any) {
  ok("URI https bị từ chối", /motion:\/\//.test(e.message));
}

try {
  await readMotionResource("motion://examples/react/khong-ton-tai-xyz");
  ok("URI không tồn tại lỗi rõ", false, "không throw");
} catch (e: any) {
  ok("URI không tồn tại lỗi rõ", true);
  console.log(`  (lỗi: ${e.message.slice(0, 120)})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
