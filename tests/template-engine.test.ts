import { describe, expect, it } from "bun:test";
import { parseTemplateVariables, renderTemplate } from "../extension/src/content/template-engine";

describe("Template Engine Tests", () => {
  it("trích xuất chính xác các biến dạng text và select options", () => {
    const template = "Duyệt web tại {{ url }} với chế độ {{ mode: fast, full, deep }} và ghi chú {{ note | không có }}";
    const vars = parseTemplateVariables(template);

    expect(vars.length).toBe(3);

    expect(vars[0].name).toBe("url");
    expect(vars[0].type).toBe("text");
    expect(vars[0].defaultValue).toBeUndefined();

    expect(vars[1].name).toBe("mode");
    expect(vars[1].type).toBe("select");
    expect(vars[1].options).toEqual(["fast", "full", "deep"]);

    expect(vars[2].name).toBe("note");
    expect(vars[2].type).toBe("text");
    expect(vars[2].defaultValue).toBe("không có");
  });

  it("thay thế biến chính xác vào template khi render", () => {
    const template = "Mở {{ url }} chế độ {{ mode: fast, full }} ghi chú {{ note }}";
    const rendered = renderTemplate(template, {
      url: "https://google.com",
      mode: "deep",
      note: "test ghi chú"
    });

    expect(rendered).toBe("Mở https://google.com chế độ deep ghi chú test ghi chú");
  });

  it("dùng giá trị mặc định nếu người dùng bỏ trống biến", () => {
    const template = "Lệnh với cờ {{ flag | --verbose }}";
    const rendered = renderTemplate(template, {});
    expect(rendered).toBe("Lệnh với cờ --verbose");
  });

  it("trả về mảng rỗng khi template không có biến", () => {
    expect(parseTemplateVariables("Không có biến ở đây.")).toEqual([]);
    expect(renderTemplate("Không có biến ở đây.", {})).toBe("Không có biến ở đây.");
  });
});
