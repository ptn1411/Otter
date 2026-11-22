import { beforeEach, describe, expect, it } from "bun:test";
import {
  isCbmInternalDaemonCommand,
  parseStaleCbmDaemonPid,
  recoverStaleCbmDaemon,
  resetCbmRecoveryForTests,
  type CbmDaemonProbe,
} from "../src/daemon/cbm";

const STALE = "codebase-memory-mcp: CBM daemon endpoint is held by pid 7436 but that process answered no rendezvous within 30000 ms; the daemon runtime is likely dead — stop that process, then retry";

function stale(pid: number): string {
  return STALE.replace("7436", String(pid));
}

function daemonProbe(stops: number[]): CbmDaemonProbe {
  return {
    inspect: async (pid) => ({
      imageName: "codebase-memory-mcp.exe",
      commandLine: `"C:\\Program\\codebase-memory-mcp.exe" --cbm-daemon-internal ${pid}`,
    }),
    stop: async (pid) => {
      stops.push(pid);
      return true;
    },
  };
}

describe("codebase-memory stale daemon recovery", () => {
  beforeEach(() => {
    resetCbmRecoveryForTests();
  });

  it("reads the pid from the rendezvous error", () => {
    expect(parseStaleCbmDaemonPid(STALE)).toBe(7436);
  });

  it("ignores errors that are not a dead daemon lock", () => {
    expect(parseStaleCbmDaemonPid("project not found")).toBeNull();
    expect(parseStaleCbmDaemonPid("endpoint is held by pid 12 but the database is locked")).toBeNull();
    expect(parseStaleCbmDaemonPid("endpoint is held by pid 0 but that process answered no rendezvous")).toBeNull();
  });

  it("accepts only the internal daemon, not the CLI client with the same exe name", () => {
    expect(isCbmInternalDaemonCommand(
      "codebase-memory-mcp.exe",
      "\"C:\\\\Users\\\\NAM\\\\AppData\\\\Local\\\\Programs\\\\codebase-memory-mcp\\\\codebase-memory-mcp.exe\" --cbm-daemon-internal",
    )).toBe(true);
    expect(isCbmInternalDaemonCommand(
      "codebase-memor",
      "/usr/local/bin/codebase-memory-mcp --cbm-daemon-internal",
    )).toBe(true);
    expect(isCbmInternalDaemonCommand(
      "codebase-memory-mcp.exe",
      "codebase-memory-mcp cli --quiet --json list_projects {}",
    )).toBe(false);
    expect(isCbmInternalDaemonCommand(
      "powershell.exe",
      "powershell --cbm-daemon-internal",
    )).toBe(false);
  });

  it("does not stop a pid whose command line is not the internal daemon", async () => {
    const stopped: number[] = [];
    const healed = await recoverStaleCbmDaemon(STALE, {
      inspect: async () => ({ imageName: "powershell.exe", commandLine: "powershell.exe -NoProfile" }),
      stop: async (pid) => {
        stopped.push(pid);
        return true;
      },
    });
    expect(healed).toBe(false);
    expect(stopped).toEqual([]);
  });

  it("treats an already exited pid as cleared", async () => {
    const healed = await recoverStaleCbmDaemon(STALE, {
      inspect: async () => null,
      stop: async () => {
        throw new Error("stop should not run");
      },
    });
    expect(healed).toBe(true);
  });

  it("stops one verified daemon once when recoveries overlap", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stopped: number[] = [];
    const probe: CbmDaemonProbe = {
      inspect: async () => {
        await gate;
        return {
          imageName: "codebase-memory-mcp.exe",
          commandLine: "codebase-memory-mcp.exe --cbm-daemon-internal",
        };
      },
      stop: async (pid) => {
        stopped.push(pid);
        return true;
      },
    };

    const pending = Promise.all([
      recoverStaleCbmDaemon(STALE, probe),
      recoverStaleCbmDaemon(STALE, probe),
    ]);
    release();
    const [first, second] = await pending;
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(stopped).toEqual([7436]);
  });

  it("recovers two different pids independently", async () => {
    const stopped: number[] = [];
    const probe = daemonProbe(stopped);
    const [first, second] = await Promise.all([
      recoverStaleCbmDaemon(stale(7436), probe),
      recoverStaleCbmDaemon(stale(8000), probe),
    ]);
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(stopped.slice().sort((a, b) => a - b)).toEqual([7436, 8000]);
  });
});
