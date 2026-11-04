/**
 * Page-loop context — Phase 3 của plan nâng cấp từ codex-web.
 * Logic thuần, không phụ thuộc MCP/Zod.
 *
 * LƯU Ý TRUNG THỰC: repo chưa có tokenizer GPT, nên estimateTokens()
 * là ƯỚC LƯỢNG ký tự (1 token ≈ 4 ký tự), KHÔNG phải số token thật.
 * Chỉ thay hàm này khi có tokenizer thật; logic quyết định không đổi.
 * Reserve 10% cho phần trả lời sắp tới, theo cách codex-web giữ reserve.
 */
export const PAGE_LOOP_DEFAULT_BUDGET = 90_000; // token ước lượng / epoch, tham khảo giới hạn Plus Medium/High mà codex-web đo được — không phải giới hạn chính thức của tài khoản user
export const PAGE_LOOP_RESERVE_RATIO = 0.1;
export const PAGE_LOOP_COMPACT_THRESHOLD_RATIO = 0.9;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function contextUsedAfter(currentUsed: number, prompt: string): number {
  return currentUsed + estimateTokens(prompt);
}

/** Trả "ok" | "compact" | "blocked": vượt trần thì compact nếu được, không thì blocked. */
export function checkBudget(input: { used: number; prompt: string; budget: number; canCompact: boolean }): "ok" | "compact" | "blocked" {
  const reserve = Math.ceil(input.budget * PAGE_LOOP_RESERVE_RATIO);
  const after = contextUsedAfter(input.used, input.prompt);
  if (after + reserve <= input.budget) return "ok";
  if (after >= input.budget * PAGE_LOOP_COMPACT_THRESHOLD_RATIO && input.canCompact) return "compact";
  if (after + reserve > input.budget) return input.canCompact ? "compact" : "blocked";
  return "ok";
}

/** Nudge cho chế độ mục tiêu tự do — chỉ mang phần mới, không mang toàn bộ lịch sử. */
export function buildFreeNudge(input: { goal: string; lastExcerpt: string }): string {
  return [
    `🔄 [Otter Page Loop — tiếp tục] Mục tiêu: ${input.goal}`,
    ``,
    `Tiếp tục làm tiếp, chưa xong. Đừng tóm tắt lại từ đầu, đừng hỏi lại những gì đã rõ.`,
    input.lastExcerpt ? `Phần còn lại cần làm (dựa trên lượt cuối): ${input.lastExcerpt.slice(0, 500)}` : `Mục tiêu ban đầu: ${input.goal}`,
    ``,
    `Khi task đã xong thật, ghi dòng cuối cùng đúng là OTTER-DONE, đứng một mình một dòng. Các lượt chưa xong không được ghi dòng này.`,
  ].join("\n");
}

/** Prompt tiếp theo khi có plan — chỉ task tiếp theo + tóm tắt gọn, không gửi lại toàn bộ plan. */
export function buildIncrementalPrompt(input: { planGoal: string; planId: string; nextGoal: string; nextDetails?: string; nextVerify?: string[]; lastSummary: string; remainingCount: number }): string {
  return [
    `🔄 [Otter Page Loop — tiếp tục plan] Plan: ${input.planGoal} (planId: ${input.planId})`,
    ``,
    `Tóm tắt lượt vừa xong: ${input.lastSummary.slice(0, 500)}`,
    input.remainingCount > 1 ? `Còn lại ${input.remainingCount} task (kể cả task tiếp theo).` : `Còn 1 task cuối cùng.`,
    ``,
    `Task tiếp theo — làm ngay, không dừng, không hỏi lại:`,
    `- Mục tiêu: ${input.nextGoal}`,
    input.nextDetails ? `- Chi tiết: ${input.nextDetails}` : "",
    input.nextVerify?.length ? `- Kiểm thử bắt buộc trước khi báo xong: ${input.nextVerify.join("; ")}` : "",
    ``,
    `Khi task này xong thật, ghi dòng cuối cùng đúng là OTTER-DONE, đứng một mình một dòng.`,
  ].filter((l) => l !== "").join("\n");
}

/** Prompt checkpoint — một lượt duy nhất, yêu cầu tóm tắt trạng thái rồi ghi marker. */
export function buildCheckpointPrompt(input: { goal: string; planId?: string; turnCount: number }): string {
  return [
    `📦 [Otter Page Loop — checkpoint] Mục tiêu: ${input.goal}${input.planId ? ` (planId: ${input.planId})` : ""}`,
    ``,
    `Đã qua ${input.turnCount} lượt. Hãy tóm tắt gọn: đã xong gì, đang dở gì, file nào đã đổi, bước tiếp theo là gì.`,
    `Không làm thêm task mới trong lượt này. Tóm tắt xong, ghi dòng cuối cùng đúng là OTTER-CHECKPOINT, đứng một mình một dòng.`,
  ].join("\n");
}

/** Prompt mở epoch mới sau checkpoint — goal + plan tóm tắt + checkpoint excerpt + task tiếp theo. */
export function buildFreshEpochPrompt(input: { goal: string; planId?: string; checkpointExcerpt: string; nextGoal?: string }): string {
  return [
    `🔁 [Otter Page Loop — epoch mới sau checkpoint] Mục tiêu: ${input.goal}${input.planId ? ` (planId: ${input.planId})` : ""}`,
    ``,
    `Trạng thái đã checkpoint: ${input.checkpointExcerpt.slice(0, 500)}`,
    input.nextGoal ? `Task tiếp theo: ${input.nextGoal}` : `Tiếp tục từ trạng thái đã checkpoint, không làm lại phần đã xong.`,
    ``,
    `Khi task xong thật, ghi dòng cuối cùng đúng là OTTER-DONE, đứng một mình một dòng.`,
  ].join("\n");
}
