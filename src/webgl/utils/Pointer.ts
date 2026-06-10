import { Vector2 } from "three"

/** 
 * A pointer that tracks its eased normalized position and per-frame velocity.
 * UV space, Y up.
 */
export class Pointer {
  normalFlip = new Vector2(-1, -1)
  velocity = new Vector2()
  private last = new Vector2(-1, -1)
  private has = false

  set(x: number, y: number) {
    this.normalFlip.set(x, y)
    if (!this.has) {
      this.last.copy(this.normalFlip)
      this.has = true
    }
  }

  update() {
    this.velocity.subVectors(this.normalFlip, this.last)
    this.last.copy(this.normalFlip)
  }
}
