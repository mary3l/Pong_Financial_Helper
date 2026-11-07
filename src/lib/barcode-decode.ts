import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatOneDReader,
  RGBLuminanceSource,
} from "@zxing/library";

// The barcode reader for browsers without a built-in BarcodeDetector
// (iPhone Safari). Grocery barcodes only, and every row of the image is
// tried, not just a few near the middle: shelf-tag bars are short.

const HINTS = new Map<DecodeHintType, unknown>([
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.ITF,
    ],
  ],
  [DecodeHintType.TRY_HARDER, true],
]);

const reader = new MultiFormatOneDReader(HINTS);

/** Greyscale from canvas RGBA, weighted towards green like zxing does. */
export function luminance(rgba: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const lum = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) lum[i] = (rgba[p] + 2 * rgba[p + 1] + rgba[p + 2]) >> 2;
  return lum;
}

/** The barcode's digits, or null if nothing readable is in the image. */
export function decodeLuminance(lum: Uint8ClampedArray, width: number, height: number): string | null {
  try {
    return reader.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, width, height))), HINTS).getText();
  } catch {
    return null;
  }
}
