/**
 * Turn reader tests — pure logic + fake DOM objects, no real browser.
 * Run: bun scripts/test-chatgpt-turn-reader.ts
 * Covers: markers, hash dedupe, unseen/ambiguous selection, settle
 * classification (generating / tool_paused / settled / waiting),
 * and readLastAssistantTurn on a reconstructed fixture DOM.
 */
import {
  classifyWatcherState, hashTurnText, isCheckpointMarker, isDoneMarker,
  readLastAssistantTurn, selectLastUnseenTurn, shouldSettle,
} from "../extension/src/content/chatgpt-turn-reader";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`[PASS] ${name}`); }
  else { fail++; console.log(`[FAIL] ${name} ${extra}`); }
}

check("done marker last line only", isDoneMarker("Xong\nOTTER-DONE") === true);
check("done marker not when not last", isDoneMarker("OTTER-DONE\nthêm nữa") === false);
check("checkpoint marker", isCheckpointMarker("Tóm tắt\nOTTER-CHECKPOINT") === true);
check("hash stable", hashTurnText("abc") === hashTurnText("abc") && hashTurnText("abc") !== hashTurnText("abd"));

// settle classification
const base = { generating: false, generationEndedAt: 1000, lastDomChangeAt: 1000, mcpActivityAt: null };
check("settled after 5s gen + 2s dom quiet", shouldSettle(base, 7000) === true);
check("not settled before 5s", shouldSettle(base, 5000) === false);
check("generating -> generating", classifyWatcherState({ ...base, generating: true }, 7000) === "generating");
check("MCP recent -> tool_paused, not settled", classifyWatcherState({ ...base, mcpActivityAt: 6500 }, 7000) === "tool_paused");
check("never generated -> waiting", classifyWatcherState({ ...base, generationEndedAt: null }, 7000) === "waiting");

// unseen selection
const cands = [
  { turnId: "t1", text: "hello", kind: "prose" as const, selectorUsed: "s" },
  { turnId: "t2", text: "world", kind: "prose" as const, selectorUsed: "s" },
];
check("last unseen picked", selectLastUnseenTurn(cands, new Set(["t1"]), new Set()).turn?.turnId === "t2");
check("all seen -> no_new_turn", selectLastUnseenTurn(cands, new Set(["t1", "t2"]), new Set()).reason === "no_new_turn");
check("no-id multiple distinct -> ambiguous", selectLastUnseenTurn(
  [{ turnId: null, text: "a", kind: "prose" as const, selectorUsed: "s" }, { turnId: null, text: "b", kind: "prose" as const, selectorUsed: "s" }],
  new Set(), new Set()).reason === "ambiguous_no_id");

// Reconstructed fixture DOM (NOT a real capture): assistant turn with
// data-turn-id + .markdown, plus a user turn that must not be picked.
function fakeNode(attrs: Record<string, string>, prose: string) {
  return {
    getAttribute: (n: string) => attrs[n] ?? null,
    closest: () => null,
    innerText: prose,
    textContent: prose,
    querySelector: (sel: string) => sel === ".markdown" ? { innerText: prose, textContent: prose } : null,
  };
}
const assistantNode = fakeNode({ "data-turn-id": "turn_abc", "data-message-author-role": "assistant" }, "Kết quả\nOTTER-DONE");
const fakeRoot: any = {
  querySelectorAll: (sel: string) => sel === '[data-message-author-role="assistant"]' ? [assistantNode] : [],
  querySelector: () => null,
};
const read = readLastAssistantTurn(fakeRoot, new Set(), new Set());
check("fixture: reads assistant turn by role selector", read.turn !== null && read.turn.turnId === "turn_abc" && read.turn.selectorUsed === '[data-message-author-role="assistant"]');
check("fixture: excerpt capped 500", (read.turn?.excerpt.length || 0) <= 500);
const readAgain = readLastAssistantTurn(fakeRoot, new Set(["turn_abc"]), new Set([read.turn?.textHash || ""]));
check("fixture: remount same turn -> no_new_turn", readAgain.reason === "no_new_turn");

const emptyRoot: any = { querySelectorAll: () => [], querySelector: () => null };
check("fixture: no turn -> unreadable, not guessed", readLastAssistantTurn(emptyRoot, new Set(), new Set()).reason === "unreadable");

console.log(`\nTurn reader tests: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
