#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const input = process.argv[2] || "questions.json";
const output = process.argv[3] || "questions.fixed.json";

function findMatchingBrace(text, start) {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function normalizeQuestion(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (typeof obj.section !== "string") return null;
  if (typeof obj.q !== "string") return null;
  if (!Array.isArray(obj.options) || obj.options.length < 2) return null;

  const options = obj.options.map((o) => ({
    text: String(o?.text ?? "").trim(),
    correct: o?.correct === true
  }));

  if (options.some((o) => !o.text)) return null;

  const correctCount = options.filter((o) => o.correct).length;
  if (correctCount !== 1) return null;

  return {
    section: obj.section.trim(),
    q: obj.q.trim(),
    options
  };
}

function extractQuestions(raw) {
  const questions = [];
  const errors = [];
  const seen = new Set();

  // Find occurrences of "section": then backtrack to nearest "{"
  const re = /"section"\s*:/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const idx = m.index;
    const start = raw.lastIndexOf("{", idx);
    if (start < 0) continue;

    const end = findMatchingBrace(raw, start);
    if (end < 0) {
      errors.push(`Unclosed object near index ${start}`);
      continue;
    }

    const candidate = raw.slice(start, end + 1);

    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue; // ignore malformed fragments
    }

    const q = normalizeQuestion(parsed);
    if (!q) continue;

    const key = `${q.section}|||${q.q}`;
    if (seen.has(key)) continue;
    seen.add(key);

    questions.push(q);
  }

  return { questions, errors };
}

function main() {
  const inPath = path.resolve(process.cwd(), input);
  const outPath = path.resolve(process.cwd(), output);

  if (!fs.existsSync(inPath)) {
    console.error(`❌ Input not found: ${inPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(inPath, "utf8");
  const { questions, errors } = extractQuestions(raw);

  if (!questions.length) {
    console.error("❌ No valid questions extracted.");
    process.exit(1);
  }

  const cleaned = { questions };
  fs.writeFileSync(outPath, JSON.stringify(cleaned, null, 2), "utf8");

  console.log(`✅ Repaired file written: ${outPath}`);
  console.log(`   Questions extracted: ${questions.length}`);
  if (errors.length) {
    console.log(`   Warnings: ${errors.length}`);
  }
}

main();
