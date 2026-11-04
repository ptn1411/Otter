import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initDatabase } from "../src/daemon/db";
import {
  addGroupTarget,
  listGroupTargets,
  deleteGroupTarget,
  createGroupSchedule,
  listGroupSchedules,
  cancelGroupSchedule,
  getNextPendingGroupQueueItem,
  updateGroupQueueItemStatus
} from "../src/daemon/fb-group-post";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("FB Group Post Subsystem", () => {
  let db: Database;
  const testDbPath = path.join(os.tmpdir(), `test-group-post-${Date.now()}.sqlite`);

  beforeEach(() => {
    db = initDatabase(testDbPath);
  });

  afterEach(() => {
    db.close();
    try {
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
      if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
      if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);
    } catch {}
  });

  it("adds, lists, and deletes group targets", () => {
    const t1 = addGroupTarget(db, {
      name: "Vibe Code kiếm cơm",
      url: "https://www.facebook.com/groups/1385451906420187/",
      topic: "Lập trình & Công nghệ"
    });
    expect(t1.id).toBeDefined();
    expect(t1.name).toBe("Vibe Code kiếm cơm");

    const t2 = addGroupTarget(db, {
      name: "J2TEAM Community",
      url: "https://www.facebook.com/groups/j2team.community/",
      topic: "Bảo mật & Thủ thuật"
    });
    expect(t2.id).toBeDefined();

    const list = listGroupTargets(db);
    expect(list.length).toBe(2);
    expect(list.some(g => g.name === "Vibe Code kiếm cơm")).toBe(true);

    const deleted = deleteGroupTarget(db, t1.id);
    expect(deleted).toBe(true);

    const listAfter = listGroupTargets(db);
    expect(listAfter.length).toBe(1);
    expect(listAfter[0].name).toBe("J2TEAM Community");
  });

  it("creates schedule in preset mode with 3-minute interval per group queue item", () => {
    const g1 = addGroupTarget(db, { name: "Group A", url: "https://facebook.com/groups/a", topic: "Tech" });
    const g2 = addGroupTarget(db, { name: "Group B", url: "https://facebook.com/groups/b", topic: "Marketing" });
    const g3 = addGroupTarget(db, { name: "Group C", url: "https://facebook.com/groups/c", topic: "Sales" });

    const startTime = Date.now() + 60000; // 1 phút nữa
    const intervalSec = 180; // 3 phút (180s)

    const sched = createGroupSchedule(db, {
      mode: "preset",
      content: "Chào cả nhà, đây là bài viết chia sẻ kinh nghiệm dùng chung!",
      targetGroupIds: [g1.id, g2.id, g3.id],
      scheduledAt: startTime,
      intervalSeconds: intervalSec
    });

    expect(sched.id).toBeDefined();
    expect(sched.mode).toBe("preset");
    expect(sched.status).toBe("pending");

    // Kiểm tra hàng đợi được sinh ra cho 3 nhóm
    const schedules = listGroupSchedules(db);
    expect(schedules.length).toBe(1);
    expect(schedules[0].queue.length).toBe(3);

    const [q1, q2, q3] = schedules[0].queue;
    expect(q1.group_name).toBe("Group A");
    expect(q1.content).toBe("Chào cả nhà, đây là bài viết chia sẻ kinh nghiệm dùng chung!");
    expect(q1.scheduled_at).toBe(startTime);

    expect(q2.group_name).toBe("Group B");
    expect(q2.content).toBe("Chào cả nhà, đây là bài viết chia sẻ kinh nghiệm dùng chung!");
    expect(q2.scheduled_at).toBe(startTime + 180 * 1000); // Cách 3 phút

    expect(q3.group_name).toBe("Group C");
    expect(q3.content).toBe("Chào cả nhà, đây là bài viết chia sẻ kinh nghiệm dùng chung!");
    expect(q3.scheduled_at).toBe(startTime + 360 * 1000); // Cách 6 phút
  });

  it("handles cancel schedule and updates queue item status", () => {
    const g1 = addGroupTarget(db, { name: "Group A", url: "https://facebook.com/groups/a" });
    const sched = createGroupSchedule(db, {
      mode: "preset",
      content: "Nội dung bài viết",
      targetGroupIds: [g1.id],
      scheduledAt: Date.now() - 1000 // Quá khứ -> đến hạn
    });

    const pendingItem = getNextPendingGroupQueueItem(db);
    expect(pendingItem).not.toBeNull();
    expect(pendingItem?.schedule_id).toBe(sched.id);

    // Cập nhật trạng thái
    updateGroupQueueItemStatus(db, pendingItem!.id, "posted");

    const noPending = getNextPendingGroupQueueItem(db);
    expect(noPending).toBeNull();
  });
});

