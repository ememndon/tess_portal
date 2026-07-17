import crypto from "node:crypto";
import sanitizeHtml from "sanitize-html";

/**
 * Renders hostile email HTML safe. Every message body from outside is
 * attacker-controlled; we allowlist tags/attributes, strip scripts /
 * forms / frames / foreign content, neutralize CSS escape hatches
 * (position:fixed overlays, expression(), url() exfil), block remote
 * images by default (tracking pixels) and route allowed ones through a
 * signed proxy, and map cid: inline images to same-origin attachment
 * URLs. The output is still rendered inside a sandboxed iframe (defense
 * in depth) by the reading pane.
 */

function imgSecret(): string {
  return process.env.SESSION_SECRET ?? "";
}

/** Signs a remote image URL to this user so the proxy can't be an open relay. */
export function signImageUrl(userId: string, url: string): string {
  const sig = crypto.createHmac("sha256", imgSecret()).update(`${userId}:${url}`).digest("hex");
  return `/api/mailbox/img-proxy?u=${encodeURIComponent(url)}&sig=${sig}`;
}

export function verifyImageUrl(userId: string, url: string, sig: string): boolean {
  const expected = crypto.createHmac("sha256", imgSecret()).update(`${userId}:${url}`).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cleanseStyle(html: string): string {
  return html
    .replace(/position\s*:\s*(fixed|sticky|absolute)/gi, "position:static")
    .replace(/expression\s*\(/gi, "blocked(")
    .replace(/-moz-binding|behavior\s*:/gi, "blocked:")
    .replace(/url\s*\(\s*['"]?(?!data:image\/)/gi, "url(about:blank#");
}

const DARK_TEXT = "#1f2328"; // the reading pane's default text color

const NAMED_LIGHT = new Set([
  "white", "whitesmoke", "ghostwhite", "ivory", "snow", "floralwhite", "seashell",
  "honeydew", "azure", "aliceblue", "mintcream", "lavenderblush", "oldlace", "linen",
  "beige", "lightyellow", "lightcyan", "cornsilk", "lightgoldenrodyellow", "gainsboro",
]);

/** sRGB relative luminance (0 = black, 1 = white). */
function luminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** True if a CSS color is so light that its contrast on white is unreadable. */
function isTooLightForWhite(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  if (!v) return false;
  if (NAMED_LIGHT.has(v)) return true;
  let m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m) {
    const h = m[1];
    const hex = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return luminance(r, g, b) > 0.55; // contrast on white below ~1.9:1
  }
  m = v.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (m) return luminance(Number(m[1]), Number(m[2]), Number(m[3])) > 0.55;
  return false;
}

/** Does the message declare a canvas of its own (a non-transparent background anywhere)? */
function hasOwnBackground(html: string): boolean {
  const bg = html.match(/bgcolor\s*=\s*["']?\s*([#\w(),.\s]+)/i);
  if (bg && !/^(transparent|none|inherit|initial|unset)$/i.test(bg[1].trim())) return true;
  const re = /background(?:-color)?\s*:\s*([^;"'}]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const v = m[1].trim().toLowerCase();
    if (v && !/^(transparent|none|inherit|initial|unset|0)$/.test(v)) return true;
  }
  return false;
}

/**
 * Rescues dark-client-authored emails: when a message sets light text but no
 * background of its own, that light text is invisible on the reading pane's
 * white canvas. Only when NO background is declared anywhere (so we can't be
 * clobbering an email that intends light-on-dark), rewrite author text colors
 * that are too light to read on white back to the dark default.
 */
function forceReadableText(html: string): string {
  if (hasOwnBackground(html)) return html;
  return html
    // inline style `color:` (guard against matching `background-color`)
    .replace(/(^|[^-\w])color\s*:\s*([^;"'}]+)/gi, (full, pre, val) =>
      isTooLightForWhite(val) ? `${pre}color:${DARK_TEXT}` : full,
    )
    // <font color="…"> presentational attribute
    .replace(/\bcolor\s*=\s*(["'])(.*?)\1/gi, (full, q, val) =>
      isTooLightForWhite(val) ? `color=${q}${DARK_TEXT}${q}` : full,
    );
}

export type SanitizeResult = { html: string; hasRemoteImages: boolean };

export function sanitizeEmailHtml(
  html: string,
  opts: { loadImages: boolean; userId: string; cidMap: Map<string, string> },
): SanitizeResult {
  let hasRemoteImages = false;

  const clean = sanitizeHtml(html, {
    allowedTags: [
      "p", "div", "span", "br", "hr", "a", "b", "i", "u", "s", "strike", "strong", "em",
      "blockquote", "ul", "ol", "li", "dl", "dt", "dd", "h1", "h2", "h3", "h4", "h5", "h6",
      "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col",
      "img", "pre", "code", "sub", "sup", "small", "big", "font", "center", "address", "abbr",
    ],
    allowedAttributes: {
      "*": ["style", "class", "align", "dir", "width", "height", "bgcolor", "valign", "title"],
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height"],
      font: ["color", "face", "size"],
      table: ["cellpadding", "cellspacing", "border", "bgcolor", "width"],
      td: ["colspan", "rowspan", "bgcolor", "nowrap"],
      th: ["colspan", "rowspan", "bgcolor", "nowrap"],
      col: ["span", "width"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" },
      }),
      img: (tagName, attribs) => {
        const src = (attribs.src ?? "").trim();
        const out: Record<string, string> = { ...attribs };
        if (src.toLowerCase().startsWith("cid:")) {
          const cid = src.slice(4).replace(/^<|>$/g, "");
          const attId = opts.cidMap.get(cid) ?? opts.cidMap.get(`<${cid}>`);
          if (attId) out.src = `/api/mailbox/attachment/${attId}?inline=1`;
          else delete out.src;
        } else if (/^https?:/i.test(src)) {
          hasRemoteImages = true;
          if (opts.loadImages) out.src = signImageUrl(opts.userId, src);
          else {
            delete out.src;
            out.alt = attribs.alt || "image blocked";
          }
        } else if (src.startsWith("data:image/")) {
          // allow small inline data images through
        } else {
          delete out.src;
        }
        return { tagName, attribs: out };
      },
    },
    // remove content of these entirely
    nonTextTags: ["script", "style", "textarea", "noscript", "title"],
  });

  return { html: forceReadableText(cleanseStyle(clean)), hasRemoteImages };
}
