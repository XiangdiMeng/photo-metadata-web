import assert from "node:assert/strict";
import test from "node:test";

import {
  TEMPLATES,
  extractPhotoMetadata,
  metadataFromTemplate,
  rationalToDecimalText,
  writeExifToJpeg,
} from "../app.js";

const MINIMAL_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

test("iPhone 14-17 templates are available with LensModel display workaround", () => {
  assert.ok(Object.keys(TEMPLATES).length >= 19);
  assert.equal(TEMPLATES.iphone16pro.cameraModel, "iPhone 16 Pro");
  assert.equal(TEMPLATES.iphone17promax.cameraModel, "iPhone 17 Pro Max");
  assert.match(TEMPLATES.iphone16pro.lensModel, /主相机/);
  assert.match(TEMPLATES.iphone16pro.lensModel, /\u{1D453}1\.78/u);
  assert.doesNotMatch(TEMPLATES.iphone16pro.lensModel, /F1\.78/);
});

test("writes and reads web-generated EXIF metadata", () => {
  const metadata = metadataFromTemplate("iphone16pro", "2026:06:22 12:34:56", "31.2304,121.4737");
  const output = writeExifToJpeg(MINIMAL_JPEG, metadata);
  const parsed = extractPhotoMetadata(output);

  assert.equal(parsed.cameraMake, "Apple");
  assert.equal(parsed.cameraModel, "iPhone 16 Pro");
  assert.equal(parsed.lensModel, "主相机 — 24\u00a0mm \u{1D453}1.78");
  assert.equal(parsed.captureTime, "2026:06:22 12:34:56");
  assert.equal(parsed.iso, 500);
  assert.equal(rationalToDecimalText(parsed.focalLength), "24");
  assert.equal(rationalToDecimalText(parsed.aperture), "1.78");
  assert.deepEqual(parsed.lensSpecification, [
    [24, 1],
    [24, 1],
    [89, 50],
    [89, 50],
  ]);
});
