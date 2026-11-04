import * as fs from "node:fs/promises";
import * as path from "node:path";

async function testScheduledTaskFlow() {
  console.log("=================================================");
  console.log("🧪 BẮT ĐẦU KIỂM THỬ TÁC VỤ HẸN GIỜ TRÊN CHATGPT WEB");
  console.log("=================================================\n");

  const now = Date.now();
  const scheduledAt = now + 4000; // Hẹn sau 4 giây để kiểm tra scheduler tự động kích hoạt

  const taskPayload = {
    title: "Phân tích ưu điểm AI Agent + Browser Automation",
    prompt: "Chào ChatGPT, hãy cho tôi biết 3 ưu điểm nổi bật nhất của việc kết hợp AI Agent với tự động hóa tác vụ trên trình duyệt (Browser Automation) trong 50 từ.",
    scheduledAt,
    repeatMinutes: 0
  };

  console.log("[1] Gửi yêu cầu tạo task mới tới API POST /api/tasks...");
  const createRes = await fetch("http://127.0.0.1:1993/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(taskPayload)
  });
  const createData = await createRes.json();
  console.log("[+] Kết quả tạo task:", createData);

  if (!createData.success || !createData.task?.id) {
    console.error("[-] Tạo task thất bại!");
    process.exit(1);
  }

  const taskId = createData.task.id;
  console.log(`[+] Task ID: ${taskId}. Thời gian hẹn: ${new Date(scheduledAt).toLocaleTimeString('vi-VN')}`);
  console.log("[*] Đang đợi bộ lập lịch tự động phát hiện và kích hoạt thực thi...\n");

  const deadline = Date.now() + 180000; // Chờ tối đa 3 phút
  let lastStatus = "pending";

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4000));

    const checkRes = await fetch("http://127.0.0.1:1993/api/tasks");
    const checkData = await checkRes.json();
    const task = (checkData.tasks || []).find((t: any) => t.id === taskId);

    if (!task) {
      console.warn("[-] Không tìm thấy task trong danh sách!");
      continue;
    }

    if (task.status !== lastStatus) {
      console.log(`[Status Change] 🔄 Trạng thái tác vụ: ${lastStatus} -> ${task.status}`);
      lastStatus = task.status;
    }

    if (task.status === "completed") {
      console.log("\n=================================================");
      console.log("🎉 TÁC VỤ HẸN GIỜ ĐÃ HOÀN THÀNH TỰ ĐỘNG 100%!");
      console.log("=================================================");
      console.log(`- Tiêu đề: ${task.title}`);
      console.log(`- Trạng thái: ${task.status}`);
      console.log(`- Chat URL: ${task.chat_url}`);
      console.log(`- Ảnh chụp màn hình: ${task.screenshot_path}`);
      console.log(`- Thời gian hoàn tất: ${new Date(task.completed_at).toLocaleString('vi-VN')}`);
      console.log("\n[Nội dung phản hồi của ChatGPT Web]:");
      console.log(task.response_text);
      console.log("=================================================\n");

      // Kiểm tra file ảnh screenshot tồn tại
      if (task.screenshot_path) {
        const shotExists = await fs.stat(path.resolve(task.screenshot_path)).catch(() => null);
        console.log(`[+] Kiểm tra file ảnh trên ổ đĩa: ${shotExists ? "TỒN TẠI (" + shotExists.size + " bytes)" : "KHÔNG TỒN TẠI"}`);
      }

      return;
    }

    if (task.status === "failed") {
      console.error(`[-] Tác vụ thất bại với lỗi: ${task.error_message}`);
      process.exit(1);
    }
  }

  console.error("[-] Hết thời gian chờ tác vụ hoàn thành!");
  process.exit(1);
}

testScheduledTaskFlow().catch(console.error);

