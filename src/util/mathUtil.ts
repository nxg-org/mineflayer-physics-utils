const TWO_PI = 2 * Math.PI
export function wrapDegrees (degrees: number): number {
  const tmp = degrees % 360
  return tmp < 0 ? tmp + TWO_PI : tmp
}
