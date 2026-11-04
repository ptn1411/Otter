import { describe, expect, it } from "bun:test";
import { TabStateTracker } from "../extension/src/content/tab-coordinator";

describe("Tab Coordinator Tests", () => {
  it("khởi tạo tab ở trạng thái passive và chuyển thành leader khi nhận lock", () => {
    const tracker = new TabStateTracker();
    expect(tracker.isLeader).toBeFalse();

    tracker.promote();
    expect(tracker.isLeader).toBeTrue();

    tracker.demote();
    expect(tracker.isLeader).toBeFalse();
  });

  it("thực thi callback chỉ khi tab đang là leader", () => {
    const tracker = new TabStateTracker();
    let executed = false;

    tracker.runIfLeader(() => {
      executed = true;
    });
    expect(executed).toBeFalse();

    tracker.promote();
    tracker.runIfLeader(() => {
      executed = true;
    });
    expect(executed).toBeTrue();
  });
});
