import { describe, it, expect } from "bun:test";
import * as os from "node:os";
import {
  getSystemHostsPath,
  checkHostsFileContent,
  checkHostsIntegrity,
  getProtectedDomains,
} from "../src/daemon/license/hosts-guard";

describe("Hosts File & DNS Spoofing Protection (Windows & macOS)", () => {
  it("resolves the correct system hosts file path for current OS", () => {
    const hostsPath = getSystemHostsPath();
    if (os.platform() === "win32") {
      expect(hostsPath.toLowerCase()).toContain("system32\\drivers\\etc\\hosts");
    } else {
      expect(hostsPath).toBe("/etc/hosts");
    }
  });

  it("passes clean and normal hosts file without spoofed domains", () => {
    const cleanContent = `
# Copyright (c) 1993-2009 Microsoft Corp.
# This is a sample HOSTS file used by Microsoft TCP/IP for Windows.
127.0.0.1       localhost
::1             localhost
127.0.0.1       dev.localapp.internal
# 127.0.0.1 license.otter.ai (commented out)
`;
    const res = checkHostsFileContent(cleanContent);
    expect(res.valid).toBe(true);
    expect(res.tamperedDomain).toBeUndefined();
  });

  it("detects redirection of license domain to 127.0.0.1 (Windows / macOS)", () => {
    const tamperedContent = `
127.0.0.1 localhost
127.0.0.1 license.otter.ai # trying to spoof license server
`;
    const res = checkHostsFileContent(tamperedContent);
    expect(res.valid).toBe(false);
    expect(res.tamperedDomain).toBe("license.otter.ai");
    expect(res.mappedIp).toBe("127.0.0.1");
    expect(res.reason).toContain("license.otter.ai");
  });

  it("detects redirection of official license.gpt.io.vn and otter.gpt.io.vn domains", () => {
    const tamperedOfficial = `
127.0.0.1 license.gpt.io.vn
0.0.0.0 otter.gpt.io.vn
`;
    const res1 = checkHostsFileContent("127.0.0.1 license.gpt.io.vn");
    expect(res1.valid).toBe(false);
    expect(res1.tamperedDomain).toBe("license.gpt.io.vn");

    const res2 = checkHostsFileContent("0.0.0.0 otter.gpt.io.vn");
    expect(res2.valid).toBe(false);
    expect(res2.tamperedDomain).toBe("otter.gpt.io.vn");
  });

  it("detects redirection using 0.0.0.0 or IPv6 ::1 loopback", () => {
    const tamperedZero = `0.0.0.0 api.otter.ai`;
    const resZero = checkHostsFileContent(tamperedZero);
    expect(resZero.valid).toBe(false);
    expect(resZero.tamperedDomain).toBe("api.otter.ai");
    expect(resZero.mappedIp).toBe("0.0.0.0");

    const tamperedIpv6 = `::1 auth.otter.ai`;
    const resIpv6 = checkHostsFileContent(tamperedIpv6);
    expect(resIpv6.valid).toBe(false);
    expect(resIpv6.tamperedDomain).toBe("auth.otter.ai");
    expect(resIpv6.mappedIp).toBe("::1");
  });

  it("detects 127.x.x.x subnet redirects with multiple tabs or spaces", () => {
    const tamperedSubnet = `127.0.0.2\t\t\totter.ai`;
    const res = checkHostsFileContent(tamperedSubnet);
    expect(res.valid).toBe(false);
    expect(res.tamperedDomain).toBe("otter.ai");
  });

  it("detects subdomains of protected server", () => {
    const tamperedSub = `127.0.0.1 v2.license.otter.ai`;
    const res = checkHostsFileContent(tamperedSub);
    expect(res.valid).toBe(false);
    expect(res.tamperedDomain).toBe("v2.license.otter.ai");
  });

  it("ignores legitimate external IPs and comments", () => {
    const externalContent = `
# This is a comment: 127.0.0.1 license.otter.ai
103.21.244.0 license.otter.ai
1.1.1.1 cloudflare-dns.com
`;
    const res = checkHostsFileContent(externalContent);
    expect(res.valid).toBe(true);
  });

  it("supports dynamic custom domain configured in environment variable", () => {
    const prevEnv = process.env.OTTER_LICENSE_DOMAIN;
    process.env.OTTER_LICENSE_DOMAIN = "my-custom-auth.domain.vn";

    try {
      const protectedList = getProtectedDomains();
      expect(protectedList).toContain("my-custom-auth.domain.vn");

      const tampered = `127.0.0.1 my-custom-auth.domain.vn`;
      const res = checkHostsFileContent(tampered);
      expect(res.valid).toBe(false);
      expect(res.tamperedDomain).toBe("my-custom-auth.domain.vn");
    } finally {
      process.env.OTTER_LICENSE_DOMAIN = prevEnv;
    }
  });

  it("executes checkHostsIntegrity on the current OS without error", () => {
    const res = checkHostsIntegrity();
    expect(typeof res.valid).toBe("boolean");
    expect(res.hostsPath).toBeTruthy();
  });
});
