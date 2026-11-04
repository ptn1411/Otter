/**
 * Otter Template Engine — dynamic `{{ variable }}` prompt templates.
 * Pure parse/render (bun-testable, no DOM) + one DOM modal for values.
 * See docs/superpowers/plans/2026-11-01-folderloom-features-plan.md (revised).
 */
import { t } from "../i18n";

export interface TemplateVariable {
  name: string;
  type: "text" | "select";
  options?: string[];
  defaultValue?: string;
  rawPlaceholder: string;
}

export function parseTemplateVariables(template: string): TemplateVariable[] {
  const regex = /\{\{\s*([^}]+)\s*\}\}/g;
  const variables: TemplateVariable[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(template)) !== null) {
    const rawContent = match[1].trim();
    const rawPlaceholder = match[0];

    if (rawContent.includes(":")) {
      const [namePart, optionsPart] = rawContent.split(":", 2);
      const name = namePart.trim();
      const options = optionsPart.split(",").map((o) => o.trim()).filter(Boolean);
      variables.push({
        name,
        type: "select",
        options,
        defaultValue: options[0] || "",
        rawPlaceholder,
      });
    } else if (rawContent.includes("|")) {
      const [namePart, defaultPart] = rawContent.split("|", 2);
      variables.push({
        name: namePart.trim(),
        type: "text",
        defaultValue: defaultPart.trim(),
        rawPlaceholder,
      });
    } else {
      variables.push({
        name: rawContent,
        type: "text",
        rawPlaceholder,
      });
    }
  }

  return variables;
}

export function renderTemplate(template: string, values: Record<string, string>): string {
  const variables = parseTemplateVariables(template);
  let result = template;

  for (const v of variables) {
    const val =
      values[v.name] !== undefined && values[v.name] !== ""
        ? values[v.name]
        : (v.defaultValue ?? "");
    // replace() replaces the first occurrence, so a repeated {{ name }}
    // is filled one occurrence per parsed variable entry.
    result = result.replace(v.rawPlaceholder, val);
  }

  return result;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function showVariablePromptModal(
  commandTitle: string,
  variables: TemplateVariable[],
  onSubmit: (values: Record<string, string>) => void
): void {
  // Dedupe fields by name for the form; renderTemplate still handles
  // repeated placeholders in the template itself.
  const seen = new Set<string>();
  const fields = variables.filter((v) => {
    if (seen.has(v.name)) return false;
    seen.add(v.name);
    return true;
  });

  const existing = document.getElementById("otter-variable-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "otter-variable-modal";
  modal.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    z-index: 100000; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `;

  const container = document.createElement("div");
  container.style.cssText = `
    background: #1e1e2e; color: #cdd6f4; border: 1px solid #45475a;
    border-radius: 12px; padding: 20px; width: 440px; max-width: 90vw;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
  `;

  container.innerHTML = `
    <h3 style="margin: 0 0 14px 0; font-size: 16px; color: #89b4fa; display: flex; align-items: center; gap: 8px;">
      <span>⚡</span> ${escapeHtml(t("tpl_modal_title"))}: ${escapeHtml(commandTitle)}
    </h3>
    <form id="otter-var-form" style="display: flex; flex-direction: column; gap: 12px;">
      ${fields.map((v) => `
        <div>
          <label style="display: block; font-size: 13px; color: #a6adc8; margin-bottom: 4px; font-weight: 500;">
            ${escapeHtml(v.name)} ${v.defaultValue ? `<span style="color: #6c7086;">(${escapeHtml(t("tpl_default_label"))}: ${escapeHtml(v.defaultValue)})</span>` : ""}
          </label>
          ${v.type === "select" ? `
            <select name="${escapeHtml(v.name)}" style="width: 100%; padding: 8px 10px; border-radius: 6px; background: #313244; color: #cdd6f4; border: 1px solid #45475a;">
              ${(v.options || []).map((opt) => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`).join("")}
            </select>
          ` : `
            <input type="text" name="${escapeHtml(v.name)}" value="${escapeHtml(v.defaultValue || "")}" placeholder="${escapeHtml(t("tpl_placeholder", { name: v.name }))}"
              style="width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 6px; background: #313244; color: #cdd6f4; border: 1px solid #45475a;" />
          `}
        </div>
      `).join("")}
      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px;">
        <button type="button" id="otter-var-cancel" style="padding: 7px 14px; border-radius: 6px; background: transparent; color: #a6adc8; border: 1px solid #45475a; cursor: pointer;">${escapeHtml(t("tpl_cancel"))}</button>
        <button type="submit" style="padding: 7px 16px; border-radius: 6px; background: #89b4fa; color: #11111b; font-weight: 600; border: none; cursor: pointer;">${escapeHtml(t("tpl_insert"))}</button>
      </div>
    </form>
  `;

  modal.appendChild(container);
  document.body.appendChild(modal);

  const firstInput = container.querySelector<HTMLInputElement>("input, select");
  if (firstInput) firstInput.focus();

  const form = container.querySelector("#otter-var-form") as HTMLFormElement;
  const cancelBtn = container.querySelector("#otter-var-cancel") as HTMLButtonElement;

  const closeModal = () => {
    modal.remove();
    window.removeEventListener("keydown", onKeyEsc);
  };

  const onKeyEsc = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      closeModal();
    }
  };
  window.addEventListener("keydown", onKeyEsc);

  // Click ra ngoài vùng modal để đóng ngay, không làm gián đoạn người dùng
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeModal();
    }
  };

  cancelBtn.onclick = () => closeModal();
  form.onsubmit = (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const values: Record<string, string> = {};
    for (const v of fields) {
      values[v.name] = (formData.get(v.name) as string) || "";
    }
    closeModal();
    onSubmit(values);
  };
}
