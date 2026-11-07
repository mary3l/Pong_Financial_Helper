// Which part of the camera frame to decode: a strip across the middle of
// what's actually on screen, around the yellow guide box. The <video> uses
// object-fit: cover, so the visible area is a centred crop of the frame.

export type Rect = { x: number; y: number; width: number; height: number };

/**
 * @param frameW, frameH  the camera frame size (video.videoWidth/Height)
 * @param viewW, viewH    the <video> element's size on screen, CSS px
 * @param stripH          how tall a strip to read, CSS px
 * @param maxW            cap on the output width, so slow phones stay quick
 * @returns the source rect in frame pixels and the output size to draw it at
 */
export function scanStrip(frameW: number, frameH: number, viewW: number, viewH: number, stripH: number, maxW = 1280) {
  const scale = Math.max(viewW / frameW, viewH / frameH);
  const visibleW = viewW / scale;
  const visibleH = viewH / scale;
  const width = Math.round(visibleW * 0.94);
  const height = Math.round(Math.min(visibleH, stripH / scale));
  const source: Rect = {
    x: Math.round((frameW - width) / 2),
    y: Math.round((frameH - height) / 2),
    width,
    height,
  };
  const shrink = Math.min(1, maxW / width);
  return { source, outW: Math.round(width * shrink), outH: Math.round(height * shrink) };
}
