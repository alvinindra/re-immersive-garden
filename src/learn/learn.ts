import { renderMarkdown, type Heading } from "./markdown"
import content from "./content.md?raw"

const contentEl = document.querySelector<HTMLElement>("#content")!
const tocEl = document.querySelector<HTMLElement>("#toc")!
const sidebar = document.querySelector<HTMLElement>("#sidebar")!
const menuToggle = document.querySelector<HTMLButtonElement>("#menuToggle")!
const toTop = document.querySelector<HTMLButtonElement>("#toTop")!

// ---- render the document ---------------------------------------------------
const { html, headings } = renderMarkdown(content)
contentEl.innerHTML = html

// ---- build the table of contents -------------------------------------------
function buildToc(items: Heading[]) {
  const frag = document.createDocumentFragment()
  for (const h of items) {
    const a = document.createElement("a")
    a.href = `#${h.id}`
    a.textContent = h.text
    a.className = `toc__link toc__link--h${h.level}`
    a.dataset.target = h.id
    frag.appendChild(a)
  }
  tocEl.appendChild(frag)
}
buildToc(headings)

// ---- add copy buttons to code blocks ---------------------------------------
for (const block of Array.from(contentEl.querySelectorAll<HTMLElement>(".code"))) {
  const btn = document.createElement("button")
  btn.className = "code__copy"
  btn.type = "button"
  btn.setAttribute("aria-label", "Copy code")
  btn.textContent = "Copy"
  btn.addEventListener("click", () => {
    const code = block.querySelector("code")?.textContent ?? ""
    navigator.clipboard?.writeText(code).then(() => {
      btn.textContent = "Copied"
      btn.classList.add("is-copied")
      setTimeout(() => {
        btn.textContent = "Copy"
        btn.classList.remove("is-copied")
      }, 1400)
    })
  })
  block.appendChild(btn)
}

// ---- scrollspy: highlight the TOC link of the section in view --------------
const links = Array.from(tocEl.querySelectorAll<HTMLAnchorElement>(".toc__link"))
const linkById = new Map(links.map((l) => [l.dataset.target!, l]))
const targets = headings
  .map((h) => document.getElementById(h.id))
  .filter((el): el is HTMLElement => el != null)

let activeId = ""
const setActive = (id: string) => {
  if (id === activeId) return
  activeId = id
  for (const l of links) l.classList.toggle("is-active", l.dataset.target === id)
  // keep the active link visible inside the scrolling sidebar
  linkById.get(id)?.scrollIntoView({ block: "nearest" })
}

const spy = new IntersectionObserver(
  (entries) => {
    // pick the topmost heading currently intersecting near the top of the viewport
    const visible = entries
      .filter((e) => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
    if (visible[0]) setActive(visible[0].target.id)
  },
  { rootMargin: "0px 0px -75% 0px", threshold: 0 },
)
for (const t of targets) spy.observe(t)

// smooth-scroll TOC clicks + close the mobile drawer
for (const l of links) {
  l.addEventListener("click", (e) => {
    const el = document.getElementById(l.dataset.target!)
    if (!el) return
    e.preventDefault()
    el.scrollIntoView({ behavior: "smooth", block: "start" })
    history.replaceState(null, "", `#${l.dataset.target}`)
    closeMenu()
  })
}

// ---- mobile drawer ----------------------------------------------------------
function openMenu() {
  sidebar.classList.add("is-open")
  menuToggle.setAttribute("aria-expanded", "true")
  document.body.classList.add("menu-open")
}
function closeMenu() {
  sidebar.classList.remove("is-open")
  menuToggle.setAttribute("aria-expanded", "false")
  document.body.classList.remove("menu-open")
}
menuToggle.addEventListener("click", () =>
  sidebar.classList.contains("is-open") ? closeMenu() : openMenu(),
)
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenu()
})

// ---- back-to-top ------------------------------------------------------------
toTop.addEventListener("click", () =>
  window.scrollTo({ top: 0, behavior: "smooth" }),
)
const onScroll = () => {
  toTop.hidden = window.scrollY < window.innerHeight
}
window.addEventListener("scroll", onScroll, { passive: true })
onScroll()

// jump to a hash target on load (after render)
if (location.hash) {
  const el = document.getElementById(location.hash.slice(1))
  if (el) requestAnimationFrame(() => el.scrollIntoView())
}
