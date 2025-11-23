// lib/geometry.js
// Pure helpers for distances and metrics — easy to unit test.

/** Euclidean distance in normalized landmark space (x,y in 0..1) */
export function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/**
 * Eye Aspect Ratio (EAR)-like ratio using two vertical points and two horizontal points:
 *   EAR = (verticalDist / horizontalDist)
 * FaceMesh landmark indices (468 topology):
 *   Left eye:  vertical 159 (upper), 145 (lower), horizontal 33 (outer), 133 (inner)
 *   Right eye: vertical 386 (upper), 374 (lower), horizontal 263 (outer), 362 (inner)
 * Returns a small number when the eye is closed; larger when open.
 */
export function earFromLandmarks(landmarks, vTop, vBottom, hOuter, hInner) {
  const v = dist(landmarks[vTop], landmarks[vBottom]);
  const h = dist(landmarks[hOuter], landmarks[hInner]);
  if (h === 0) return 0;
  return v / h;
}

/**
 * Simple yaw proxy:
 *  - Compute face center from left/right cheek landmarks.
 *  - Compare nose x to that center, normalize by half the cheek span.
 * Positive -> nose right of center; Negative -> nose left of center.
 * Magnitude ~0 when centered; grows as the head turns.
 */
export function yawProxy(landmarks, leftCheekIdx = 234, rightCheekIdx = 454, noseIdx = 1) {
  const left = landmarks[leftCheekIdx];
  const right = landmarks[rightCheekIdx];
  const nose = landmarks[noseIdx];

  const centerX = (left.x + right.x) / 2;
  const halfSpan = Math.max(1e-6, Math.abs(right.x - left.x) / 2);

  // Normalized deviation of nose.x from face center, in cheek half-span units.
  const dev = (nose.x - centerX) / halfSpan;
  return dev;
}

/** Exponential Moving Average for quick smoothing (alpha ~ 0.2–0.4 works well) */
export function ema(prev, next, alpha = 0.35) {
  if (prev == null) return next;
  return prev * (1 - alpha) + next * alpha;
}
