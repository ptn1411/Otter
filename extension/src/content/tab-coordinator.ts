/**
 * Otter Tab Coordinator — multi-tab leader election via Web Locks.
 * Only the leader tab should run future auto-repeating background work,
 * via TabStateTracker.runIfLeader(). This module does NOT gate:
 * per-tab URL watching, the page-loop turn watcher (daemon dispatches it
 * to a specific tab via page_loop_start), the command palette, or any
 * user-initiated action. See the revised Folderloom plan.
 */
export class TabStateTracker {
  private _isLeader = false;

  get isLeader(): boolean {
    return this._isLeader;
  }

  promote(): void {
    this._isLeader = true;
  }

  demote(): void {
    this._isLeader = false;
  }

  runIfLeader(action: () => void): void {
    if (this._isLeader) {
      action();
    }
  }
}

export const tabTracker = new TabStateTracker();

export function isLeaderTab(): boolean {
  return tabTracker.isLeader;
}

export async function initTabCoordinator(onPromotedToLeader?: () => void): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.locks) {
    // No Web Locks: stay passive rather than promoting every tab,
    // which would defeat the whole point of leader election.
    console.warn("[Otter Coordinator] navigator.locks unavailable; staying passive (not leader).");
    return;
  }

  // Request an exclusive, long-held lock. The browser releases it
  // automatically when this tab closes/reloads, and a queued tab's
  // request then acquires it and promotes that tab.
  navigator.locks
    .request("otter:session-leader", async () => {
      tabTracker.promote();
      console.log("[Otter Coordinator] Tab này đã được bầu làm Leader Tab điều phối!");
      if (onPromotedToLeader) {
        onPromotedToLeader();
      }

      // Hold the lock until this tab closes.
      return new Promise<void>(() => {});
    })
    .catch((err) => {
      console.warn("[Otter Coordinator] Lock request aborted:", err);
    });
}
