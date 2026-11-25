import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EMBEDDED_DASHBOARD_ASSETS } from "../src/daemon/dashboard-assets.generated";
import { handleSystemRoutes } from "../src/daemon/routes/system-routes";

describe("Embedded Dashboard Assets", () => {
  it("nhúng sẵn index.html, Phòng ban (phong/) và các file JS/CSS trong bundle", () => {
    const keys = Object.keys(EMBEDDED_DASHBOARD_ASSETS);
    expect(keys).toContain("index.html");
    expect(keys.some((k) => k.startsWith("assets/") && k.endsWith(".js"))).toBe(true);
    expect(keys.some((k) => k.startsWith("assets/") && k.endsWith(".css"))).toBe(true);
    expect(keys).toContain("phong/index.html");
    expect(keys.some((k) => k.startsWith("phong/assets/") && k.endsWith(".js"))).toBe(true);
    expect(keys.some((k) => k.startsWith("phong/assets/") && k.endsWith(".css"))).toBe(true);
  });

  it("phục vụ /dashboard và tài nguyên từ bộ nhớ nhúng ngay cả khi cwd không có deploy/dashboard/", async () => {
    const origCwd = process.cwd();
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "otter-dash-embed-"));
    try {
      process.chdir(emptyDir);

      // 1. HTML giải nén khi client không gửi Accept-Encoding: gzip
      const htmlUrl = new URL("http://localhost:1993/dashboard");
      const htmlRes = await handleSystemRoutes(new Request(htmlUrl), htmlUrl, 1993);
      expect(htmlRes).not.toBeNull();
      expect(htmlRes!.status).toBe(200);
      expect(htmlRes!.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(htmlRes!.headers.get("content-encoding")).toBeNull();
      const html = await htmlRes!.text();
      expect(html).toContain("<title>Otter Dashboard</title>");
      expect(html).toContain("/dashboard/assets/");

      // 2. Gzip pass-through khi client hỗ trợ gzip
      const gzRes = await handleSystemRoutes(
        new Request(htmlUrl, { headers: { "Accept-Encoding": "gzip, deflate, br" } }),
        htmlUrl,
        1993
      );
      expect(gzRes!.status).toBe(200);
      expect(gzRes!.headers.get("content-encoding")).toBe("gzip");
      const gzBuf = new Uint8Array(await gzRes!.arrayBuffer());
      const decoded = new TextDecoder().decode(Bun.gunzipSync(gzBuf));
      expect(decoded).toBe(html);

      // 3. Asset JS có cache immutable
      const jsKey = Object.keys(EMBEDDED_DASHBOARD_ASSETS).find((k) => k.startsWith("assets/") && k.endsWith(".js"))!;
      const jsUrl = new URL(`http://localhost:1993/dashboard/${jsKey}`);
      const jsRes = await handleSystemRoutes(new Request(jsUrl), jsUrl, 1993);
      expect(jsRes!.status).toBe(200);
      expect(jsRes!.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
      expect(jsRes!.headers.get("cache-control")).toContain("immutable");

      // 3.5 Phục vụ Phòng ban 3D tại /dashboard/phong và /dashboard/phong/ từ bộ nhớ nhúng
      for (const phongPath of ["/dashboard/phong", "/dashboard/phong/", "/dashboard/phong/index.html"]) {
        const phongUrl = new URL(`http://localhost:1993${phongPath}`);
        const phongRes = await handleSystemRoutes(new Request(phongUrl), phongUrl, 1993);
        expect(phongRes).not.toBeNull();
        expect(phongRes!.status).toBe(200);
        expect(phongRes!.headers.get("content-type")).toBe("text/html; charset=utf-8");
        const phongHtml = await phongRes!.text();
        expect(phongHtml).toContain("/dashboard/phong/assets/");
      }

      const phongJsKey = Object.keys(EMBEDDED_DASHBOARD_ASSETS).find(
        (k) => k.startsWith("phong/assets/") && k.endsWith(".js")
      )!;
      const phongJsUrl = new URL(`http://localhost:1993/dashboard/${phongJsKey}`);
      const phongJsRes = await handleSystemRoutes(new Request(phongJsUrl), phongJsUrl, 1993);
      expect(phongJsRes!.status).toBe(200);
      expect(phongJsRes!.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
      expect(phongJsRes!.headers.get("cache-control")).toContain("immutable");

      // 4. Chặn path traversal & prototype key
      const badUrl = new URL("http://localhost:1993/dashboard/..%2Fpackage.json");
      const badRes = await handleSystemRoutes(new Request(badUrl), badUrl, 1993);
      expect(badRes!.status).toBe(404);

      const protoUrl = new URL("http://localhost:1993/dashboard/toString");
      const protoRes = await handleSystemRoutes(new Request(protoUrl), protoUrl, 1993);
      expect(protoRes!.status).toBe(404);
    } finally {
      process.chdir(origCwd);
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
