import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TabStopType,
  TextRun,
} from "docx";
import type { Profile } from "./schema";
import type { TailoredCv } from "./tailor";

/**
 * Clean professional CV rendering. DOCX through the docx library, and
 * an HTML template used by the worker's Playwright print-to-PDF. The
 * two share one structure so the DOCX and PDF read identically.
 */

export type RenderableCv = {
  name: string;
  headline: string;
  contact: string;
  summary: string;
  skills: string[];
  experience: { company: string; role: string; location: string; start: string; end: string; bullets: string[] }[];
  education: { institution: string; degree: string; field: string; start: string; end: string }[];
  projects: { name: string; description: string; url: string; tech: string[] }[];
};

export function toRenderable(profile: Profile, tailored?: TailoredCv): RenderableCv {
  const contact = [profile.email, profile.phone, profile.location, ...profile.links].filter(Boolean).join("  ·  ");
  return {
    name: profile.name,
    headline: tailored?.headline || profile.headline,
    contact,
    summary: tailored?.summary ?? profile.summary,
    skills: tailored?.skills ?? profile.skills,
    experience: tailored?.experience ?? profile.experience,
    education: profile.education,
    projects: tailored?.selectedProjects ?? profile.projects,
  };
}

/* ---------- DOCX ---------- */

export async function renderDocx(cv: RenderableCv): Promise<Buffer> {
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      children: [new TextRun({ text: cv.name || "Curriculum Vitae", bold: true, size: 36 })],
    }),
  );
  if (cv.headline) {
    children.push(new Paragraph({ children: [new TextRun({ text: cv.headline, size: 24, color: "444444" })] }));
  }
  if (cv.contact) {
    children.push(new Paragraph({ children: [new TextRun({ text: cv.contact, size: 18, color: "666666" })] }));
  }

  const section = (title: string) =>
    children.push(
      new Paragraph({
        spacing: { before: 240, after: 80 },
        border: { bottom: { color: "888888", size: 6, style: "single", space: 1 } },
        children: [new TextRun({ text: title.toUpperCase(), bold: true, size: 22, color: "222222" })],
      }),
    );

  if (cv.summary) {
    section("Summary");
    children.push(new Paragraph({ children: [new TextRun({ text: cv.summary, size: 20 })] }));
  }

  if (cv.skills.length > 0) {
    section("Skills");
    children.push(new Paragraph({ children: [new TextRun({ text: cv.skills.join("  ·  "), size: 20 })] }));
  }

  if (cv.experience.length > 0) {
    section("Experience");
    for (const e of cv.experience) {
      children.push(
        new Paragraph({
          spacing: { before: 120 },
          tabStops: [{ type: TabStopType.RIGHT, position: 9800 }],
          children: [
            new TextRun({ text: `${e.role}, ${e.company}`, bold: true, size: 20 }),
            new TextRun({ text: `\t${[e.start, e.end].filter(Boolean).join(" – ")}`, size: 18, color: "666666" }),
          ],
        }),
      );
      if (e.location) children.push(new Paragraph({ children: [new TextRun({ text: e.location, italics: true, size: 18, color: "666666" })] }));
      for (const b of e.bullets) {
        children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: b, size: 20 })] }));
      }
    }
  }

  if (cv.projects.length > 0) {
    section("Selected work");
    for (const p of cv.projects) {
      children.push(
        new Paragraph({
          spacing: { before: 80 },
          children: [
            new TextRun({ text: p.name, bold: true, size: 20 }),
            p.tech.length ? new TextRun({ text: `  (${p.tech.join(", ")})`, size: 18, color: "666666" }) : new TextRun({ text: "" }),
          ],
        }),
      );
      if (p.description) children.push(new Paragraph({ children: [new TextRun({ text: p.description, size: 20 })] }));
    }
  }

  if (cv.education.length > 0) {
    section("Education");
    for (const ed of cv.education) {
      children.push(
        new Paragraph({
          spacing: { before: 80 },
          tabStops: [{ type: TabStopType.RIGHT, position: 9800 }],
          children: [
            new TextRun({ text: [ed.degree, ed.field].filter(Boolean).join(", "), bold: true, size: 20 }),
            new TextRun({ text: `\t${[ed.start, ed.end].filter(Boolean).join(" – ")}`, size: 18, color: "666666" }),
          ],
        }),
      );
      if (ed.institution) children.push(new Paragraph({ children: [new TextRun({ text: ed.institution, size: 20 })] }));
    }
  }

  const doc = new Document({
    sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } }, children }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

export async function renderCoverLetterDocx(name: string, contact: string, body: string): Promise<Buffer> {
  const children = [
    new Paragraph({ children: [new TextRun({ text: name, bold: true, size: 28 })] }),
    new Paragraph({ children: [new TextRun({ text: contact, size: 18, color: "666666" })], spacing: { after: 240 } }),
    ...body.split(/\n{2,}/).map(
      (para) => new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: para.trim(), size: 22 })] }),
    ),
  ];
  const doc = new Document({
    sections: [{ properties: { page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } }, children }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

/* ---------- HTML for PDF ---------- */

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function cvHtml(cv: RenderableCv): string {
  const section = (title: string, inner: string) =>
    inner ? `<h2>${esc(title)}</h2>${inner}` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1b1f22; font-size: 10.5pt; line-height: 1.4; }
    h1 { font-size: 20pt; margin: 0; }
    .headline { color: #444; font-size: 12pt; margin: 2px 0; }
    .contact { color: #666; font-size: 9pt; margin-bottom: 10px; }
    h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid #999; padding-bottom: 3px; margin: 16px 0 6px; }
    .role { font-weight: 700; }
    .meta { color: #666; font-size: 9pt; float: right; }
    .loc { color: #666; font-style: italic; font-size: 9pt; }
    ul { margin: 4px 0 8px; padding-left: 18px; }
    li { margin: 2px 0; }
    .skills { }
    .proj { margin-top: 6px; }
  </style></head><body>
    <h1>${esc(cv.name || "Curriculum Vitae")}</h1>
    ${cv.headline ? `<div class="headline">${esc(cv.headline)}</div>` : ""}
    ${cv.contact ? `<div class="contact">${esc(cv.contact)}</div>` : ""}
    ${section("Summary", cv.summary ? `<p>${esc(cv.summary)}</p>` : "")}
    ${section("Skills", cv.skills.length ? `<div class="skills">${cv.skills.map(esc).join("  ·  ")}</div>` : "")}
    ${section(
      "Experience",
      cv.experience
        .map(
          (e) => `<div><span class="meta">${esc([e.start, e.end].filter(Boolean).join(" – "))}</span>
        <span class="role">${esc(e.role)}, ${esc(e.company)}</span></div>
        ${e.location ? `<div class="loc">${esc(e.location)}</div>` : ""}
        <ul>${e.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`,
        )
        .join(""),
    )}
    ${section(
      "Selected work",
      cv.projects
        .map((p) => `<div class="proj"><b>${esc(p.name)}</b>${p.tech.length ? ` <span class="loc">(${esc(p.tech.join(", "))})</span>` : ""}${p.description ? `<div>${esc(p.description)}</div>` : ""}</div>`)
        .join(""),
    )}
    ${section(
      "Education",
      cv.education
        .map(
          (ed) => `<div><span class="meta">${esc([ed.start, ed.end].filter(Boolean).join(" – "))}</span>
        <span class="role">${esc([ed.degree, ed.field].filter(Boolean).join(", "))}</span></div>
        ${ed.institution ? `<div>${esc(ed.institution)}</div>` : ""}`,
        )
        .join(""),
    )}
  </body></html>`;
}

export function coverLetterHtml(name: string, contact: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 24mm 22mm; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1b1f22; font-size: 11pt; line-height: 1.55; }
    h1 { font-size: 16pt; margin: 0 0 2px; }
    .contact { color: #666; font-size: 9pt; margin-bottom: 22px; }
    p { margin: 0 0 12px; }
  </style></head><body>
    <h1>${esc(name)}</h1>
    <div class="contact">${esc(contact)}</div>
    ${body.split(/\n{2,}/).map((p) => `<p>${esc(p.trim())}</p>`).join("")}
  </body></html>`;
}
