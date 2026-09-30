// Generates a small "scanned textbook" PDF for the end-to-end test:
// PDF page i prints the semantic label "4.(28+i)" in its footer, so
// PDF page 5 is page "4.33", which contains Exercise 4.3 question 22.
import { writeFileSync } from "node:fs";

const W = 595, H = 842;
const esc = (s) => s.replace(/[\\()]/g, (c) => "\\" + c);
function pageContent(i) {
  const label = `4.${28 + i}`;
  const lines = [];
  const text = (x, y, size, s, font = "F1") => lines.push(`BT /${font} ${size} Tf ${x} ${y} Td (${esc(s)}) Tj ET`);
  text(60, 800, 10, "CHAPTER 4  APPLICATIONS OF DERIVATIVES", "F2");
  lines.push("0.5 w 60 792 m 535 792 l S");
  if (label === "4.33") {
    text(60, 740, 16, "Exercise 4.3", "F2");
    const qs = [
      "20. Find the slope of the tangent to y = x^2 + 1 at x = 1.",
      "21. Show that f(x) = e^x is increasing on R.",
    ];
    let y = 700;
    for (const q of qs) { text(60, y, 12, q); y -= 40; }
    y = 488;
    text(60, y, 12, "22. Let f(x) = x^3 - 3x. Find the intervals in which f is increasing", "F1");
    text(80, y - 18, 12, "or decreasing, and find its local maximum and minimum values.");
    text(80, y - 40, 12, "(a) Sketch y = f(x) and y = f'(x) on the same axes.");
    text(80, y - 58, 12, "(b) Explain the connection between the two graphs.");
    text(60, 360, 12, "23. Find the area bounded by y = x and y = x^2.");
    text(60, 320, 12, "24. For which values of a does y = x^2 + ax + 1 touch the x-axis?");
  } else {
    let y = 740;
    for (let k = 0; k < 14; k++) { text(60, y, 11, `Worked example ${i}.${k + 1}: consider the function g(x) = x^${(k % 3) + 2} and its derivative.`); y -= 36; }
  }
  lines.push("0.5 w 60 60 m 535 60 l S");
  text(510, 40, 11, label, "F2");
  return lines.join("\n");
}

const N = 8;
const objs = [];
const add = (s) => { objs.push(s); return objs.length; };
const catalog = add(null), pagesObj = add(null);
const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
const kids = [];
for (let i = 1; i <= N; i++) {
  const c = pageContent(i);
  const content = add(`<< /Length ${Buffer.byteLength(c)} >>\nstream\n${c}\nendstream`);
  kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
}
objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${N} >>`;

let out = "%PDF-1.4\n";
const offsets = [];
objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
const xref = Buffer.byteLength(out);
out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
const file = process.argv[2] ?? "test-book.pdf";
writeFileSync(file, out);
console.log(`wrote ${file} (${N} pages)`);
