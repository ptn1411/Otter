/**
 * AnsiStreamParser - Fast, secure ANSI escape sequence parser and HTML renderer
 * Parses ANSI colors, styles, RGB truecolor, and strips non-printable control sequences.
 */

const ANSI_COLORS: Record<number, string> = {
  30: "#484f58", // Black / Dark gray
  31: "#ff7b72", // Red
  32: "#7ee787", // Green
  33: "#f2cc60", // Yellow
  34: "#58a6ff", // Blue
  35: "#bc8cff", // Magenta
  36: "#39c5cf", // Cyan
  37: "#d2a8ff", // White / Light gray
  90: "#8b949e", // Bright Black
  91: "#ffa198", // Bright Red
  92: "#56d364", // Bright Green
  93: "#e3b341", // Bright Yellow
  94: "#79c0ff", // Bright Blue
  95: "#d2a8ff", // Bright Magenta
  96: "#56d4dd", // Bright Cyan
  97: "#ffffff"  // Bright White
};

const ANSI_BG: Record<number, string> = {
  40: "#161b22",
  41: "#b62324",
  42: "#238636",
  43: "#9e6a03",
  44: "#1f6feb",
  45: "#8957e5",
  46: "#1b7c83",
  47: "#6e7681"
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/gu, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/\x1b(?:\([A-Za-z0-9]|[PX^_][^\x1b]*\x1b\\|.)/gu, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\x00-\x07\x0b\x0c\x0e-\x1f\x7f]/gu, "");
}

export class AnsiStreamParser {
  private pending: string = "";
  private fgColor: string | null = null;
  private bgColor: string | null = null;
  private bold: boolean = false;
  private dim: boolean = false;
  private italic: boolean = false;
  private underline: boolean = false;

  reset() {
    this.pending = "";
    this.fgColor = null;
    this.bgColor = null;
    this.bold = false;
    this.dim = false;
    this.italic = false;
    this.underline = false;
  }

  toHtml(chunk: string): string {
    let text = this.pending + chunk;
    this.pending = "";

    // Check if chunk ends with an incomplete ANSI escape sequence
    const partialMatch = text.match(/\x1b(?:\[[0-9;?]*)?$/);
    if (partialMatch) {
      this.pending = partialMatch[0];
      text = text.slice(0, text.length - partialMatch[0].length);
    }

    if (!text) return "";

    // Match SGR sequences (\x1b[...m) as group 1, and other non-SGR sequences to strip
    const regex = /\x1b\[([0-9;?]*)m|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[()][A-Za-z0-9]/g;

    let lastIndex = 0;
    let result = "";
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const textChunk = text.slice(lastIndex, match.index);
      if (textChunk) {
        result += this.renderStyledText(textChunk);
      }
      lastIndex = regex.lastIndex;

      // Handle SGR styling code
      if (match[1] !== undefined) {
        this.processSgr(match[1]);
      }
    }

    const remaining = text.slice(lastIndex);
    if (remaining) {
      result += this.renderStyledText(remaining);
    }

    return result;
  }

  private renderStyledText(raw: string): string {
    // Normalize newlines and clean non-printable control chars
    const cleaned = raw
      .replace(/\r\n/g, "\n")
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");

    if (!cleaned) return "";

    const styles: string[] = [];
    if (this.fgColor) styles.push(`color:${this.fgColor}`);
    if (this.bgColor) styles.push(`background-color:${this.bgColor}`);
    if (this.bold) styles.push("font-weight:600");
    if (this.dim) styles.push("opacity:0.7");
    if (this.italic) styles.push("font-style:italic");
    if (this.underline) styles.push("text-decoration:underline");

    const escaped = escapeHtml(cleaned);
    if (styles.length > 0) {
      return `<span style="${styles.join(";")}">${escaped}</span>`;
    }
    return escaped;
  }

  private processSgr(paramStr: string) {
    const codes = paramStr === "" ? [0] : paramStr.split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 0) {
        this.fgColor = null;
        this.bgColor = null;
        this.bold = false;
        this.dim = false;
        this.italic = false;
        this.underline = false;
      } else if (code === 1) {
        this.bold = true;
      } else if (code === 2) {
        this.dim = true;
      } else if (code === 3) {
        this.italic = true;
      } else if (code === 4) {
        this.underline = true;
      } else if (code === 22) {
        this.bold = false;
        this.dim = false;
      } else if (code === 23) {
        this.italic = false;
      } else if (code === 24) {
        this.underline = false;
      } else if (code === 39) {
        this.fgColor = null;
      } else if (code === 49) {
        this.bgColor = null;
      } else if (ANSI_COLORS[code]) {
        this.fgColor = ANSI_COLORS[code];
      } else if (ANSI_BG[code]) {
        this.bgColor = ANSI_BG[code];
      } else if (code === 38 && codes[i + 1] === 5) {
        // 256 colors foreground: 38;5;n
        const idx = codes[i + 2];
        this.fgColor = ANSI_COLORS[idx] || null;
        i += 2;
      } else if (code === 38 && codes[i + 1] === 2) {
        // 24-bit RGB foreground: 38;2;r;g;b
        const r = codes[i + 2], g = codes[i + 3], b = codes[i + 4];
        this.fgColor = `rgb(${r},${g},${b})`;
        i += 4;
      }
    }
  }
}
