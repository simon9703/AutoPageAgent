import assert from "node:assert/strict";
import test from "node:test";
import type { PageElementSnapshot, PageSnapshot } from "@auto-page-agent/shared";
import {
  attachViewportScreenshot,
  canCaptureAutomaticScreenshot,
  shouldCaptureInitialVisualContext,
} from "../src/background/visual-recovery.js";

const snapshot: PageSnapshot = {
  snapshotId: "snapshot-1",
  url: "https://example.com/editor",
  title: "Editor",
  language: "en",
  selectedText: "",
  headings: [],
  mainText: "Visual editor",
  simplifiedDom: "",
  pageInfo: {
    viewportWidth: 1_000,
    viewportHeight: 800,
    pageWidth: 1_000,
    pageHeight: 800,
    scrollX: 0,
    scrollY: 0,
    pixelsAbove: 0,
    pixelsBelow: 0,
  },
  visualSignals: { imageCount: 0, largeImageCount: 0, canvasCount: 0, videoCount: 0 },
  elements: [],
  capturedAt: "2026-07-28T00:00:00.000Z",
  domVersion: 1,
};

test("ordinary semantic pages stay DOM-only", () => {
  assert.equal(shouldCaptureInitialVisualContext({
    ...snapshot,
    mainText: "A complete semantic page ".repeat(30),
  }), false);
});

test("canvas, video, and sparse large-image pages request visual context", () => {
  assert.equal(shouldCaptureInitialVisualContext({
    ...snapshot,
    visualSignals: { ...snapshot.visualSignals!, canvasCount: 1 },
  }), true);
  assert.equal(shouldCaptureInitialVisualContext({
    ...snapshot,
    visualSignals: { ...snapshot.visualSignals!, videoCount: 1 },
  }), true);
  assert.equal(shouldCaptureInitialVisualContext({
    ...snapshot,
    visualSignals: { ...snapshot.visualSignals!, imageCount: 1, largeImageCount: 1 },
  }), true);
});

test("automatic capture skips existing visual context and sensitive pages", () => {
  const screenshot = attachViewportScreenshot(snapshot, {
    dataUrl: "data:image/jpeg;base64,AA==",
  });
  assert.equal(canCaptureAutomaticScreenshot(screenshot), false);

  const sensitive: PageElementSnapshot = {
    ref: "password",
    tagName: "input",
    role: "textbox",
    label: "Password",
    text: "",
    selector: "input",
    inputType: "password",
    disabled: false,
    sensitive: true,
    contentEditable: false,
    fingerprint: "password",
    inViewport: true,
    occluded: false,
    readonly: false,
    viewportRect: { x: 0, y: 0, width: 100, height: 30 },
  };
  assert.equal(canCaptureAutomaticScreenshot({ ...snapshot, elements: [sensitive] }), false);
});
