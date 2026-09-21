import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildUsbOutputReport,
  DUALSENSE_EDGE_PRODUCT_ID,
  DUALSENSE_PRODUCT_ID,
  DUALSENSE_VENDOR_ID,
  isDualSenseEdge,
  parseUsbInputReport,
  USB_INPUT_REPORT_LENGTH,
} from "./dualsense.js";

// Captured live from a wired DualSense (vendorId 0x054c / productId 0x0ce6,
// via node-hid) at rest, no buttons held, sticks centered, plugged in and
// charging. See CONTRIBUTING.md for how to recapture.
const IDLE_REPORT_HEX =
  "01808085770000f30800000016fb839d07000200f6fffdfd4920ea04f73136160d8019643380000000fa09090000000000c34a3616150800a1d19e485a9aaa5a";

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

test("USB and product ids match the connected wired DualSense", () => {
  assert.equal(DUALSENSE_VENDOR_ID, 0x054c);
  assert.equal(DUALSENSE_PRODUCT_ID, 0x0ce6);
});

test("parses a real idle USB input report", () => {
  const report = fromHex(IDLE_REPORT_HEX);
  assert.equal(report.length, USB_INPUT_REPORT_LENGTH);

  const state = parseUsbInputReport(report);

  assert.equal(state.dpad, "Neutral");
  assert.equal(state.leftStickX, 0);
  assert.equal(state.leftStickY, 0);
  assert.equal(state.rightStickX, 5);
  assert.equal(state.rightStickY, -9);
  assert.equal(state.leftTrigger, 0);
  assert.equal(state.rightTrigger, 0);

  for (const pressed of Object.values(state.buttons)) {
    assert.equal(pressed, false);
  }

  // Wired and drawing power: charging, battery captured mid-charge.
  assert.equal(state.battery.state, "charging");
  assert.equal(state.battery.level, 55);
});

test("isDualSenseEdge distinguishes Edge from standard product id", () => {
  assert.equal(isDualSenseEdge(DUALSENSE_EDGE_PRODUCT_ID), true);
  assert.equal(isDualSenseEdge(DUALSENSE_PRODUCT_ID), false);
});

test("Edge back buttons are undefined unless parsed with isEdge", () => {
  const report = fromHex(IDLE_REPORT_HEX);
  const standard = parseUsbInputReport(report);
  assert.equal(standard.buttons.l4, undefined);

  const edge = parseUsbInputReport(report, { isEdge: true });
  assert.equal(edge.buttons.l4, false);
  assert.equal(edge.buttons.r4, false);
  assert.equal(edge.buttons.l5, false);
  assert.equal(edge.buttons.r5, false);
});

test("rejects reports shorter than a full USB input report", () => {
  assert.throws(() => parseUsbInputReport(new Uint8Array(10)), RangeError);
});

test("rejects a report with the wrong report id", () => {
  const bad = fromHex(IDLE_REPORT_HEX);
  bad[0] = 0x09;
  assert.throws(() => parseUsbInputReport(bad), RangeError);
});

test("buildUsbOutputReport places rumble motors and report id", () => {
  const out = buildUsbOutputReport({ leftMotor: 128, rightMotor: 64 });
  assert.equal(out.length, 64);
  assert.equal(out[0], 0x02);
  assert.equal(out[3], 64);
  assert.equal(out[4], 128);
});

test("buildUsbOutputReport encodes lightbar color and player LEDs", () => {
  const out = buildUsbOutputReport({
    lightbar: { playerLeds: 2, color: { r: 10, g: 20, b: 30 } },
  });
  assert.equal(out[44], 2);
  assert.equal(out[45], 10);
  assert.equal(out[46], 20);
  assert.equal(out[47], 30);
});

test("buildUsbOutputReport encodes trigger effect mode and forces", () => {
  const out = buildUsbOutputReport({
    rightTrigger: { mode: "rigid", forces: [255, 0, 0, 0, 0, 0, 128] },
  });
  assert.equal(out[11], 0x1);
  assert.equal(out[12], 255);
  assert.equal(out[20], 128);
});
