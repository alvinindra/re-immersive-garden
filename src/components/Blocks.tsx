import { useEffect, useMemo, useRef } from "react"
import { HOME_BLOCKS, type GridItem, type HomeBlock } from "../home/manifest"
import { allocMediaId, hoverMedia, useGalleryRegistry } from "../gallery/registry"
import { setCursorLabel } from "../cursor/cursorStore"

/** The scrollable homepage blocks (showreel → projects → text), ex-dom.ts. */
export function Blocks() {
  return (
    <>
      {HOME_BLOCKS.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </>
  )
}

type MediaGridItem = Exclude<GridItem, { kind: "legend" }>

function Block({ block }: { block: HomeBlock }) {
  if (block.type === "media") {
    // standalone media row (the showreel)
    const item = block.items[0]
    return item.kind === "legend" ? null : <MediaBlock item={item} />
  }
  if (block.type === "text") {
    return <TextBlock label={block.text1 || ""} body={block.text2 || ""} />
  }
  // project block: stacked media + legend rows
  return (
    <div className="projectBlock" data-name={block.title || ""}>
      {block.items.map((item, i) =>
        item.kind === "legend" ? (
          <LegendBlock key={i} item={item} />
        ) : (
          <MediaBlock
            key={i}
            item={item}
            title={block.title}
            projectType={block.projectType}
            uri={block.uri}
          />
        ),
      )}
    </div>
  )
}

/** A centred text block (small label + larger sentence) whose words reveal — fade
 *  up with a stagger — when scrolled into view, like the real AnimatedParagraph. */
function TextBlock({ label, body }: { label: string; body: string }) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
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
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <section className="textBlock" ref={ref}>
      <div className="grid">
        <div className="textBlock__inner">
          <p className="textBlock__label">
            <Words text={label} />
          </p>
          <p className="textBlock__body">
            <Words text={body} />
          </p>
        </div>
      </div>
    </section>
  )
}

function Words({ text }: { text: string }) {
  // inline-block words collapse trailing whitespace, so spacing comes from CSS margin
  return (
    <>
      {text
        .split(/\s+/)
        .filter(Boolean)
        .map((word, i) => (
          <span key={i} className="word">
            {word}
          </span>
        ))}
    </>
  )
}

function MediaBlock({
  item,
  title,
  projectType,
  uri,
}: {
  item: MediaGridItem
  title?: string
  projectType?: string
  uri?: string
}) {
  const kind = item.kind
  const portrait = (kind === "image" || kind === "video") && !!item.portrait

  const id = useMemo(allocMediaId, [])
  const ref = useRef<HTMLDivElement>(null)
  const register = useGalleryRegistry((s) => s.register)
  const unregister = useGalleryRegistry((s) => s.unregister)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    register({ id, el, kind, src: item.src, portrait, uri: uri ?? null, title: title ?? "" })
    return () => unregister(id)
  }, [id, kind, item.src, portrait, uri, title, register, unregister])

  const onEnter = () => {
    if (kind === "glb") {
      // real site: GLB planes get the cursor label (dark, on the light paper)
      // but never tween uHover — no dim/smoke treatment
      setCursorLabel(title ? "Discover" : null, false)
      return
    }
    hoverMedia(id, true)
    ref.current?.classList.add("is-hover")
    setCursorLabel(title ? "Discover" : null, true)
  }
  const onLeave = () => {
    if (kind !== "glb") {
      hoverMedia(id, false)
      ref.current?.classList.remove("is-hover")
    }
    setCursorLabel(null)
  }
  const onClick = () => {
    if (uri) window.open("https://immersive-g.com/" + uri, "_blank")
  }

  return (
    <div className="mediaBlock">
      <div className="grid">
        <div
          ref={ref}
          className={"media" + (portrait ? " portrait" : "")}
          style={{
            gridColumn: `${item.col} / span ${item.width}`,
            aspectRatio: kind === "glb" ? "1 / 1" : portrait ? "3 / 4" : "16 / 9",
          }}
          onPointerEnter={onEnter}
          onPointerLeave={onLeave}
          onClick={onClick}
        >
          {/* hover caption at the plane's bottom-left (real site: white MSDF title +
              type, staggered in while hovered; GLB planes never get one) */}
          {title && kind !== "glb" && (
            <div className="media__caption">
              <span className="media__title">{title}</span>
              {projectType && <span className="media__type">{projectType}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function LegendBlock({ item }: { item: GridItem }) {
  if (item.kind !== "legend") return null
  return (
    <div className="mediaBlock textOnly">
      <div className="grid">
        <p
          className="legend"
          style={{ gridColumn: `${item.col} / span ${Math.max(item.width, 3)}` }}
        >
          {item.text}
        </p>
      </div>
    </div>
  )
}
