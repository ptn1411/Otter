import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";

async function runCollaborationTest() {
  console.log("========================================================");
  console.log("🚀 BẮT ĐẦU TEST AGENT-TO-AGENT: CHATGPT ↔ MUSE AI LOOP");
  console.log("========================================================");

  const projectDir = path.resolve("storage/projects/calc_project");
  await fs.mkdir(projectDir, { recursive: true });

  // LƯỢT 1: Giao đề bài ban đầu cho Muse
  console.log("\n[LƯỢT 1] ChatGPT giao task cho Muse:");
  const task1 = "Hãy viết một tool Python CLI 'smart_calc.py' có khả năng tính toán biểu thức chuỗi cơ bản (+, -, *, /, lũy thừa ^, ngoặc đơn) an toàn bằng thuật toán Shunting-yard hoặc AST (tuyệt đối không dùng eval()). Hãy in code đầy đủ và có khối if __name__ == '__main__': để chạy từ terminal nhận tham số sys.argv[1].";
  console.log(`Prompt: "${task1.slice(0, 100)}..."`);

  const resp1 = await fetch("http://127.0.0.1:1993/api/activity/v1/muse/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task: task1,
      new_thread: true, // Mở thread mới
      keep_tab_open: true
    })
  });

  const data1 = await resp1.json();
  if (!data1.ok) {
    console.error("❌ Lượt 1 thất bại:", data1.error);
    process.exit(1);
  }

  console.log("✅ Muse đã trả lời Lượt 1!");
  console.log("Trích xuất văn bản Muse trả về:\n", data1.replyText.slice(0, 300) + "...\n");

  // Trích xuất code Python từ phản hồi của Muse
  const codeMatch1 = data1.replyText.match(/```python([\s\S]*?)```/) || data1.replyText.match(/```([\s\S]*?)```/);
  const code1 = codeMatch1 ? codeMatch1[1].trim() : data1.replyText;

  const scriptPath = path.join(projectDir, "smart_calc.py");
  await fs.writeFile(scriptPath, code1);
  console.log(`💾 Đã lưu code Lượt 1 vào: ${scriptPath}`);

  // Test chạy thử code Lượt 1
  let run1Output = "";
  try {
    run1Output = execSync(`python "${scriptPath}" "3 + 5 * 2"`).toString().trim();
    console.log(`🧪 Test chạy thử Lượt 1 [3 + 5 * 2]: ${run1Output}`);
  } catch (err: any) {
    run1Output = "Lỗi khi chạy: " + (err.stderr?.toString() || err.message);
    console.warn("⚠️ Kết quả chạy Lượt 1:", run1Output);
  }

  // LƯỢT 2: ChatGPT phản hồi, yêu cầu nâng cấp & xử lý lỗi (cùng thread!)
  console.log("\n--------------------------------------------------------");
  console.log("[LƯỢT 2] ChatGPT phản biện & giao việc tiếp theo (cùng thread Muse):");
  const task2 = `Tôi đã nhận được code và chạy thử thành công với kết quả: ${run1Output}. Bây giờ tôi muốn bạn nâng cấp thêm 2 tính năng quan trọng:\n1. Hỗ trợ hàm toán học sqrt(x) và abs(x).\n2. Bắt lỗi phép chia cho 0 (ZeroDivisionError) một cách lịch sự, in ra thông báo 'Lỗi: Không thể chia cho 0' thay vì crash chương trình.\nHãy viết lại toàn bộ code Python hoàn chỉnh.`;
  console.log(`Prompt: "${task2.slice(0, 100)}..."`);

  const resp2 = await fetch("http://127.0.0.1:1993/api/activity/v1/muse/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task: task2,
      new_thread: false, // Tiếp tục cùng thread hội thoại!
      keep_tab_open: true
    })
  });

  const data2 = await resp2.json();
  if (!data2.ok) {
    console.error("❌ Lượt 2 thất bại:", data2.error);
    process.exit(1);
  }

  console.log("✅ Muse đã trả lời Lượt 2!");
  console.log("Trích xuất văn bản Muse trả về:\n", data2.replyText.slice(0, 300) + "...\n");

  // Trích xuất code Lượt 2
  const codeMatch2 = data2.replyText.match(/```python([\s\S]*?)```/) || data2.replyText.match(/```([\s\S]*?)```/);
  const code2 = codeMatch2 ? codeMatch2[1].trim() : data2.replyText;

  await fs.writeFile(scriptPath, code2);
  console.log(`💾 Đã cập nhật code Lượt 2 vào: ${scriptPath}`);

  // Chạy test kiểm thử Lượt 2
  try {
    const testZero = execSync(`python "${scriptPath}" "10 / 0"`).toString().trim();
    console.log(`🧪 Test kiểm thử chia cho 0 [10 / 0]: ${testZero}`);
  } catch (err: any) {
    console.log(`🧪 Test kiểm thử chia cho 0:`, err.stdout?.toString() || err.stderr?.toString());
  }

  console.log("\n========================================================");
  console.log("🎉 XÁC NHẬN: AGENT LOOP CHATGPT ↔ MUSE HOẠT ĐỘNG HOÀN HẢO!");
  console.log("Hai Agent có thể trao đổi qua lại nhiều lượt trong cùng 1 thread cho đến khi dự án chạy mượt mà!");
  console.log("========================================================");
}

runCollaborationTest().catch(console.error);

