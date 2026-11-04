import fs from "fs";

for (const f of ["extension/background.js", "extension/dist/background.js", "extension/dist/content.js"]) {
  if (fs.existsSync(f)) {
    const text = fs.readFileSync(f, "utf8");
    const m = text.match(/No [a-zA-Z0-9_ ]+/g);
    console.log(f, m);
  }
}

