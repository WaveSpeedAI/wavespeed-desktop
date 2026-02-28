const fs = require("fs");
const path = require("path");

function extractKeysFromFile(content) {
  const used = new Set();
  const literalRe = /t\s*\(\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = literalRe.exec(content)) !== null) used.add(m[1]);
  const templateRe = /t\s*\(\s*`([^`]*?)(?=\$\{|\`)/g;
  while ((m = templateRe.exec(content)) !== null) {
    const prefix = m[1];
    if (prefix.length) used.add(prefix);
  }
  return used;
}

const usedLiterals = new Set();
const usedPrefixes = new Set();

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== "node_modules" && e.name !== "dist")
      walk(full);
    else if (e.isFile() && /\.(tsx?|jsx?)$/.test(e.name)) {
      const content = fs.readFileSync(full, "utf8");
      const keys = extractKeysFromFile(content);
      keys.forEach((k) => {
        if (k.includes("${")) return;
        usedLiterals.add(k);
        const parts = k.split(".");
        for (let i = 1; i < parts.length; i++) {
          usedPrefixes.add(parts.slice(0, i).join(".") + ".");
        }
      });
    }
  }
}

walk("src");
walk("electron");

const en = JSON.parse(
  fs.readFileSync(path.join("src/i18n/locales", "en.json"), "utf8"),
);

function allKeys(obj, prefix = "") {
  const keys = [];
  for (const k of Object.keys(obj)) {
    const p = prefix ? prefix + "." + k : k;
    if (
      obj[k] !== null &&
      typeof obj[k] === "object" &&
      !Array.isArray(obj[k])
    ) {
      keys.push(...allKeys(obj[k], p));
    } else {
      keys.push(p);
    }
  }
  return keys;
}

const allLocaleKeys = allKeys(en);

function isKeyUsed(key) {
  if (usedLiterals.has(key)) return true;
  for (const lit of usedLiterals) {
    if (lit.startsWith(key + ".") || lit === key) return true;
  }
  for (const p of usedPrefixes) {
    if (key.startsWith(p) || p.startsWith(key + ".")) return true;
  }
  return false;
}

const unused = allLocaleKeys.filter((k) => !isKeyUsed(k));
console.log("Total locale keys:", allLocaleKeys.length);
console.log("Unused keys count:", unused.length);
console.log(JSON.stringify(unused, null, 2));
