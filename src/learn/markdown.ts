// A small, dependency-free Markdown -> HTML renderer.
//
// It is intentionally NOT a full CommonMark implementation. It supports exactly
// the subset used by the /learn document (headings, paragraphs, lists, tables,
// fenced code with light syntax highlighting, blockquotes + GitHub-style
// callouts, inline code/bold/italic/links, images, and horizontal rules).
// Because we author the source markdown ourselves, this stays simple and safe.

export interface Heading {
  level: number
  text: string
  id: string
}

export interface RenderResult {
  html: string
  headings: Heading[]
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

const usedIds = new Set<string>()
function slug(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
  let id = base || "section"
  let n = 2
  while (usedIds.has(id)) id = `${base}-${n++}`
  usedIds.add(id)
  return id
}

// ---------------------------------------------------------------------------
// syntax highlighting (token-based, escape-safe)
// ---------------------------------------------------------------------------

type Lang = "ts" | "js" | "glsl" | "bash" | "html" | "plain"

const TS_KW = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while",
  "class", "extends", "new", "import", "from", "export", "default", "interface",
  "type", "as", "readonly", "private", "public", "protected", "this", "void",
  "async", "await", "of", "in", "typeof", "instanceof", "get", "set", "enum",
  "namespace", "implements", "super", "throw", "try", "catch", "finally",
  "switch", "case", "break", "continue", "do", "static", "null", "undefined",
  "true", "false",
])

const GLSL_KW = new Set([
  "uniform", "varying", "attribute", "in", "out", "inout", "const", "if",
  "else", "for", "while", "return", "struct", "precision", "highp", "mediump",
  "lowp", "layout", "discard", "true", "false", "define", "include", "ifdef",
  "ifndef", "endif",
])

const GLSL_TYPES = new Set([
  "void", "float", "int", "bool", "vec2", "vec3", "vec4", "mat2", "mat3",
  "mat4", "sampler2D", "sampler3D", "samplerCube", "ivec2", "ivec3", "ivec4",
])

const GLSL_FN = new Set([
  "mix", "smoothstep", "clamp", "fract", "floor", "ceil", "abs", "sin", "cos",
  "tan", "atan", "asin", "acos", "pow", "exp", "log", "length", "normalize",
  "dot", "cross", "reflect", "refract", "texture", "texture2D", "textureCube",
  "min", "max", "step", "mod", "sign", "sqrt", "distance", "radians",
  "degrees", "fwidth", "dFdx", "dFdy",
])

const BASH_KW = new Set([
  "npm", "run", "cd", "echo", "export", "if", "then", "fi", "for", "do",
  "done", "in", "while", "git", "node", "npx", "set", "source",
])

function highlight(code: string, lang: Lang): string {
  if (lang === "plain" || lang === "html") return esc(code)

  const kw = lang === "glsl" ? GLSL_KW : lang === "bash" ? BASH_KW : TS_KW
  const isGlsl = lang === "glsl"
  const hashComment = lang === "bash"

  const commentAlt = hashComment
    ? "\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*|#[^\\n]*"
    : "\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*"

  const re = new RegExp(
    "(" + commentAlt + ")" + // 1 comment
      "|(\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*'|`(?:\\\\.|[^`\\\\])*`)" + // 2 string
      "|(\\b0[xX][0-9a-fA-F]+\\b|\\b\\d+\\.?\\d*(?:[eE][+-]?\\d+)?\\b)" + // 3 number
      "|([A-Za-z_#$][\\w$]*)" + // 4 ident
      "|([\\s\\S])", // 5 anything else
    "g",
  )

  let out = ""
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    if (m[1] != null) {
      out += `<span class="tok-com">${esc(m[1])}</span>`
    } else if (m[2] != null) {
      out += `<span class="tok-str">${esc(m[2])}</span>`
    } else if (m[3] != null) {
      out += `<span class="tok-num">${esc(m[3])}</span>`
    } else if (m[4] != null) {
      const t = m[4]
      const next = code[re.lastIndex]
      let cls = ""
      if (t[0] === "#") cls = "tok-meta"
      else if (isGlsl && GLSL_TYPES.has(t)) cls = "tok-type"
      else if (kw.has(t)) cls = "tok-kw"
      else if (isGlsl && GLSL_FN.has(t)) cls = "tok-fn"
      else if (next === "(") cls = "tok-fn"
      out += cls ? `<span class="${cls}">${esc(t)}</span>` : esc(t)
    } else {
      out += esc(m[5])
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// inline (bold / italic / code / links / images)
// ---------------------------------------------------------------------------

function inline(text: string): string {
  // pull inline-code out first so ** and * inside it are left alone. The marker
  // is bracketed ([[C0]]) so bare numbers in prose ("6 levels") are never
  // mistaken for a placeholder.
  const codes: string[] = []
  let s = text.replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(`<code>${esc(c)}</code>`)
    return `[[C${codes.length - 1}]]`
  })

  s = esc(s)

  // images: ![alt](src)
  s = s.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (_m, alt, src) => `<img src="${src}" alt="${alt}" loading="lazy" />`,
  )
  // links: [text](href)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
    const ext = /^https?:/.test(href)
    const attrs = ext ? ' target="_blank" rel="noopener"' : ""
    return `<a href="${href}"${attrs}>${label}</a>`
  })
  // glossary term tooltip: [[term|definition]] -> hover/focus shows the definition
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_m, term, def) =>
    `<span class="term" tabindex="0" role="note" data-tip="${def.trim()}">${term.trim()}</span>`,
  )

  // bold then italic
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")

  // restore inline code
  s = s.replace(/\[\[C(\d+)\]\]/g, (_m, i) => codes[+i] ?? "")
  return s
}

// ---------------------------------------------------------------------------
// callouts
// ---------------------------------------------------------------------------

const CALLOUT_ICON: Record<string, string> = {
  note: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>',
  tip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.7.8 1 1.3 1 2.5h6c0-1.2.3-1.7 1-2.5A6 6 0 0 0 12 3z"/></svg>',
  warning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 2.5 20h19L12 4z"/><path d="M12 10v4"/><path d="M12 17h.01"/></svg>',
  important: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12H7l-3 3V4z"/><path d="M12 8v3"/><path d="M12 13h.01"/></svg>',
}

// ---------------------------------------------------------------------------
// block parser
// ---------------------------------------------------------------------------

export function renderMarkdown(src: string): RenderResult {
  usedIds.clear()
  const headings: Heading[] = []

  // 1. extract fenced code blocks into placeholders
  const blocks: { lang: Lang; code: string }[] = []
  const text = src.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang: string, code: string) => {
    const l = (["ts", "js", "glsl", "bash", "html"].includes(lang) ? lang : "plain") as Lang
    blocks.push({ lang: l, code: code.replace(/\n$/, "") })
    return `@@CODEBLOCK${blocks.length - 1}@@`
  })

  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  const html: string[] = []
  let i = 0

  const flushParagraph = (buf: string[]) => {
    if (buf.length) html.push(`<p>${inline(buf.join(" "))}</p>`)
    buf.length = 0
  }

  while (i < lines.length) {
    const line = lines[i]

    // blank
    if (/^\s*$/.test(line)) {
      i++
      continue
    }

    // fenced code placeholder
    const codeMatch = line.match(/^@@CODEBLOCK(\d+)@@$/)
    if (codeMatch) {
      const b = blocks[+codeMatch[1]]
      const label = b.lang === "plain" ? "" : `<span class="code__lang">${b.lang}</span>`
      html.push(
        `<div class="code">${label}<pre><code>${highlight(b.code, b.lang)}</code></pre></div>`,
      )
      i++
      continue
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      const level = h[1].length
      const raw = h[2].trim()
      const id = slug(raw)
      if (level >= 2 && level <= 3) headings.push({ level, text: raw, id })
      html.push(`<h${level} id="${id}">${inline(raw)}</h${level}>`)
      i++
      continue
    }

    // horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      html.push("<hr />")
      i++
      continue
    }

    // table: header row + separator row of |---|---|
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1] || "")) {
      const parseRow = (r: string) =>
        r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim())
      const headers = parseRow(line)
      i += 2 // skip header + separator
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(parseRow(lines[i]))
        i++
      }
      let t = '<div class="table-wrap"><table><thead><tr>'
      t += headers.map((c) => `<th>${inline(c)}</th>`).join("")
      t += "</tr></thead><tbody>"
      for (const r of rows) {
        t += "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>"
      }
      t += "</tbody></table></div>"
      html.push(t)
      continue
    }

    // blockquote / callout
    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""))
        i++
      }
      const first = quoteLines[0] || ""
      const callout = first.match(/^\[!(NOTE|TIP|WARNING|IMPORTANT)\]\s*(.*)$/i)
      if (callout) {
        const kind = callout[1].toLowerCase()
        const rest = [callout[2], ...quoteLines.slice(1)].filter(Boolean).join(" ")
        const icon = CALLOUT_ICON[kind] || CALLOUT_ICON.note
        html.push(
          `<div class="callout callout--${kind}"><div class="callout__icon">${icon}</div>` +
            `<div class="callout__body"><span class="callout__label">${kind}</span>` +
            `<p>${inline(rest)}</p></div></div>`,
        )
      } else {
        html.push(`<blockquote><p>${inline(quoteLines.join(" "))}</p></blockquote>`)
      }
      continue
    }

    // unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""))
        i++
      }
      html.push("<ul>" + items.map((it) => `<li>${inline(it)}</li>`).join("") + "</ul>")
      continue
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""))
        i++
      }
      html.push("<ol>" + items.map((it) => `<li>${inline(it)}</li>`).join("") + "</ol>")
      continue
    }

    // paragraph (accumulate until blank / block boundary)
    const buf: string[] = []
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^@@CODEBLOCK\d+@@$/.test(lines[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
    ) {
      buf.push(lines[i].trim())
      i++
    }
    flushParagraph(buf)
  }

  return { html: html.join("\n"), headings }
}
