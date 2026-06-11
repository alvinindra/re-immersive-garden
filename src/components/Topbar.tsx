export function Topbar() {
  return (
    <header className="topbar">
      <a className="topbar__about" href="/learn/">
        Learn
      </a>
      <a
        className="topbar__about"
        href="https://immersive-g.com/the-studio"
        target="_blank"
        rel="noopener"
      >
        About
      </a>
      <span className="topbar__monogram" aria-hidden="true">
        IG
      </span>
    </header>
  )
}
