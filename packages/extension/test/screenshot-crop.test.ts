import assert from "node:assert/strict";
import test from "node:test";
import { calculateScreenshotCrop } from "../src/screenshot-crop.js";

test("crop coordinates scale from CSS viewport pixels to screenshot pixels", () => {
  const crop = calculateScreenshotCrop({
    rect: { x: 100, y: 50, width: 200, height: 100 },
    viewportWidth: 1000,
    viewportHeight: 500,
  }, 2000, 1000);

  assert.deepEqual(crop.source, { x: 200, y: 100, width: 400, height: 200 });
  assert.equal(crop.scaleX, 2);
  assert.equal(crop.scaleY, 2);
});

test("crop coordinates clamp a partially visible element to the viewport", () => {
  const crop = calculateScreenshotCrop({
    rect: { x: -25, y: 450, width: 100, height: 100 },
    viewportWidth: 1000,
    viewportHeight: 500,
  }, 1500, 750);

  assert.deepEqual(crop.visibleCssRect, { x: 0, y: 450, width: 75, height: 50 });
  assert.deepEqual(crop.source, { x: 0, y: 675, width: 113, height: 75 });
});

test("crop coordinates support independent horizontal and vertical scaling", () => {
  const crop = calculateScreenshotCrop({
    rect: { x: 10, y: 10, width: 20, height: 20 },
    viewportWidth: 100,
    viewportHeight: 100,
  }, 200, 300);

  assert.deepEqual(crop.source, { x: 20, y: 30, width: 40, height: 60 });
  assert.equal(crop.scaleX, 2);
  assert.equal(crop.scaleY, 3);
});

test("crop coordinates reject elements outside the visible viewport", () => {
  assert.throws(() => calculateScreenshotCrop({
    rect: { x: 120, y: 10, width: 20, height: 20 },
    viewportWidth: 100,
    viewportHeight: 100,
  }, 200, 200), /outside the visible viewport/u);
});
