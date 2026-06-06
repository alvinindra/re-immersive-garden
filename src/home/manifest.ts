// Home content manifest — reverse-engineered from immersive-g.com's Nuxt payload
// (window.__NUXT__.data.en_home) + the live DOM grid classes (width__N / position__N
// / portrait). The real site renders each media as a WebGL plane synced to a DOM
// placeholder inside a 13-column grid; we reuse the same layout + media verbatim:
//   - video medias  → the real .mp4 (mirrored from the site's CDN into /public/videos)
//   - image medias  → the site's own .ktx2 stills (for the few jpg slots)
//   - glb medias    → the real .glb models, rendered to a texture
//
// `col` = grid-column start (1..13), `width` = column span.

export type GridItem =
  | { kind: "video"; src: string; col: number; width: number; portrait?: boolean }
  | { kind: "image"; src: string; col: number; width: number; portrait?: boolean }
  | { kind: "glb"; src: string; col: number; width: number }
  | { kind: "legend"; text: string; col: number; width: number }

export interface HomeBlock {
  type: "project" | "media" | "text"
  title?: string
  projectType?: string
  uri?: string
  /** text block: a small label + a larger sentence, both line-revealed on scroll */
  text1?: string
  text2?: string
  items: GridItem[]
}

const V = "/videos/"
const K = "/ktx2/"
const G = "/webgl/home/glb/"

/** Showreel + 18 projects, in scroll order. Grid values + media are the real site's. */
export const HOME_BLOCKS: HomeBlock[] = [
  {
    type: "media",
    items: [
      { kind: "video", src: V + "Showreel_Short_3_f3699e2f02.mp4", col: 3, width: 8 },
    ],
  },
  {
    type: "text",
    text1: "Our approach",
    text2:
      "A global leader in groundbreaking digital design and strategy, we help forward‑thinking clients achieve impact and growth.",
    items: [],
  },
  {
    type: "project",
    title: "Louis Vuitton VIA",
    projectType: "Web Experience",
    uri: "projects/louis-vuitton-1",
    items: [
      { kind: "video", src: V + "LV_01_44142e6b4a.mp4", col: 2, width: 6 },
      { kind: "legend", text: "Explore our collaboration with Louis Vuitton on VIA, showcasing the Maison's Web 3 vision through its first digital trunk.", col: 2, width: 3 },
      { kind: "video", src: V + "LV_02_v2_ce900a9d2a.mp4", col: 8, width: 4, portrait: true },
    ],
  },
  {
    type: "project",
    title: "David Whyte Experience",
    projectType: "Web Experience",
    uri: "projects/david-whyte-experience",
    items: [
      { kind: "video", src: V + "David_Whyte_01_v2_838d74bd8d.mp4", col: 6, width: 6 },
      { kind: "legend", text: "Step into David Whyte's poetry in a digital journey, capturing life's profound moments with artistic depth.", col: 9, width: 3 },
      { kind: "video", src: V + "David_Whyte_03_9e40ec2070.mp4", col: 2, width: 4, portrait: true },
    ],
  },
  {
    type: "project",
    title: "Cartier End of Year 23",
    projectType: "E-Shop",
    uri: "projects/cartier-end-of-year-23",
    items: [
      { kind: "video", src: V + "Cartier_EOY_01_310fc52fe3.mp4", col: 3, width: 6 },
      { kind: "legend", text: "Discover Cartier's End of Year: redefining elegance with an immersive campaign, Above the Clouds.", col: 2, width: 3 },
      { kind: "video", src: V + "Cartier_EOY_02_v2_dc59d7f090.mp4", col: 8, width: 4, portrait: true },
      { kind: "glb", src: G + "CARTIER_EOY_v3_79b0f89b22.glb", col: 3, width: 3 },
    ],
  },
  {
    type: "text",
    text1: "Our mission",
    text2: "We partner with exceptional clients, helping drive their success.",
    items: [],
  },
  {
    type: "project",
    title: "Chartogne Taillet",
    projectType: "Web Experience",
    uri: "projects/chartogne-taillet-1",
    items: [
      { kind: "video", src: V + "Chartogne_01_114d7da5b8.mp4", col: 4, width: 6 },
      { kind: "legend", text: "Explore the rich heritage and vineyards of Chartogne-Taillet through immersive digital storytelling.", col: 9, width: 3 },
      { kind: "image", src: K + "medium_Chartogne_03_7476a61852.ktx2", col: 2, width: 5 },
    ],
  },
  {
    type: "project",
    title: "Cartier in Time",
    projectType: "Web Experience",
    uri: "projects/cartier-in-time",
    items: [
      { kind: "video", src: V + "Cartier_Time_01_0a3d952723.mp4", col: 3, width: 6 },
      { kind: "legend", text: "Dive into a journey with Jake Gyllenhaal, unveiling Cartier's timeless bond with time in a stunning digital showcase.", col: 2, width: 3 },
      { kind: "video", src: V + "Cartier_Time_02_v2_4ff6778abf.mp4", col: 8, width: 4, portrait: true },
    ],
  },
  {
    type: "project",
    title: "Aten7",
    projectType: "Web Experience",
    uri: "projects/aten7",
    items: [
      { kind: "video", src: V + "Aten7_01_0835552052.mp4", col: 2, width: 6 },
      { kind: "legend", text: 'Uncover the secrets of Aten7 and the rise of EVA in the immersive "Toom Archives" experience.', col: 2, width: 3 },
      { kind: "video", src: V + "Aten7_02_34d31c73cd.mp4", col: 6, width: 5 },
    ],
  },
  {
    type: "project",
    title: "Gleec",
    projectType: "Corporate",
    uri: "projects/gleec",
    items: [
      { kind: "video", src: V + "Gleec_01_3c7a042fbb.mp4", col: 2, width: 6 },
      { kind: "legend", text: "Explore the GLEEC ecosystem — a mobile-first gateway showcasing their unified crypto ecosystem through cutting-edge digital design.", col: 2, width: 3 },
      { kind: "video", src: V + "Gleec_02_v2_ceb8bfcf3c.mp4", col: 6, width: 5 },
    ],
  },
  {
    type: "project",
    title: "Dioriviera",
    projectType: "Web Experience",
    uri: "projects/dioriviera-1",
    items: [
      { kind: "video", src: V + "Dior_01_f274422e91.mp4", col: 7, width: 5 },
      { kind: "legend", text: "Step into an exquisite 3D journey through Dioriviera, where Maria Grazia Chiuri's visionary designs come to life in breathtaking detail.", col: 9, width: 3 },
      { kind: "video", src: V + "Dior_02_99b0564cb0.mp4", col: 2, width: 4, portrait: true },
    ],
  },
  {
    type: "project",
    title: "Longines Spirit Zulu Time",
    projectType: "Web Experience",
    uri: "projects/longines-zulu-time",
    items: [
      { kind: "video", src: V + "Longines_01_v2_40249484cb.mp4", col: 3, width: 6 },
      { kind: "legend", text: "Embark on the pioneering flights of Amy Johnson, Clyde Pangborn, and Hugh Herndon Jr. Discover Longines Spirit Zulu Time: honoring aviation pioneers with precision and innovation.", col: 2, width: 3 },
      { kind: "video", src: V + "Longines_02_v2_0c31a77891.mp4", col: 7, width: 5 },
    ],
  },
  {
    type: "project",
    title: "Masar Destination",
    projectType: "Web Experience",
    uri: "projects/masar-destination",
    items: [
      { kind: "video", src: V + "Masar_01_v2_96ba3b6853.mp4", col: 4, width: 6 },
      { kind: "legend", text: "Explore Masar's Vision: A captivating digital experience redefining the urban heart of Saudi Arabia.", col: 9, width: 3 },
      { kind: "image", src: K + "Masar_02_v2_48e6a8c72c.ktx2", col: 3, width: 5 },
    ],
  },
  {
    type: "project",
    title: "Midwam",
    projectType: "Corporate",
    uri: "projects/midwam",
    items: [
      { kind: "video", src: V + "Midwam_01_53916bc619.mp4", col: 5, width: 6 },
      { kind: "legend", text: "Dive deeper into Midwam's vision — an extraordinary blend of human-centric design and immersive storytelling.", col: 2, width: 3 },
      { kind: "video", src: V + "Midwam_02_62d209d0c9.mp4", col: 7, width: 5 },
    ],
  },
  {
    type: "project",
    title: "Omega Space Sustainability",
    projectType: "Corporate",
    uri: "projects/omega-space",
    items: [
      { kind: "video", src: V + "Omega_01_dc50de4e80.mp4", col: 3, width: 6 },
      { kind: "legend", text: "Discover OMEGA's Journey in Space Sustainability — Shaping Innovation and Pioneering Impact.", col: 2, width: 3 },
      { kind: "video", src: V + "Omega_02_v2_5f34880dd9.mp4", col: 8, width: 4, portrait: true },
    ],
  },
  {
    type: "project",
    title: "Orano",
    projectType: "Corporate",
    uri: "projects/orano",
    items: [
      { kind: "video", src: V + "Orano_01_V2_8c629ee69d.mp4", col: 6, width: 6 },
      { kind: "legend", text: "Navigate safely through radioactive zones with Orano's cutting-edge innovations — explore interactive wireframes and gamified design solutions.", col: 9, width: 3 },
      { kind: "video", src: V + "Orano_02_v2_d7a650dc54.mp4", col: 2, width: 5 },
    ],
  },
  {
    type: "project",
    title: "Prior Holding",
    projectType: "Web Experience",
    uri: "projects/prior-holding",
    items: [
      { kind: "video", src: V + "Prior_01_v2_7234d8cd63.mp4", col: 5, width: 6 },
      { kind: "legend", text: "Unveil the essence of authentic hospitality with Prior Holdings — an immersive experience that celebrates dreams and culture.", col: 9, width: 3 },
      { kind: "video", src: V + "Prior_02_v2_2540e4b13e.mp4", col: 3, width: 4, portrait: true },
    ],
  },
  {
    type: "project",
    title: "Artisans d'Idées",
    projectType: "Web Experience",
    uri: "projects/artisans-d-idees",
    items: [
      { kind: "video", src: V + "Artisans_d_idees_01_080f9b65c8.mp4", col: 4, width: 6 },
      { kind: "legend", text: "Step into Artisans d'Idées' digital world — an interactive journey blending art, history, and storytelling for a truly immersive experience.", col: 2, width: 3 },
      { kind: "video", src: V + "Artisans_d_idees_03_2ec8c9f5bc.mp4", col: 7, width: 5 },
    ],
  },
  {
    type: "project",
    title: "Cartier Watches and Wonders 24",
    projectType: "Web Experience",
    uri: "projects/cartier-watches-and-wonders-24",
    items: [
      { kind: "video", src: V + "Cartier_Watches_Wonders_24_01_v2_6c8ac11487.mp4", col: 2, width: 6 },
      { kind: "legend", text: "An inspiring selection of Cartier timepieces, offering a remarkable journey for Watches and Wonders 2024.", col: 9, width: 3 },
      { kind: "image", src: K + "Cartier_Watches_Wonders_24_02_v2_77cd58cd1b.ktx2", col: 7, width: 5 },
      { kind: "glb", src: G + "CARTIER_WW_24_v3_974a09cb82.glb", col: 3, width: 4 },
    ],
  },
  {
    type: "project",
    title: "Girard Perregaux Casquette",
    projectType: "E-Shop",
    uri: "projects/girard-perregaux-casquette-1",
    items: [
      { kind: "video", src: V + "GP_Casquette_01_8e555dc895.mp4", col: 3, width: 6 },
      { kind: "legend", text: "Rediscover the Limited Edition GP Casquette – Experience Modern Elegance and Timeless Heritage from Girard-Perregaux.", col: 2, width: 3 },
      { kind: "video", src: V + "GP_Casquette_02_aaf206a3ff.mp4", col: 8, width: 4, portrait: true },
    ],
  },
  {
    type: "project",
    title: "Hatom",
    projectType: "Web Experience",
    uri: "projects/hatom",
    items: [
      { kind: "video", src: V + "Hatom_01_20596dd308.mp4", col: 4, width: 6 },
      { kind: "legend", text: "Dive into the essence of cryptocurrency and explore Hatom's immersive universe — unlocking the story of their evolving crypto platform through symbolic storytelling.", col: 2, width: 3 },
      { kind: "video", src: V + "Hatom_02_c9918730ab.mp4", col: 6, width: 6 },
    ],
  },
]

export const HERO_TITLE =
  "Transcend anything seen or felt before by crafting unparalleled experiences for ambitious brands."

export const FOOTER = {
  email: "inquiries@immersive-g.com",
  studio: "Immersive Garden",
  address: ["14 avenue Claude Vellefaux", "Paris 75010"],
  links: [
    { label: "Newsletter", href: "#" },
    { label: "Instagram", href: "https://www.instagram.com/immersive_garden/" },
    { label: "LinkedIn", href: "https://www.linkedin.com/company/immersive-garden/" },
  ],
}
