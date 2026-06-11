import { HOME_BLOCKS, FOOTER, type GridItem } from "./manifest"

/** Build the scrollable homepage DOM (hero → project blocks → footer) into `root`.
 *  Each image item gets a `[data-media]` placeholder that the WebGL Gallery binds to. */
export function buildHomeDom(root: HTMLElement) {
  const frag = document.createDocumentFragment()

  // ---- project / media / text blocks ----------------------------------------
  for (const block of HOME_BLOCKS) {
    if (block.type === "media") {
      // standalone media row (the showreel)
      frag.appendChild(mediaBlock(block.items[0]))
      continue
    }
    if (block.type === "text") {
      frag.appendChild(textBlock(block.text1 || "", block.text2 || ""))
      continue
    }

    // project block: stacked media + legend rows
    const proj = document.createElement("div")
    proj.className = "projectBlock"
    proj.setAttribute("data-name", block.title || "")
    for (const item of block.items) {
      proj.appendChild(
        item.kind === "legend"
          ? legendBlock(item)
          : mediaBlock(item, block.title, block.projectType, block.uri),
      )
    }
    frag.appendChild(proj)
  }

  root.appendChild(frag)
  initTextReveal(root)
}

/** A centred text block (small label + larger sentence) whose words reveal — fade
 *  up with a stagger — when scrolled into view, like the real AnimatedParagraph. */
function textBlock(label: string, body: string): HTMLElement {
  const sec = document.createElement("section")
  sec.className = "textBlock"
  const grid = document.createElement("div")
  grid.className = "grid"
  const inner = document.createElement("div")
  inner.className = "textBlock__inner"
  const l = document.createElement("p")
  l.className = "textBlock__label"
  splitWords(label).forEach((w) => l.appendChild(w))
  const b = document.createElement("p")
  b.className = "textBlock__body"
  splitWords(body).forEach((w) => b.appendChild(w))
  inner.append(l, b)
  grid.appendChild(inner)
  sec.appendChild(grid)
  return sec
}

function splitWords(text: string): HTMLElement[] {
  // inline-block words collapse trailing whitespace, so spacing comes from CSS margin
  return text.split(/\s+/).filter(Boolean).map((word) => {
    const span = document.createElement("span")
    span.className = "word"
    span.textContent = word
    return span
  })
}

/** Reveal each text block's words (staggered) the first time it scrolls into view. */
function initTextReveal(root: HTMLElement) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        const words = e.target.querySelectorAll<HTMLElement>(".word")
        words.forEach((w, i) => (w.style.transitionDelay = `${i * 0.045}s`))
        e.target.classList.add("is-in")
        io.unobserve(e.target)
      }
    },
    { threshold: 0.35 },
  )
  root.querySelectorAll(".textBlock").forEach((el) => io.observe(el))
}

function mediaBlock(
  item: GridItem,
  title?: string,
  type?: string,
  uri?: string,
): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "mediaBlock"

  const grid = document.createElement("div")
  grid.className = "grid"

  const portrait = (item.kind === "image" || item.kind === "video") && item.portrait
  const media = document.createElement("div")
  media.className = "media" + (portrait ? " portrait" : "")
  if (item.kind !== "legend") {
    media.style.gridColumn = `${item.col} / span ${item.width}`
    media.style.aspectRatio = item.kind === "glb" ? "1 / 1" : portrait ? "3 / 4" : "16 / 9"
    media.setAttribute("data-media", item.src)
    media.setAttribute("data-kind", item.kind)
    if (portrait) media.setAttribute("data-portrait", "")
    if (uri) media.setAttribute("data-uri", uri)
    if (title) media.setAttribute("data-title", title)
  }
  // hover caption at the plane's bottom-left (real site: white MSDF title + type,
  // staggered in while hovered; GLB planes never get one)
  if (title && item.kind !== "legend" && item.kind !== "glb") {
    const cap = document.createElement("div")
    cap.className = "media__caption"
    cap.innerHTML =
      `<span class="media__title">${title}</span>` +
      (type ? `<span class="media__type">${type}</span>` : "")
    media.appendChild(cap)
  }
  grid.appendChild(media)

  wrap.appendChild(grid)
  return wrap
}

function legendBlock(item: GridItem): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "mediaBlock textOnly"
  const grid = document.createElement("div")
  grid.className = "grid"
  const p = document.createElement("p")
  p.className = "legend"
  p.style.gridColumn = `${item.col} / span ${Math.max(item.width, 3)}`
  if (item.kind === "legend") p.textContent = item.text
  grid.appendChild(p)
  wrap.appendChild(grid)
  return wrap
}

/** Build the black footer section (dark relief canvas + email + address + links). */
export function buildFooter(root: HTMLElement) {
  const footer = document.createElement("footer")
  footer.className = "homeFooter"
  footer.innerHTML = `
    <a class="homeFooter__email" href="mailto:${FOOTER.email}">${FOOTER.email}</a>
    <div class="homeFooter__address">
      <span>${FOOTER.studio}</span>
      ${FOOTER.address.map((a) => `<span>${a}</span>`).join("")}
    </div>
    <nav class="homeFooter__networks">
      ${FOOTER.links
        .map((l) => `<a href="${l.href}" target="_blank" rel="noopener">${l.label}</a>`)
        .join("")}
    </nav>
  `
  root.appendChild(footer)
}
