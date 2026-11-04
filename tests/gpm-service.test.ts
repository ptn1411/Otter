import { describe, expect, test } from "bun:test";
import {
  generateGscriptActionNode,
  generateGscriptBlock,
  formatGpmCondition,
  validateXPathExpression
} from "../src/daemon/gpm";

describe("GPM Service - GPM Automate V3 Node Generator", () => {
  test("generates valid GPM Automate V3 ActionNode with .NET JSON structure", () => {
    const node = generateGscriptActionNode({
      actionType: 48, // Mouse click
      xpath: "//button[@id='submit-btn']",
      rawInput: { XPATH: "//button[@id='submit-btn']", CLICK_TYPE: "0" },
      comment: "Click submit button",
      delay: "1000,2000"
    });

    expect(node.$type).toBe("GPMAutomateEditor.Models.ActionNode, GPMAutomateEditor.Models");
    expect(node.type).toBe(48);
    expect(node.element_xpath).toBe("//button[@id='submit-btn']");
    expect(node.delay).toBe("1000,2000");
    expect(node.comment).toBe("Click submit button");
    expect(node.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    // raw_input must be a stringified JSON array of Key-Value pairs
    const parsedRawInput = JSON.parse(node.raw_input);
    expect(Array.isArray(parsedRawInput)).toBe(true);
    expect(parsedRawInput).toContainEqual({ Key: "XPATH", Value: "//button[@id='submit-btn']" });
    expect(parsedRawInput).toContainEqual({ Key: "CLICK_TYPE", Value: "0" });
  });

  test("generates valid NormalBlockNode wrapper (paste-ready)", () => {
    const action1 = generateGscriptActionNode({
      actionType: 11, // Go to URL
      rawInput: { URL: "https://example.com" },
      comment: "Navigate to example.com"
    });
    const action2 = generateGscriptActionNode({
      actionType: 118, // Wait element
      xpath: "//h1",
      rawInput: { XPATH: "//h1", TIMEOUT: "10" },
      comment: "Wait for heading"
    });

    const block = generateGscriptBlock([action1, action2], "Sample Automation Block");
    expect(block.$type).toBe("GPMAutomateEditor.Models.NormalBlockNode, GPMAutomateEditor.Models");
    expect(Array.isArray(block.nodes)).toBe(true);
    expect(block.nodes.length).toBe(2);
    expect(block.display_text).toBe("Sample Automation Block");
    expect(block.nodes[0].type).toBe(11);
    expect(block.nodes[1].type).toBe(118);
  });

  test("formats GPM Automate condition properly with hasElement", () => {
    const positiveCond = formatGpmCondition("//button[@id='login']", false);
    expect(positiveCond).toBe("hasElement(//button[@id='login'])");

    const negativeCond = formatGpmCondition("//button[@id='login']", true);
    expect(negativeCond).toBe("!hasElement(//button[@id='login'])");
  });

  test("validates XPath expression correctly", () => {
    expect(validateXPathExpression("//div[@class='test']").valid).toBe(true);
    expect(validateXPathExpression("invalid-xpath[[[").valid).toBe(false);
    expect(validateXPathExpression("").valid).toBe(false);
  });
});

