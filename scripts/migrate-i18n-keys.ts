import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const localesDir = path.join(root, "extension", "_locales");

function migrateLocale(lang: string, keyMap: Map<string, string>) {
  const filePath = path.join(localesDir, lang, "messages.json");
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const updated: Record<string, any> = {};

  for (const [key, val] of Object.entries(raw as Record<string, any>)) {
    const newKey = keyMap.get(key) || key;
    if (updated[newKey]) {
      console.log(`[${lang}] Merging duplicate key: ${key} -> ${newKey}`);
    } else {
      updated[newKey] = {
        message: val.message,
        description: newKey
      };
    }
  }

  // Sort keys alphabetically
  const sorted: Record<string, any> = {};
  for (const k of Object.keys(updated).sort()) {
    sorted[k] = updated[k];
  }

  fs.writeFileSync(filePath, JSON.stringify(sorted, null, 2) + "\n", "utf8");
  console.log(`[+] Migrated ${lang}/messages.json: ${Object.keys(sorted).length} keys`);
}

// 1. Build Key Map
const viRaw = JSON.parse(fs.readFileSync(path.join(localesDir, "vi", "messages.json"), "utf8"));
const keyMap = new Map<string, string>();
for (const k of Object.keys(viRaw)) {
  if (k.includes(".")) {
    keyMap.set(k, k.replace(/\./g, "_"));
  }
}
console.log(`[*] Found ${keyMap.size} keys to migrate from dot to underscore.`);

// 2. Migrate both locales
migrateLocale("vi", keyMap);
migrateLocale("en", keyMap);

// 3. Migrate source files
const filesToUpdate = [
  "extension/sidepanel.html",
  "extension/src/content/command-palette.ts",
  "extension/src/content/export-markdown.ts",
  "extension/src/content/folder-picker.ts",
  "extension/src/content/panel/activity-panel.ts",
  "extension/src/content/plan/plan-overlay.ts",
  "extension/src/content/template-engine.ts",
  "extension/src/content/terminal/terminal-panel.ts",
  "extension/src/content/update-checker.ts",
  "extension/src/sidepanel/sidepanel.ts",
  "tests/command-palette.test.ts",
  "tests/i18n.test.ts"
];

// Sort replacements by oldKey length descending so longer keys match first
const sortedEntries = Array.from(keyMap.entries()).sort((a, b) => b[0].length - a[0].length);

for (const relPath of filesToUpdate) {
  const absPath = path.join(root, relPath);
  if (!fs.existsSync(absPath)) continue;

  let text = fs.readFileSync(absPath, "utf8");
  let changeCount = 0;

  for (const [oldKey, newKey] of sortedEntries) {
    // Replace in quotes: "oldKey" or 'oldKey'
    const doubleQuote = `"${oldKey}"`;
    const singleQuote = `'${oldKey}'`;

    if (text.includes(doubleQuote)) {
      text = text.replaceAll(doubleQuote, `"${newKey}"`);
      changeCount++;
    }
    if (text.includes(singleQuote)) {
      text = text.replaceAll(singleQuote, `'${newKey}'`);
      changeCount++;
    }
  }

  if (changeCount > 0) {
    fs.writeFileSync(absPath, text, "utf8");
    console.log(`[+] Updated ${relPath} (${changeCount} replacements)`);
  }
}

console.log("[*] Migration completed successfully!");

