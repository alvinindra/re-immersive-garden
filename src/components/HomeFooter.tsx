import { FOOTER } from "../home/manifest"

/** The black footer section (dark relief canvas + email + address + links). */
export function HomeFooter() {
  return (
    <footer className="homeFooter">
      <a className="homeFooter__email" href={`mailto:${FOOTER.email}`}>
        {FOOTER.email}
      </a>
      <div className="homeFooter__address">
        <span>{FOOTER.studio}</span>
        {FOOTER.address.map((a) => (
          <span key={a}>{a}</span>
        ))}
      </div>
      <nav className="homeFooter__networks">
        {FOOTER.links.map((l) => (
          <a key={l.label} href={l.href} target="_blank" rel="noopener">
            {l.label}
          </a>
        ))}
      </nav>
    </footer>
  )
}
