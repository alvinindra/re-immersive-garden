import { Relief } from "./relief/Relief";

const canvas = document.querySelector<HTMLCanvasElement>("#webgl");
if (!canvas) throw new Error("missing #webgl canvas");

const relief = new Relief(canvas);
relief
  .load("/relief.glb")
  .then(() => {
    relief.start();
  })
  .catch((err) => {
    console.error("relief load failed", err);
  });
