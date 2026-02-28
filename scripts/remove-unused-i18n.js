const fs = require("fs");
const path = require("path");

const LOCALES_DIR = path.join(__dirname, "../src/i18n/locales");

// Unused: top-level "game" (2 keys) and top-level "videoConverter" (15 keys)
function removeUnusedFromObject(obj) {
  const copy = { ...obj };
  delete copy.game;
  delete copy.videoConverter;
  return copy;
}

const files = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json"));
for (const f of files) {
  const filePath = path.join(LOCALES_DIR, f);
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const cleaned = removeUnusedFromObject(data);
  fs.writeFileSync(filePath, JSON.stringify(cleaned, null, 2) + "\n", "utf8");
  console.log("Cleaned:", f);
}
console.log(
  'Done. Removed "game" and "videoConverter" from',
  files.length,
  "locales.",
);
