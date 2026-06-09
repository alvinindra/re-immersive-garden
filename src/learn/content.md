# WebGL & three.js di Project Ini

Dokumen ini menjelaskan, dari nol sampai detail, bagaimana project ini memakai **WebGL** dan **three.js** untuk membangun ulang homepage [immersive-g.com](https://immersive-g.com): relief plaster yang tersingkap mengikuti kursor, jejak cairan warna-warni, galeri media yang menyatu dengan scroll, dan footer taman bunga yang bereaksi pada angin dan cahaya.

Tujuannya bukan sekadar "ini kodenya", tapi supaya kamu paham **kenapa** setiap bagian ada dan **bagaimana** GPU benar-benar menghasilkan gambar di layar. Kalau kamu baru di WebGL, baca berurutan. Kalau sudah paham dasar, langsung loncat ke bagian deep dive lewat daftar isi di kiri.

> [!NOTE]
> Istilah teknis (shader, uniform, framebuffer, dst.) sengaja dibiarkan dalam Bahasa Inggris karena itu istilah baku yang akan kamu temui di dokumentasi three.js, tutorial, dan kode project ini sendiri.

Project ini **vanilla TypeScript + Vite** — tidak ada React, tidak ada framework 3D tambahan. Hanya `three` dan `lenis` (smooth scroll). Itu disengaja: dengan sedikit lapisan abstraksi, kamu bisa melihat langsung apa yang terjadi.

---

## 1. WebGL itu apa, sebenarnya

**WebGL** adalah API JavaScript untuk menggambar grafis 2D dan 3D langsung di GPU (kartu grafis), lewat sebuah elemen `<canvas>`. Ia adalah port dari OpenGL ES ke browser. Yang penting dipahami: WebGL **tidak tahu apa-apa soal "objek 3D"**. Ia tidak punya konsep "kubus", "bola", atau "kamera". Yang ia tahu hanya:

- Cara menggambar **titik, garis, dan segitiga** dari daftar angka (koordinat).
- Cara menjalankan **program kecil di GPU** (shader) untuk menentukan posisi tiap titik dan warna tiap piksel.

Semua bentuk 3D yang rumit pada akhirnya cuma **kumpulan segitiga**. Sebuah model bunga di footer? Ribuan segitiga. Relief taman? Ribuan segitiga juga. GPU sangat cepat menggambar segitiga secara paralel — ratusan ribu sekaligus.

### Kenapa GPU, bukan CPU?

CPU mengerjakan instruksi secara berurutan (beberapa core). GPU punya ribuan core kecil yang mengerjakan hal yang sama pada banyak data sekaligus. Menggambar 1 juta piksel berarti menjalankan perhitungan warna 1 juta kali — pekerjaan yang identik dan independen, sempurna untuk diparalelkan. Itu sebabnya efek seperti relief dan fluid di project ini berjalan mulus 60fps: pekerjaan beratnya dilakukan GPU, bukan JavaScript.

### Canvas tempat semuanya digambar

Di `index.html` ada satu baris:

```html
<canvas id="webgl"></canvas>
```

Itulah seluruh permukaan gambar. Di `src/main.ts`, canvas ini diserahkan ke three.js:

```ts
const canvas = document.querySelector<HTMLCanvasElement>("#webgl")
const relief = new Relief(canvas)
```

Semua relief, galeri, dan footer digambar di **satu canvas yang sama** yang menutupi layar penuh (`position: fixed; inset: 0`). DOM (teks, judul project) discroll di atasnya.

---

## 2. Pipeline GPU & shader

Inti dari semua WebGL adalah satu alur yang disebut **rendering pipeline**. Setiap kali GPU menggambar satu objek, datanya mengalir lewat tahap-tahap ini:

```
data vertex (posisi, uv, normal)
        |
        v
[ VERTEX SHADER ]   <- program kamu: menentukan posisi tiap titik di layar
        |
        v
   rasterisasi      <- GPU mengisi segitiga jadi banyak piksel (fragment)
        |
        v
[ FRAGMENT SHADER ] <- program kamu: menentukan WARNA tiap piksel
        |
        v
   framebuffer      <- hasil akhir (layar, atau texture)
```

Dua kotak bertuliskan "shader" itu adalah kode yang **kamu** tulis dan dijalankan di GPU. Bahasanya bukan JavaScript, melainkan **GLSL** (OpenGL Shading Language) — mirip C.

### Vertex shader

Dijalankan **sekali per vertex** (titik sudut). Tugas utamanya: mengubah posisi 3D sebuah titik menjadi posisi di layar. Output wajibnya adalah variabel built-in `gl_Position`.

Contoh paling sederhana di project ini, dari `src/relief/shaders/flowmap.vert.glsl`:

```glsl
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
```

Tiga matriks itu (`projectionMatrix`, `modelViewMatrix`) mengubah koordinat dari "ruang model" ke "ruang layar" — kita bahas di bagian 3.

### Fragment shader

Dijalankan **sekali per piksel** (lebih tepatnya: per fragment) yang ditutupi segitiga. Tugasnya: menghasilkan warna akhir, lewat output `gl_FragColor` (atau output kustom di GLSL3). Di sinilah seluruh keindahan terjadi — relief, fresnel, fluid, semua logika warna ada di fragment shader.

### Tiga jenis variabel di shader

Ini konsep yang **wajib** kamu kuasai. Data masuk ke shader lewat tiga jalur:

| Jenis | Dari mana | Berubah per | Contoh di project |
|-------|-----------|-------------|-------------------|
| `attribute` | buffer geometry | per vertex | `position`, `uv`, `normal` |
| `uniform` | JavaScript (sama untuk semua vertex/piksel di satu draw) | per draw call | `uTime`, `tFlow`, `uScreenScroll` |
| `varying` | output vertex shader -> input fragment shader | diinterpolasi per piksel | `vUv`, `vNormal`, `vEye` |

Alurnya: JavaScript mengeset **uniform** (misal waktu, tekstur, posisi scroll). Vertex shader membaca **attribute** tiap titik, lalu menulis **varying**. GPU meng-**interpolasi** varying itu di seluruh permukaan segitiga, dan fragment shader menerimanya sebagai nilai yang halus per piksel.

> [!TIP]
> Konvensi penamaan di project ini: uniform diawali `u` (`uTime`, `uOpacity`), texture sampler diawali `t` (`tFlow`, `tBake1`), dan varying diawali `v` (`vUv`, `vNormal`). Ini bukan aturan WebGL, hanya gaya — tapi sangat membantu membaca kode.

### Tipe data GLSL

GLSL punya tipe vektor bawaan yang sangat nyaman untuk grafis:

| Tipe | Artinya |
|------|---------|
| `float` | satu angka desimal |
| `vec2` | 2 angka (mis. koordinat UV, posisi 2D) |
| `vec3` | 3 angka (mis. posisi XYZ, warna RGB) |
| `vec4` | 4 angka (mis. warna RGBA, posisi homogen) |
| `mat3`, `mat4` | matriks 3x3 / 4x4 (transformasi) |
| `sampler2D` | "pegangan" ke sebuah texture 2D |

Kamu bisa mengakses komponen dengan `.x .y .z .w` atau `.r .g .b .a` (sama saja), dan melakukan "swizzle": `color.rgb`, `pos.xy`, bahkan `v.yzx`. Operasi matematika otomatis berlaku per komponen: `vec3(1.0, 2.0, 3.0) * 2.0` menghasilkan `vec3(2.0, 4.0, 6.0)`.

---

## 3. Sistem koordinat: dari model ke layar

Ini sumber kebingungan terbesar pemula. Sebuah titik melewati beberapa "ruang" sebelum jadi piksel:

```
posisi model  --(modelMatrix)-->  posisi world  --(viewMatrix)-->  posisi view
   (lokal ke objek)                (lokal ke dunia)                  (relatif ke kamera)
        |
        +--(projectionMatrix)-->  clip space  --(bagi w)-->  NDC  --(viewport)-->  piksel layar
```

- **Model space** — koordinat asli mesh, relatif ke pusatnya sendiri.
- **World space** — setelah objek dipindah/diputar/diskala di dunia (`modelMatrix`).
- **View space** — dunia dilihat dari sudut pandang kamera (`viewMatrix`).
- **Clip space** — hasil proyeksi perspektif (`projectionMatrix`), masih 4D (`xyzw`).
- **NDC** (Normalized Device Coordinates) — setelah `xyz` dibagi `w`, semua jadi rentang `-1..+1`. Inilah "kubus standar" yang dilihat GPU.
- **Screen space** — NDC dipetakan ke piksel canvas.

three.js menyediakan matriks-matriks ini sebagai uniform otomatis di setiap `ShaderMaterial`, jadi kamu tinggal pakai. Baris klasik `gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0)` melakukan seluruh rantai itu sekaligus (`modelViewMatrix` = `viewMatrix * modelMatrix` yang sudah digabung three.js).

### Trik penting di project ini: posisi layar dari posisi 3D

Relief perlu tahu "di mana sebuah titik 3D muncul di layar" untuk membaca flowmap (jejak kursor) di posisi yang benar. Lihat `src/relief/shaders/relief.vert.glsl`:

```glsl
vec4 ndc = projectionMatrix * modelViewMatrix * pos;
vec2 uvScreen = (ndc.xy / ndc.w + 1.0) / 2.0;
vec4 flow = texture2D(tFlow, uvScreen);
```

Baris kedua adalah rumus baku: bagi dengan `w` untuk dapat NDC (`-1..1`), lalu `(x + 1) / 2` memetakannya ke `0..1` — persis rentang koordinat texture. Sekarang titik 3D mana pun bisa "mengintip" texture layar di posisinya sendiri. Pola ini muncul berkali-kali di project.

> [!IMPORTANT]
> UV `0..1` adalah konvensi koordinat texture: `(0,0)` di kiri-bawah, `(1,1)` di kanan-atas. Hampir semua "membaca texture" di project ini memakai koordinat 0..1, baik itu UV mesh maupun posisi layar yang sudah dinormalkan.

---

## 4. Texture, render target, dan ping-pong

### Texture

**Texture** adalah gambar (atau data apa pun) yang disimpan di GPU dan bisa "disampel" oleh shader. Di GLSL: `texture2D(sampler, uv)` mengembalikan `vec4` warna di koordinat `uv`. Project ini memakai texture untuk banyak hal: foto plaster, atlas warna bunga, noise, bahkan hasil simulasi.

### Render target (FBO)

Biasanya GPU menggambar ke layar. Tapi kamu juga bisa menyuruhnya menggambar ke sebuah **texture** alih-alih layar. Texture target itu disebut **render target** atau **framebuffer object (FBO)**. Ini fondasi semua efek multi-pass: gambar sesuatu ke texture, lalu pakai texture itu sebagai input untuk gambar berikutnya.

Di three.js:

```ts
const rt = new WebGLRenderTarget(width, height, options)
renderer.setRenderTarget(rt)   // arahkan output ke texture
renderer.render(scene, camera) // gambar ke texture, bukan layar
renderer.setRenderTarget(null) // kembali menggambar ke layar
// sekarang rt.texture bisa dipakai sebagai input shader lain
```

Galeri memakai ini untuk merender model GLB ke texture (`src/home/Gallery.ts`), dan flowmap serta fluid sim memakainya secara intensif.

### Ping-pong: cara shader "mengingat" frame sebelumnya

Sebuah shader tidak bisa membaca dan menulis texture yang sama secara bersamaan. Tapi efek seperti jejak yang memudar **butuh** frame sebelumnya: "ambil keadaan kemarin, redupkan sedikit, tambah input baru". Solusinya: **dua** render target yang bergantian peran tiap frame — satu dibaca (`read`), satu ditulis (`write`), lalu ditukar. Inilah **ping-pong**.

```ts
// pola ping-pong (disederhanakan dari src/relief/Flowmap.ts)
this.material.uniforms.tMap.value = this.read.texture  // baca yang lama
renderer.setRenderTarget(this.write)                    // tulis ke yang baru
renderer.render(this.scene, this.camera)
const tmp = this.read; this.read = this.write; this.write = tmp  // tukar
```

Tanpa ping-pong, tidak ada jejak kursor, tidak ada fluid. Ingat pola ini — ia muncul di `Flowmap.ts` dan berkali-kali di `FluidSimulation.ts`.

---

## 5. three.js: lapisan yang membuat WebGL bisa dipakai manusia

Menulis WebGL mentah itu sangat verbose: kamu harus mengelola buffer, meng-compile shader, mengatur state secara manual. **three.js** membungkus semua itu jadi objek yang masuk akal. Konsep intinya:

### Renderer, Scene, Camera

```ts
const renderer = new WebGLRenderer({ canvas, antialias: true })
const scene = new Scene()       // wadah berisi objek
const camera = new PerspectiveCamera(fov, aspect, near, far)
renderer.render(scene, camera)  // gambar scene dari sudut pandang camera
```

- **Renderer** — pembungkus konteks WebGL; yang benar-benar menggambar.
- **Scene** — graph berisi mesh, light, dll. yang ingin digambar.
- **Camera** — menentukan dari mana dan bagaimana scene dilihat.

### Perspective vs Orthographic camera

Project ini memakai **kedua** jenis, dan perbedaannya penting:

| | PerspectiveCamera | OrthographicCamera |
|---|---|---|
| Efek | objek jauh terlihat kecil (seperti mata manusia) | ukuran objek tidak berubah oleh jarak |
| Dipakai untuk | relief 3D, model footer, model GLB galeri | galeri media 2D (`Gallery.ts`), pass fullscreen (flowmap, fluid) |
| Parameter | `fov, aspect, near, far` | `left, right, top, bottom, near, far` |

Galeri memakai orthographic dengan koordinat **piksel** persis (`-w/2 .. w/2`), supaya plane WebGL bisa ditempatkan tepat di atas placeholder DOM-nya:

```ts
this.camera = new OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, -1000, 1000)
```

### Mesh = Geometry + Material

Objek yang bisa digambar selalu gabungan dua hal:

```ts
const mesh = new Mesh(geometry, material)
```

- **Geometry** — bentuknya: daftar vertex, uv, normal, index segitiga. Mis. `PlaneGeometry(1, 1, 32, 32)` di galeri (plane 1x1 dibagi 32x32 segmen supaya bisa dibengkokkan halus).
- **Material** — tampilannya: shader mana yang dipakai dan uniform apa yang diset.

### Material bawaan vs ShaderMaterial vs RawShaderMaterial

three.js punya material siap pakai (`MeshStandardMaterial`, dll.) dengan model pencahayaan PBR. Tapi untuk efek kustom, project ini menulis shader sendiri lewat:

- **`ShaderMaterial`** — kamu beri vertex + fragment shader sendiri, tapi three.js tetap menyuntikkan uniform & attribute standar (`projectionMatrix`, `position`, `uv`, dll.). Dipakai untuk relief, footer, dan galeri.
- **`RawShaderMaterial`** — tidak ada suntikan otomatis sama sekali; kamu deklarasikan semuanya. Dipakai oleh fluid sim (`src/relief/FluidSimulation.ts`) karena pass-nya sangat low-level dan butuh kontrol penuh.

Contoh dari `src/relief/Relief.ts`:

```ts
const material = new ShaderMaterial({
  glslVersion: GLSL3,
  vertexShader: reliefVert,
  fragmentShader: reliefFrag,
  side: DoubleSide,
  uniforms: { ...this.shared, tBake1: { value: tBake1 }, tBake2: { value: tBake2 } },
})
```

### Loaders: GLTF, DRACO, KTX2

Model dan texture berat dimuat lewat loader khusus:

- **GLTFLoader** — memuat format `.glb`/`.gltf` (standar model 3D di web). Relief, footer, dan model Cartier di galeri semuanya `.glb`.
- **DRACOLoader** — mendekompresi geometry yang dimampatkan dengan Draco (file `.glb` jadi jauh lebih kecil). Decoder-nya ada di `public/draco/`.
- **KTX2Loader** — memuat texture `.ktx2` (terkompresi GPU). Lebih hemat memori VRAM daripada PNG/JPG. Dipakai galeri untuk gambar project.

```ts
const draco = new DRACOLoader().setDecoderPath("/draco/")
const gltf = new GLTFLoader()
gltf.setDRACOLoader(draco)
gltf.load(url, (data) => { /* data.scene berisi mesh-nya */ })
```

### Render loop

Animasi = menggambar ulang ~60 kali per detik. Pola bakunya `requestAnimationFrame`:

```ts
const loop = (t: number) => {
  update()                 // ubah uniform, posisi, dll.
  renderer.render(scene, camera)
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)
```

`requestAnimationFrame` memberi timestamp `t` (milidetik) dan menyinkronkan dengan refresh layar. Project ini punya **satu** loop utama yang menggerakkan segalanya — dibahas di bagian berikutnya.

### Color space & device pixel ratio (DPR)

Dua hal yang sering bikin warna/ketajaman "salah":

- **Color space** — monitor menampilkan warna dalam ruang **sRGB** (non-linear), tapi perhitungan cahaya yang benar dilakukan di ruang **linear**. three.js bisa mengonversi otomatis, tapi relief project ini melakukan encoding sendiri di shader (`srgbEncodeLocal`), jadi renderer-nya diset ke `LinearSRGBColorSpace` agar tidak dikonversi dua kali.
- **DPR** — layar Retina punya 2x (atau lebih) piksel fisik per piksel CSS. `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))` membuat gambar tajam tapi membatasi di 2x supaya tidak terlalu berat.

---

## 6. Arsitektur project ini

Sekarang gambaran besarnya. Semua dijahit di `src/main.ts`. Alurnya:

```
                 pointermove                 scroll (Lenis)
                      |                            |
                      v                            v
                 [ Flowmap ]                 [ SmoothScroll ]
                 [ Fluid    ]                       |
                      |                              | {scrollY, speed, scrollPct}
                      v                              v
   ============== satu RAF loop di main.ts ====================
   scroll.raf(t)  ->  relief.update()  ->  scrollCursor.update()
                           |
        +------------------+-------------------+
        v                  v                   v
   relief (home)     footer relief        gallery overlay
   (Scene utama)     (Scene + camera       (Scene ortho,
                      sendiri)              pass kedua)
   ===========================================================
                           |
                           v
                    satu canvas WebGL
```

### main.ts: kabel utamanya

```ts
const relief = new Relief(canvas)
const scroll = new SmoothScroll()
const gallery = new Gallery(relief.renderer, setCursorLabel)
const scrollCursor = new ScrollCursor()

relief.setOverlay(gallery)  // galeri digambar sebagai pass kedua DI DALAM relief

scroll.onScroll((s) => {
  gallery.setScroll(s)
  relief.setScroll(s.scrollPct, s.speed) // pan relief + cross-fade footer
  scrollCursor.onScroll(s)
})
```

Perhatikan: galeri **berbagi renderer yang sama** dengan relief (`relief.renderer`). Tidak ada dua canvas atau dua konteks WebGL — itu boros. Sebagai gantinya, satu renderer menggambar relief dulu, lalu galeri di atasnya.

### Multi-pass dalam satu frame

Di `Relief.update()` (`src/relief/Relief.ts`), satu frame sebenarnya beberapa "pass" yang ditumpuk:

```ts
this.flowmap.update(time, 0)   // pass: tulis flowmap ke render target
this.fluid.update()            // pass: jalankan langkah-langkah fluid (banyak sub-pass)
this.renderer.render(this.scene, this.camera)  // pass: relief home ke layar

if (footerVisible) {
  this.renderer.autoClear = false
  this.renderer.clearDepth()   // bersihkan depth saja, JANGAN warna
  this.renderer.render(this.footerScene, this.footerCamera)  // footer di atas home
  this.renderer.autoClear = true
}

if (this.overlay) {
  this.overlay.update(dt)      // galeri merender model GLB ke target-nya dulu
  this.renderer.autoClear = false
  this.renderer.clearDepth()
  this.overlay.render()        // galeri ke layar, di atas semuanya
  this.renderer.autoClear = true
}
```

Kuncinya `autoClear = false` + `clearDepth()`. Normalnya `renderer.render` menghapus seluruh layar (warna + depth) sebelum menggambar. Untuk menumpuk lapisan, kita **matikan** auto-clear, dan hanya bersihkan **depth buffer** di antara lapisan supaya lapisan baru tidak salah tertutup oleh depth lapisan lama, sambil **mempertahankan warna** yang sudah ada.

> [!NOTE]
> Depth buffer adalah "peta kedalaman" — untuk tiap piksel, GPU menyimpan seberapa jauh objek terdekat, supaya objek di belakang tidak menimpa yang di depan. Membersihkannya di antara pass = "mulai uji kedalaman dari awal untuk lapisan ini".

---

## 7. Deep dive: Trail effect — jejak yang menyingkap relief

Ini efek tanda tangan situs ini: gerakkan mouse di atas bidang plaster putih yang rata, dan di sepanjang jejak kursor permukaan **tersingkap** jadi relief taman terpahat, lalu perlahan kembali rata. Bagian ini membedahnya pelan-pelan, dari intuisi sampai baris shader. File: `src/relief/Flowmap.ts` + `src/relief/shaders/flowmap.*.glsl`.

### Bukan sekadar gradient di kursor

Banyak tiruan memakai lingkaran gradient di canvas 2D yang digambar di posisi mouse. Itu tidak bisa "mengalir" atau memudar dengan arah. Project ini memakai [[flowmap|Texture GPU yang menyimpan arah dan kekuatan gerak kursor per piksel, diperbarui tiap frame; semacam "memori jejak"]] — sebuah texture yang **mengingat** jejak dan memperbaruinya tiap frame di GPU. Karena ia hidup di GPU dan punya memori, jejaknya bisa memudar halus, berarah, dan dibaca ulang oleh relief.

### Analogi: kaca berembun

Bayangkan kaca berembun. Saat kamu usap dengan jari, bagian itu jadi bening (jejak muncul). Embun perlahan kembali menutup bekas usapan (jejak memudar). Flowmap persis itu:

- Jari = kursor. Usapan = **stamp** (cap) yang ditambahkan tiap frame.
- Embun balik = **dissipation**: tiap frame nilai lama dikalikan angka kurang dari satu, jadi meredup.
- Kaca = texture yang menyimpan keadaan. Itu sebabnya jejak bisa "bertahan" sesaat lalu hilang, bukan langsung lenyap saat mouse lewat.

### Dua lapis: yang menulis jejak vs yang membacanya

Trail effect sebenarnya dua hal terpisah yang bekerja sama:

```
LAPIS 1 — FLOWMAP (menulis & mengingat jejak)
  mouse -> stamp ke texture -> dissipate -> simpan
                                              |
                                              v  (texture tFlow)
LAPIS 2 — RELIEF (membaca jejak, memahat permukaan)
  tiap vertex relief: "di posisi layarku, seberapa terang flowmap?"
        terang -> permukaan terangkat (relief muncul)
        gelap  -> permukaan tetap rata (plaster polos)
```

Lapis 1 hidup di `Flowmap.ts`. Lapis 2 hidup di vertex shader relief. Memisahkan keduanya itu kuncinya: flowmap tidak tahu apa-apa soal relief, ia cuma "kanvas jejak"; relief tinggal membacanya seperti membaca peta ketinggian.

### Konsep inti: feedback loop & ping-pong

Supaya jejak bisa memudar, frame baru harus tahu keadaan frame lama. Itu [[feedback loop|Output frame ini menjadi input frame berikutnya, sehingga efek bisa menumpuk dan memudar lintas waktu]]: hasil kemarin jadi bahan hari ini. Masalahnya, GPU **tidak boleh** membaca dan menulis satu texture yang sama sekaligus. Solusinya [[ping-pong|Dua texture bergantian peran tiap frame: satu dibaca, satu ditulis, lalu ditukar; aman untuk efek feedback di GPU]] — dua texture bergantian:

```
frame N:    baca READ  --(dissipate + stamp)-->  tulis WRITE
            lalu tukar:  READ <-> WRITE
frame N+1:  baca READ (yang tadi WRITE)  -->  tulis WRITE (yang tadi READ)
            tukar lagi ... begitu seterusnya
```

Di kode (`Flowmap.update`):

```ts
this.material.uniforms.tMap.value = this.read.texture   // input = jejak lama
renderer.setRenderTarget(this.write)                     // output = texture lain
renderer.render(this.scene, this.camera)                 // jalankan shader flowmap
const tmp = this.read; this.read = this.write; this.write = tmp  // tukar
```

### Langkah per frame, pelan-pelan

Tiap frame, shader flowmap melakukan empat hal berurutan:

1. **Baca** flowmap frame lalu di piksel ini (`texture2D(tMap, vUv)`).
2. **Redupkan** dengan dissipation (kalikan angka kurang dari satu) supaya jejak lama memudar.
3. **Cap** nilai baru di posisi kursor (arah + kecepatan gerak), dengan [[falloff|Pelemahan halus dari pusat ke tepi, jadi cap berbentuk lingkaran lembut bukan kotak keras]] melingkar supaya hanya area dekat kursor terpengaruh.
4. **Tulis** hasilnya ke texture WRITE (lalu ditukar).

Relief lalu membaca flowmap ini: di mana flowmap "terang", plaster terangkat jadi relief; di mana gelap, tetap rata.

### Render target half-float

```ts
const rtOptions = {
  type: HalfFloatType,   // bisa simpan nilai pecahan & negatif, bukan cuma 0..255
  format: RGBAFormat,
  minFilter: LinearFilter,
  ...
}
this.read = new WebGLRenderTarget(512, 512, rtOptions)
this.write = new WebGLRenderTarget(512, 512, rtOptions)
```

Kenapa `HalfFloatType`? Velocity bisa negatif dan butuh presisi; texture 8-bit biasa (`0..255`) tidak cukup. Half-float menyimpan angka desimal di GPU.

### Arti tiap channel

Flowmap menyimpan 4 angka per piksel (`rgba`):

| Channel | Isi |
|---------|-----|
| `r`, `g` | vektor velocity (arah & kecepatan kursor) |
| `b` | magnitudo velocity (seberapa cepat) |
| `a` | presence (ada/tidaknya jejak, untuk memudar) |

### Shader-nya

Dari `src/relief/shaders/flowmap.frag.glsl`:

```glsl
void main() {
  vec4 data = texture2D(tMap, vUv);          // flow frame lalu
  float friction = (1.0 / uDissipation) - 1.0;
  float dissipation = 1.0 / (1.0 + (uDeltaMult * friction));
  data *= dissipation;                        // redupkan -> jejak memudar

  vec4 stamp = getStamp(uVelocity, uMouse);   // cap baru di posisi mouse
  data += stamp * noise2 * uDeltaMult;
  gl_FragColor = data;
}
```

Dan `getStamp` membuat lingkaran halus di sekitar kursor yang kuatnya bergantung kecepatan:

```glsl
vec4 getStamp(vec2 velocity, vec2 mouse) {
  vec2 cursor = vUv - mouse;
  cursor.x *= uAspect;                        // koreksi rasio supaya bulat
  float falloff = smoothstep(uFalloff, 0.0, length(cursor));
  return vec4(velocity * 50.0, magnitude, 1.0) * falloff;
}
```

Tiga hal penting di sini:

- [[smoothstep|smoothstep(a, b, x): 0 saat x di bawah a, 1 saat x di atas b, transisi kurva-S mulus di antaranya]] membuat tepi cap melembut, bukan lingkaran bertepi keras. Inilah kenapa jejak terlihat seperti sapuan kuas, bukan stempel.
- `cursor.x *= uAspect` mengoreksi rasio aspek; tanpa ini lingkaran cap jadi lonjong di layar lebar (karena UV 0..1 tidak persegi di layar 16:9).
- `* falloff` di akhir memastikan hanya piksel dekat kursor yang dapat cap; sisanya nol.

### Dari flowmap ke relief: extrude (momen "menyingkap")

Sekarang lapis 2. Vertex shader relief (`relief.vert.glsl`) membaca flowmap di posisi layar tiap titik, lalu menaikkan ketinggiannya:

```glsl
vec2 uvScreen = (ndc.xy / ndc.w + 1.0) / 2.0;   // posisi titik ini di layar (0..1)
vec4 flow = texture2D(tFlow, uvScreen);          // baca jejak di sana
float extrude = mix(flow.b, flow.a, 0.5);        // gabung "kecepatan" + "presence"
pos.z *= mix(0.05, 1.0, extrude);                // datar (5%) -> penuh (100%)
```

Bacanya: kalau di posisi layar titik ini flowmap terang (`extrude` mendekati 1), `pos.z` dikalikan mendekati 1.0 sehingga relief muncul penuh. Kalau gelap (`extrude` mendekati 0), `pos.z` dikalikan 0.05 sehingga permukaan nyaris rata. Karena flowmap memudar, ketinggian ikut turun perlahan setelah kursor lewat — itulah "tersingkap lalu menutup lagi". Inilah [[extrude|Menaikkan ketinggian (pos.z) tiap vertex relief sesuai kecerahan flowmap; inti gerakan menyingkap]] yang jadi inti efeknya.

> [!NOTE]
> `ndc.xy / ndc.w` mengubah posisi 3D titik jadi [[NDC|Normalized Device Coordinates: koordinat -1..1 setelah proyeksi dan pembagian perspektif]], dan `(x + 1) / 2` memetakannya ke 0..1 (rentang koordinat texture). Ini cara titik 3D "mengintip" texture layar di posisinya sendiri — pola yang sama dipakai banyak efek screen-space.

### Easing & lerp: rahasia rasa "lembut"

Kalau cap mengikuti posisi mouse mentah, jejak terasa kaku dan patah. Project ini menghaluskannya dengan [[lerp|Linear interpolation: a + (b - a) × t; menggerakkan nilai sebagian jalan menuju target tiap frame]] di JavaScript sebelum dikirim ke shader (`Relief.update`):

```ts
this.pointer.update()
// 0.4 = "kejar 40% jarak ke target tiap frame" -> halus, sedikit tertinggal
this.flowmap.mouse.lerp(this.pointer.normalFlip, CONFIG.flowmap.mouseEase) // 0.4
const vmag = this.pointer.velocity.length()
this.flowmap.velocity.lerp(this.pointer.velocity, vmag ? 0.1 : 0.04)
this.flowmap.update(time, 0)
```

`lerp(target, 0.4)` artinya posisi cap bergerak 40% jarak menuju mouse tiap frame, bukan loncat penuh. Ini [[easing|Perubahan nilai yang melambat atau melembut alih-alih mendadak, memberi kesan inersia]] sederhana yang memberi kesan inersia — jejak sedikit "mengejar" kursor, persis situs aslinya (`mouseEase 0.4`).

### Sapuan otomatis saat diam

Saat kursor diam, relief tetap hidup karena ada sapuan otomatis. `updateSweep()` di `Relief.ts` menggerakkan kursor kedua (`mouse2`) di flowmap menyusuri jalur acak halus, jadi cap tetap muncul walau kamu tidak menyentuh mouse. Itu sebabnya bidang plaster tidak pernah benar-benar diam.

### Tuning: ubah satu angka, lihat efeknya

Semua "rasa" trail diatur beberapa konstanta di `CONFIG.flowmap` (`Relief.ts`). Coba ubah lalu refresh:

| Konstanta | Nilai situs | Dinaikkan | Diturunkan |
|-----------|-------------|-----------|------------|
| `dissipation` | `0.953` | jejak bertahan lebih lama | jejak cepat hilang |
| `falloff` | `0.38` | cap lebih lebar | cap lebih kecil dan tajam |
| `mouseEase` | `0.4` | cap lebih responsif (kaku) | cap lebih malas (lembut) |
| `alpha` | `1` | jejak lebih tegas | jejak lebih samar |

### Coba sendiri

Cara tercepat memahami: buka `src/relief/shaders/flowmap.frag.glsl`, ganti `data *= dissipation;` jadi `data *= 0.8;` lalu refresh — jejak akan hilang sangat cepat. Atau ubah `smoothstep(uFalloff, 0.0, ...)` jadi `step(uFalloff, ...)` untuk melihat cap bertepi keras tanpa pelembutan. Eksperimen kecil seperti ini jauh lebih melekat daripada teori.

### Catatan istilah (bagian ini)

Ringkasan istilah yang muncul di atas (arahkan kursor ke kata bergaris putus-putus untuk tooltip):

| Istilah | Arti |
|---------|------|
| **Flowmap** | Texture GPU yang menyimpan arah dan kekuatan gerak kursor per piksel; "memori jejak" yang dibaca relief. |
| **Feedback loop** | Output frame ini menjadi input frame berikutnya, sehingga efek bisa menumpuk dan memudar lintas waktu. |
| **Ping-pong** | Dua texture bergantian peran tiap frame (satu dibaca, satu ditulis, lalu ditukar) agar efek feedback aman di GPU. |
| **Dissipation** | Faktor kurang dari satu yang dikalikan ke jejak lama tiap frame, membuatnya memudar perlahan. |
| **Stamp** | "Cap" nilai baru (arah dan kecepatan kursor) yang ditambahkan ke flowmap di posisi mouse tiap frame. |
| **Falloff** | Pelemahan halus dari pusat ke tepi, membuat cap berbentuk lingkaran lembut. |
| **Velocity** | Vektor kecepatan kursor: arah dan seberapa cepat ia bergerak frame ini (channel r, g). |
| **Magnitude** | Panjang vektor velocity; satu angka "seberapa cepat" (channel b). |
| **Presence** | Penanda ada atau tidaknya jejak di sebuah titik; meluruh agar jejak hilang (channel a). |
| **Half-float** | Format angka desimal 16-bit di GPU; menyimpan pecahan dan nilai negatif, hemat memori. |
| **Extrude** | Menaikkan ketinggian (`pos.z`) vertex relief sesuai kecerahan flowmap; inti "menyingkap". |
| **Smoothstep** | Fungsi transisi kurva-S mulus antara dua ambang, dipakai melembutkan tepi cap. |
| **Lerp / easing** | Menggerakkan nilai sebagian jalan menuju target tiap frame, memberi kesan halus dan berinersia. |

---

## 8. Deep dive: Fluid simulation (jejak warna-warni)

Jejak iridescent (pelangi) yang mengikuti kursor bukan sekadar warna — itu **simulasi cairan Navier-Stokes** sungguhan yang jalan di GPU. File: `src/relief/FluidSimulation.ts`. Ini bagian paling rumit secara matematika; tujuannya di sini adalah kamu paham **alurnya**, bukan menurunkan rumusnya.

### Apa yang disimulasikan

Sebuah "dye" (zat warna) yang disuntikkan di posisi kursor, lalu mengalir mengikuti medan **velocity** (kecepatan) yang juga disuntik gerakan kursor. Hasilnya, field dye yang berputar-putar realistis. Relief membaca field ini (`tFluidFlowmap`) dan memakai channel-nya untuk warna chromatic.

### Beberapa grid (FBO)

```ts
const SIM = 128   // grid velocity/pressure (kasar, cukup)
const DYE = 512   // grid dye/warna (halus, inilah yang dibaca relief)
```

Ada beberapa render target double (ping-pong): `velocity`, `dye`, `pressure`, plus single FBO `divergence` dan `curl`. Semua `HalfFloatType` karena menyimpan nilai fisika.

### Langkah-langkah per frame

Tiap `update()`, urutan pass-nya (semua adalah fragment shader fullscreen yang menulis ke FBO):

```
1. splat        -> suntik velocity + dye di posisi kursor
2. curl         -> hitung pusaran lokal
3. vorticity    -> tambahkan gaya pusaran (bikin lebih "hidup")
4. divergence   -> ukur "ketidakseimbangan" aliran
5. clear/press. -> redupkan pressure
6. pressure     -> selesaikan tekanan (iterasi 3x)
7. gradient sub -> kurangi velocity dgn gradien tekanan (jadikan incompressible)
8. advect vel   -> alirkan velocity mengikuti dirinya sendiri
9. advect dye   -> alirkan dye mengikuti velocity  <-- ini yang dibaca relief
```

Inti Navier-Stokes incompressible: aliran tidak boleh "memampat" (kekekalan massa). Langkah 4-7 (divergence -> pressure solve -> gradient subtract) adalah **projection step** yang memaksa itu. **Advection** (8-9) adalah "bawa kuantitas ini mengikuti aliran".

### Contoh satu pass: advection

```glsl
void main () {
  vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
  gl_FragColor = dissipation * texture2D(uSource, coord);
}
```

Bacanya: "untuk piksel ini, lihat ke belakang sepanjang arah velocity (`-dt * velocity`), ambil nilai dari sana, redupkan sedikit". Ini metode **semi-Lagrangian advection** yang stabil dan murah.

### Menyuntik dari gerakan mouse

```ts
private pushSplat(px, py) {
  let dx = px - this.pointer.x
  let dy = py - this.pointer.y
  this.splats.push({
    x: px / window.innerWidth,
    y: 1 - py / window.innerHeight,   // balik Y (layar vs GL)
    dx: dx * 5, dy: dy * -5,           // velocity dari delta gerakan
  })
}
```

> [!WARNING]
> Perhatikan koordinat memakai `clientX/clientY` (viewport), **bukan** `pageX/pageY`. Relief adalah permukaan fixed selebar layar; kalau pakai pageY, dye akan tersuntik di luar layar begitu kamu scroll — bug halus yang membuat jejak warna hanya muncul di bagian atas.

---

## 9. Deep dive: Relief shader

Inilah bintang utamanya. Relief adalah model `.glb` (panel taman bertile) yang permukaannya **terangkat** mengikuti flowmap, dan **diwarnai** lewat blend rumit antara dua texture baked. File: `src/relief/shaders/relief.vert.glsl` + `relief.frag.glsl`, dikonfigurasi di `src/relief/Relief.ts`.

### Vertex: mengekstrusi permukaan

Di vertex shader, tiap titik mengintip flowmap di posisi layarnya, dan menaikkan `z`-nya sesuai kecerahan jejak:

```glsl
vec2 uvScreen = (ndc.xy / ndc.w + 1.0) / 2.0;
vec4 flow = texture2D(tFlow, uvScreen);
float extrude = mix(flow.b, flow.a, 0.5);     // gabung magnitudo + presence
pos.z *= mix(0.05, 1.0, extrude);             // 5% tinggi saat datar, 100% saat ada jejak
```

Jadi di mana tidak ada jejak, `extrude` mendekati 0 dan permukaan hampir rata (`z * 0.05`). Di mana jejak terang, `extrude` mendekati 1 dan relief muncul penuh. Itulah mekanisme "tersingkap"-nya.

### Fragment: blend 6 level dari dua texture baked

Modelnya membawa dua texture yang sudah "dipanggang" (baked): `tBake1` (base color) dan `tBake2` (emissive). Keenam channel mereka (3 + 3) adalah **6 level tinggi relief yang berbeda**. Fragment shader memilih di antaranya berdasarkan `extrude`:

```glsl
float level0 = bake2.b;  float level1 = bake2.g;  float level2 = bake2.r;
float level3 = bake1.b;  float level4 = bake1.g;  float level5 = bake1.r;

float o = 0.54504;
o = mix(o, level1, smoothstep(0.0, 0.2, extrude));
o = mix(o, level2, smoothstep(0.2, 0.4, extrude));
o = mix(o, level3, smoothstep(0.4, 0.6, extrude));
o = mix(o, level4, smoothstep(0.6, 0.8, extrude));
o = mix(o, level5, smoothstep(0.8, 1.0, extrude));
```

Rangkaian `mix` + `smoothstep` ini adalah cara membuat **gradien bertahap**: saat `extrude` naik 0 -> 1, warna berpindah halus dari level rendah ke level tinggi. Hasilnya kedalaman relief yang meyakinkan tanpa pencahayaan 3D sungguhan — semuanya sudah dipanggang ke dalam texture.

### Tint chromatic (fresnel) dari normal turunan

Tepi relief mendapat kilau warna iridescent. Karena geometri di-extrude di vertex shader, normal asli tidak akurat lagi, jadi shader menghitung normal **dari turunan layar**:

```glsl
vec3 dFdxPos = dFdx(vEye);
vec3 dFdyPos = dFdy(vEye);
vec3 normal = normalize(cross(dFdxPos, dFdyPos));
float fresnelFactor = abs(dot(normal, vec3(0.0, 0.0, 1.0)));
```

`dFdx`/`dFdy` memberi "seberapa cepat nilai berubah ke piksel tetangga" — dari situ arah permukaan (normal) bisa direkonstruksi. **Fresnel** = efek "tepi yang menghadap menyamping lebih berkilau". Dikombinasikan dengan field fluid (bagian 8), inilah sumber warna pelangi di tepi jejak.

> [!IMPORTANT]
> `dFdx`/`dFdy` tidak tersedia di GLSL ES 1.00 (default three.js). Karena itu relief dikompilasi sebagai **GLSL3** (`glslVersion: GLSL3`). Itu juga sebabnya shader mendeklarasikan output-nya sendiri (`layout(location = 0) out vec4 pc_fragColor`) — GLSL3 tidak punya `gl_FragColor` bawaan.

### Konfigurasi dari situs asli

Semua angka ajaib (dissipation 0.953, fov 30, fresnel sharpness 35, dst.) bukan tebakan — diambil verbatim dari bundle situs aslinya, terkumpul di objek `CONFIG` (`Relief.ts`) dan `src/relief/shaders/config.glsl`. Ini contoh bagus bahwa "look" sebuah efek seringkali soal **tuning konstanta**, bukan algoritma yang berbeda.

---

## 10. Deep dive: Gallery (plane media sinkron DOM)

Galeri adalah deretan media project (video/gambar/model) yang discroll. Triknya: tiap media adalah **plane WebGL** yang diposisikan **persis** di atas placeholder DOM-nya. File: `src/home/Gallery.ts` + `shaders/gallery.*.glsl`.

### Kamera ortho ruang piksel

```ts
this.camera = new OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, -1000, 1000)
```

Dengan kamera ortho yang batasnya = setengah lebar/tinggi layar dalam piksel, 1 unit dunia = 1 piksel layar. Jadi menempatkan plane tinggal menyalin posisi & ukuran rect DOM-nya.

### Sinkronisasi ke rect DOM

DOM dibangun di `src/home/dom.ts` dengan placeholder `[data-media]`. Tiap frame, galeri membaca posisi placeholder dan menyetel plane:

```ts
const cx = r.left + r.width / 2 - w / 2
const cy = -(r.top + r.height / 2) + h / 2
p.mesh.position.set(cx, cy, 0)
p.mesh.scale.set(r.width, r.height, 1)
```

> [!TIP]
> `getBoundingClientRect()` itu mahal kalau dipanggil tiap frame untuk puluhan elemen (memicu reflow). Karena itu galeri **men-cache** layout di `measureLayout()` (saat build & resize saja), lalu per frame hanya membaca `window.scrollY`. Ini salah satu optimasi performa terbesarnya.

### Cover-fit di fragment shader

Aspek texture (16:9, 3:4) jarang sama dengan aspek placeholder. Shader memetakan UV agar texture "menutup" plane tanpa gepeng (seperti CSS `object-fit: cover`):

```glsl
vec2 ratio = vec2(
  min(uPlaneAspect / uTextureAspect, 1.0),
  min(uTextureAspect / uPlaneAspect, 1.0)
);
vec2 uv = vec2(
  vUv.x * ratio.x + (1.0 - ratio.x) * 0.5,
  vUv.y * ratio.y + (1.0 - ratio.y) * 0.5
);
```

### Bengkok mengikuti kecepatan scroll

Inilah "drag curve" khas situs itu. Di `gallery.vert.glsl`, plane dibengkokkan secara kuadratik berdasarkan kecepatan scroll:

```glsl
float amount = 1.6 * uDeform * uScrollVel;
clip.y += pow(abs(clip.x), 2.0) * clip.y * amount;
clip.x += pow(abs(clip.y), 2.0) * clip.x * amount * 0.4;
```

Karena `clip.xy` makin besar di tepi, lengkungan paling kuat di tepi plane — memberi kesan elastis saat scroll cepat. Itu juga kenapa geometry plane dibagi `32x32` segmen: supaya lengkungan halus, bukan patah.

### Model GLB dirender ke texture

Beberapa slot adalah model 3D (jam Cartier). Tiap model dirender ke **render target**-nya sendiri tiap frame, lalu texture itu dipasang ke plane:

```ts
g.model.rotation.x = scrollNorm * 0.45   // miring mengikuti posisi scroll
g.model.rotation.y += dt * 0.3            // putaran idle pelan
renderer.setRenderTarget(g.rt)
renderer.render(g.root, g.camera)         // gambar model ke texture
renderer.setRenderTarget(null)
```

Supaya model metalik terlihat emas (bukan hitam), scene-nya diberi environment map dari `RoomEnvironment` via `PMREMGenerator` — environment map memberi pantulan studio yang membuat material PBR "menyala".

### Membatasi decode video

Banyak video `.mp4` decode bersamaan = lag, apalagi di Retina. Galeri hanya memutar **3 video** terdekat ke tengah viewport, sisanya di-pause:

```ts
const MAX_VIDEOS = 3
videoCandidates.sort((a, b) => a.dist - b.dist)
for (let i = 0; i < videoCandidates.length; i++) {
  if (i < MAX_VIDEOS) p.video.play()
  else p.video.pause()
}
```

---

## 11. Smooth scroll (Lenis) & integrasinya

Scroll yang "berat & meluncur" itu bukan CSS — itu **Lenis**, library smooth scroll. File: `src/scroll/SmoothScroll.ts`.

```ts
this.lenis = new Lenis({
  lerp: 0.05,                      // makin kecil makin "berat"/lambat menyusul
  easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // easing eksponensial
  orientation: "vertical",
})
```

Lenis tidak benar-benar menggeser scrollbar native; ia menginterpolasi posisi scroll dan memberi tahu kita tiap frame. Tiap event, ia memancarkan state yang dipakai seluruh sistem:

```ts
this.state.scrollY = this.lenis.scroll
this.state.velocity = this.lenis.velocity
this.state.speed = Math.abs(this.lenis.velocity / 1000) * 0.1
this.state.scrollPct = this.lenis.scroll / this.lenis.limit  // 0..1
```

`scrollPct` (0 di atas, 1 di bawah) menggerakkan banyak hal: relief mem-pan vertikal mengikuti scroll, dan footer cross-fade masuk di 10% scroll terakhir (lihat `Relief.setScroll`). Lenis digerakkan dari loop utama yang sama: `scroll.raf(t)`.

> [!NOTE]
> Satu RAF loop menggerakkan SEMUANYA — Lenis, flowmap, fluid, relief, galeri, scroll cursor. Ini penting: kalau tiap sistem punya loop sendiri, mereka bisa tidak sinkron dan boros. Satu loop = satu sumber waktu, satu titik render.

---

## 12. Deep dive: Footer relief (angin, cahaya, LUT)

Di dasar halaman, relief abu-abu cross-fade ke **taman bunga gelap** yang bereaksi pada angin dan cahaya kursor. Ini scene terpisah dengan teknik sendiri. File: `src/relief/Relief.ts` (`loadFooter`), `FooterWind.ts`, `LutLoader.ts`, `shaders/footer.*.glsl`.

### Scene & kamera sendiri

Footer punya `Scene` dan `PerspectiveCamera` terpisah (kamera diambil dari yang tertanam di file `.glb`-nya). Ia digambar sebagai pass tambahan di atas relief home dengan `clearDepth()` (lihat bagian 6).

### Angin: spring fisika di CPU

Tiap bunga bergoyang dengan kombinasi: **angin global** (fungsi noise pseudo-acak) dan **reaksi kursor** (spring fisika). Lihat `src/relief/FooterWind.ts`:

```ts
export class Spring {
  update(target: Vector3, dt: number) {
    this.delta.subVectors(target, this.x)
    this.force.add(this.delta.divideScalar(this.mass))
    this.x.add(this.force.clone().multiplyScalar(this.k * dt))
    this.force.multiplyScalar(this.damping)   // redam supaya berhenti
  }
}
```

Spring = pegas: ada `target`, `force`, `damping`, `mass`. Hasil rotasinya dikirim ke shader sebagai matriks (`uWindMatrix`, `uMouseWindMatrix`) dan diterapkan ke vertex di `footer.vert.glsl`. Massa tiap bunga dihitung dari ukurannya, jadi bunga besar bergoyang lebih lambat — sentuhan realisme.

Ada juga **delay buffer**: reaksi kursor sengaja tertunda sedikit (tiap bunga beda) supaya gelombang reaksi menjalar, bukan serentak.

### Reveal cahaya baked

Saat footer muncul, bunga "menyala" bertahap lewat tiga sapuan cahaya berarah (`FADE_1/2/3` di `footer.frag.glsl`). Tiap sapuan membandingkan normal permukaan dengan arah cahaya dan membuka progresif berdasarkan `uBakedLightIntensity` yang naik perlahan.

### Cursor light (Phong sederhana)

Kursor bertindak sebagai sumber cahaya titik. Shader menghitung diffuse + specular klasik:

```glsl
vec3 cursorDir = normalize(cursorPos - worldPos);
float attenuation = getDistanceAttenuation(length(cursorPos - worldPos), -1.0, CURSOR_DECAY);
vec3 reflection = normalize(reflect(-cursorDir, surfaceNormal));
float spec = pow(max(0.0, dot(eyeDir, reflection)), SHININESS);
```

Posisi kursor di dunia 3D didapat lewat **raycasting**: sebuah `Raycaster` menembak dari kamera lewat posisi mouse ke sebuah mesh "proxy" tak terlihat, titik tabraknya jadi posisi cahaya (`updateFooterCursor` di `Relief.ts`).

### LUT color grading

Warna akhir footer dilewatkan sebuah **LUT 3D** (lookup table warna, format `.3dl`) untuk grading sinematik. `src/relief/LutLoader.ts` mem-parse file teks `.3dl` jadi `Data3DTexture`, dan shader memetakan tiap warna lewatnya:

```glsl
vec3 uvw = vec3(halfPixelWidth) + color * (1.0 - pixelWidth);
color = texture(uLut, uvw).rgb;   // warna in -> warna ter-grade
```

Bayangkan LUT sebagai "filter Instagram" presisi tinggi: tiap kemungkinan warna RGB dipetakan ke warna keluaran yang ditentukan seniman.

---

## 13. Cheat-sheet GLSL (fungsi yang dipakai di project ini)

Fungsi-fungsi ini muncul terus di shader project. Kuasai mereka, dan 80% shader jadi terbaca.

| Fungsi | Arti | Contoh |
|--------|------|--------|
| `mix(a, b, t)` | interpolasi linear: `t=0` -> `a`, `t=1` -> `b` | `mix(0.05, 1.0, extrude)` |
| `clamp(x, lo, hi)` | batasi `x` di rentang `[lo, hi]` | `clamp(v, 0.0, 1.0)` |
| `smoothstep(a, b, x)` | seperti clamp tapi transisi halus (kurva S) di `a..b` | `smoothstep(0.0, 0.2, extrude)` |
| `step(edge, x)` | 0 kalau `x < edge`, selain itu 1 (tangga keras) | `step(c.b, c.g)` |
| `fract(x)` | bagian pecahan: `fract(3.7) = 0.7` | wrapping warna hue |
| `length(v)` | panjang vektor | `length(cursor)` jarak ke kursor |
| `normalize(v)` | jadikan panjang vektor = 1 (arah saja) | `normalize(normal)` |
| `dot(a, b)` | dot product; untuk vektor satuan = cosinus sudut | `dot(normal, lightDir)` |
| `cross(a, b)` | cross product; menghasilkan vektor tegak lurus | rekonstruksi normal |
| `reflect(i, n)` | pantulkan vektor `i` terhadap normal `n` | specular |
| `pow(x, y)` | `x` pangkat `y` | kurva fresnel `pow(f, 35.0)` |
| `texture2D(s, uv)` | sampel warna texture di `uv` | `texture2D(tFlow, uvScreen)` |
| `dFdx/dFdy(v)` | laju perubahan `v` ke piksel tetangga | rekonstruksi normal |
| `atan(y, x)` | sudut (dipakai untuk koordinat polar) | swirl noise footer |

Dua pola yang layak dihafal:

- **Remap rentang**: `c + (d - c) * ((x - a) / (b - a))` memetakan `x` dari rentang `[a,b]` ke `[c,d]`. Ada sebagai `cremap`/`remap` di shader.
- **Falloff lingkaran**: `smoothstep(radius, 0.0, length(p - center))` = 1 di pusat, melembut jadi 0 di luar radius.

---

## 14. Teknik performa di project ini

Efek "berat" ini tetap 60fps karena beberapa keputusan sadar:

- **Cache layout DOM** — `getBoundingClientRect` hanya saat build/resize, bukan tiap frame (`Gallery.measureLayout`).
- **Batasi decode video** — maksimal 3 video aktif (`MAX_VIDEOS`).
- **Cap DPR di 2** — Retina tajam tanpa render 3x+ piksel.
- **Texture terkompresi** — `.ktx2` (KTX2/Basis) hemat VRAM; `.glb` di-Draco-compress hemat ukuran unduh.
- **Grid sim kecil** — fluid pakai grid velocity 128 (kasar) tapi dye 512 (halus); hanya yang dilihat mata yang beresolusi tinggi.
- **Half-float, bukan float penuh** — render target sim cukup `HalfFloatType`, separuh memori float32.
- **Satu renderer, satu RAF loop** — tidak ada konteks/loop ganda; semua pass berbagi state.
- **Pause yang di luar layar** — plane galeri di luar viewport di-`visible = false` dan videonya di-pause.

> [!TIP]
> Pelajaran umum: performa WebGL jarang soal "shader terlalu rumit". Lebih sering soal **berapa banyak pekerjaan yang kamu lakukan per frame di JavaScript** (reflow, decode, alokasi) dan **berapa banyak piksel/texture yang diproses**. Kurangi keduanya dulu.

---

## 15. Peta file & cara menjalankan

```bash
npm install
npm run dev      # http://localhost:5173/   (homepage)
                 # http://localhost:5173/learn/  (halaman ini)
npm run build    # tsc --noEmit && vite build
```

Halaman `/learn` ini adalah entry MPA kedua di Vite (lihat `vite.config.ts`). Isinya ditulis sebagai Markdown (`src/learn/content.md`) dan dirender oleh renderer kecil tanpa dependency (`src/learn/markdown.ts`).

Struktur kode yang relevan:

| File | Tanggung jawab |
|------|----------------|
| `src/main.ts` | menjahit scroll -> relief -> galeri -> scroll cursor; satu RAF loop |
| `src/relief/Relief.ts` | scene utama, kamera, load GLB, pointer, sweep, multi-pass, fade footer |
| `src/relief/Flowmap.ts` | flowmap velocity ping-pong (jejak kursor) |
| `src/relief/FluidSimulation.ts` | simulasi Navier-Stokes (jejak warna) |
| `src/relief/FooterWind.ts` | spring angin + reaksi kursor bunga footer |
| `src/relief/LutLoader.ts` | parse `.3dl` jadi LUT 3D |
| `src/relief/shaders/*.glsl` | shader relief, flowmap, footer + `config.glsl` |
| `src/home/Gallery.ts` | plane media sinkron DOM, render GLB ke target |
| `src/home/dom.ts` + `manifest.ts` | bangun DOM scrollable + data 18 project |
| `src/home/ScrollCursor.ts` | titik kursor + streak mode fast |
| `src/scroll/SmoothScroll.ts` | pembungkus Lenis |
| `src/cursor.ts` | label kursor "Discover" |

---

## 16. Glosarium

| Istilah | Arti singkat |
|---------|--------------|
| **Shader** | program kecil yang jalan di GPU (vertex atau fragment) |
| **GLSL** | bahasa untuk menulis shader, mirip C |
| **Vertex** | satu titik sudut dari geometry |
| **Fragment** | calon piksel; output fragment shader |
| **Attribute** | data per-vertex (posisi, uv, normal) |
| **Uniform** | data konstan per draw call, diset dari JavaScript |
| **Varying** | data dari vertex -> fragment shader, diinterpolasi |
| **UV** | koordinat texture `0..1` |
| **Texture / sampler** | gambar/data di GPU yang bisa disampel shader |
| **FBO / render target** | texture yang dijadikan target gambar (bukan layar) |
| **Ping-pong** | dua FBO bergantian read/write untuk efek feedback |
| **NDC** | koordinat `-1..1` setelah proyeksi & bagi w |
| **Depth buffer** | peta kedalaman per piksel untuk uji oklusi |
| **DPR** | device pixel ratio (kerapatan piksel layar) |
| **PBR** | physically based rendering (model material realistis) |
| **Environment map** | texture lingkungan untuk pantulan/pencahayaan |
| **LUT** | lookup table warna untuk grading |
| **Fresnel** | tepi yang menghadap menyamping tampak lebih berkilau |
| **Advection** | membawa kuantitas mengikuti aliran (di fluid sim) |
| **Lerp** | linear interpolation, `a + (b-a)*t` |

---

## 17. Bacaan lanjutan

Untuk memperdalam, sumber-sumber ini paling berguna dan relevan dengan teknik di sini:

- [Dokumentasi resmi three.js](https://threejs.org/docs/) — referensi tiap kelas.
- [three.js manual / fundamentals](https://threejs.org/manual/) — tutorial konsep dari dasar.
- [The Book of Shaders](https://thebookofshaders.com/) — belajar GLSL fragment shader dari nol; `mix`, `smoothstep`, noise dijelaskan visual.
- [WebGL Fundamentals](https://webglfundamentals.org/) — kalau ingin paham WebGL mentah di balik three.js.
- [GPU Gems: Fast Fluid Dynamics (Bab 38)](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu) — dasar simulasi fluid di GPU yang dipakai di bagian 8.
- README project ini — catatan reverse-engineering spesifik situs aslinya.

> [!NOTE]
> Cara belajar terbaik: buka satu file shader (mulai dari `flowmap.frag.glsl`, yang paling pendek), ubah satu angka, refresh, lihat apa yang berubah. Eksperimen langsung jauh lebih cepat melekat daripada membaca teori.
