#!/usr/bin/env bash
# Download the real immersive-g.com project videos into public/videos/.
# These mirror the site's own CDN media (referenced by src/home/manifest.ts) and are
# git-ignored to keep history light — run this once after cloning.
set -euo pipefail
BASE="https://ig-medias-prod.ams3.digitaloceanspaces.com"
DIR="$(cd "$(dirname "$0")/.." && pwd)/public/videos"
mkdir -p "$DIR"; cd "$DIR"
FILES=(
  Showreel_Short_3_f3699e2f02.mp4
  LV_01_44142e6b4a.mp4 LV_02_v2_ce900a9d2a.mp4
  David_Whyte_01_v2_838d74bd8d.mp4 David_Whyte_03_9e40ec2070.mp4
  Cartier_EOY_01_310fc52fe3.mp4 Cartier_EOY_02_v2_dc59d7f090.mp4
  Chartogne_01_114d7da5b8.mp4
  Cartier_Time_01_0a3d952723.mp4 Cartier_Time_02_v2_4ff6778abf.mp4
  Aten7_01_0835552052.mp4 Aten7_02_34d31c73cd.mp4
  Gleec_01_3c7a042fbb.mp4 Gleec_02_v2_ceb8bfcf3c.mp4
  Dior_01_f274422e91.mp4 Dior_02_99b0564cb0.mp4
  Longines_01_v2_40249484cb.mp4 Longines_02_v2_0c31a77891.mp4
  Masar_01_v2_96ba3b6853.mp4
  Midwam_01_53916bc619.mp4 Midwam_02_62d209d0c9.mp4
  Omega_01_dc50de4e80.mp4 Omega_02_v2_5f34880dd9.mp4
  Orano_01_V2_8c629ee69d.mp4 Orano_02_v2_d7a650dc54.mp4
  Prior_01_v2_7234d8cd63.mp4 Prior_02_v2_2540e4b13e.mp4
  Artisans_d_idees_01_080f9b65c8.mp4 Artisans_d_idees_03_2ec8c9f5bc.mp4
  Cartier_Watches_Wonders_24_01_v2_6c8ac11487.mp4
  GP_Casquette_01_8e555dc895.mp4 GP_Casquette_02_aaf206a3ff.mp4
  Hatom_01_20596dd308.mp4 Hatom_02_c9918730ab.mp4
)
printf '%s\n' "${FILES[@]}" | xargs -P 8 -I{} curl -s -o {} "$BASE/{}"
echo "Done: $(ls -1 ./*.mp4 | wc -l) videos in $DIR"
