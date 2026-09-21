/**
 * Sony DualSense (PS5 controller) USB HID protocol.
 *
 * Byte offsets verified two ways: against the DualSense USB input report
 * captured live from a connected controller (see src/sony/dualsense.test.ts
 * fixtures), and cross-checked with the community reversing docs at
 * https://github.com/nondebug/dualsense and https://github.com/flok/pydualsense.
 * Bluetooth is not implemented here (its report carries one extra leading
 * byte plus a CRC32 trailer and hasn't been hardware-verified).
 */

export const DUALSENSE_VENDOR_ID = 0x054c;
export const DUALSENSE_PRODUCT_ID = 0x0ce6;
export const DUALSENSE_EDGE_PRODUCT_ID = 0x0df2;

export const USB_INPUT_REPORT_ID = 0x01;
export const USB_OUTPUT_REPORT_ID = 0x02;
export const USB_INPUT_REPORT_LENGTH = 64;
export const USB_OUTPUT_REPORT_LENGTH = 64;

export type DpadDirection =
  | "N"
  | "NE"
  | "E"
  | "SE"
  | "S"
  | "SW"
  | "W"
  | "NW"
  | "Neutral";

const DPAD_DIRECTIONS: readonly DpadDirection[] = [
  "N",
  "NE",
  "E",
  "SE",
  "S",
  "SW",
  "W",
  "NW",
  "Neutral",
];

export type DualSenseBatteryState =
  | "discharging"
  | "charging"
  | "full"
  | "notCharging"
  | "outOfRange"
  | "error"
  | "unknown";

const BATTERY_STATES: Record<number, DualSenseBatteryState> = {
  0x0: "discharging",
  0x1: "charging",
  0x2: "full",
  0xa: "outOfRange",
  0xb: "notCharging",
  0xf: "error",
};

export interface DualSenseButtons {
  square: boolean;
  cross: boolean;
  circle: boolean;
  triangle: boolean;
  l1: boolean;
  r1: boolean;
  l2: boolean;
  r2: boolean;
  create: boolean;
  options: boolean;
  l3: boolean;
  r3: boolean;
  ps: boolean;
  touchpad: boolean;
  mute: boolean;
}

export interface DualSenseTouchPoint {
  active: boolean;
  id: number;
  x: number;
  y: number;
}

export interface DualSenseBattery {
  state: DualSenseBatteryState;
  /** 0-100, quantized to 10% steps by the controller's own firmware. */
  level: number;
}

export interface DualSenseState {
  /** -128..127, center ~0. */
  leftStickX: number;
  leftStickY: number;
  rightStickX: number;
  rightStickY: number;
  /** 0..255 analog pull. */
  leftTrigger: number;
  rightTrigger: number;
  dpad: DpadDirection;
  buttons: DualSenseButtons;
  gyro: { x: number; y: number; z: number };
  accel: { x: number; y: number; z: number };
  touch: [DualSenseTouchPoint, DualSenseTouchPoint];
  battery: DualSenseBattery;
}

function int16le(data: Uint8Array, offset: number): number {
  return (data[offset] | (data[offset + 1] << 8)) << 16 >> 16;
}

/**
 * Parses a 64-byte DualSense USB input report (report id 0x01, including the
 * leading report-id byte) into a structured state snapshot.
 */
export function parseUsbInputReport(data: Uint8Array): DualSenseState {
  if (data.length < USB_INPUT_REPORT_LENGTH) {
    throw new RangeError(
      `DualSense USB input report must be ${USB_INPUT_REPORT_LENGTH} bytes, got ${data.length}`
    );
  }
  if (data[0] !== USB_INPUT_REPORT_ID) {
    throw new RangeError(
      `Expected DualSense USB input report id 0x${USB_INPUT_REPORT_ID.toString(16)}, got 0x${data[0].toString(16)}`
    );
  }

  const buttonByte = data[8];
  const misc = data[9];
  const misc2 = data[10];

  const buttons: DualSenseButtons = {
    square: (buttonByte & 0x10) !== 0,
    cross: (buttonByte & 0x20) !== 0,
    circle: (buttonByte & 0x40) !== 0,
    triangle: (buttonByte & 0x80) !== 0,
    l1: (misc & 0x01) !== 0,
    r1: (misc & 0x02) !== 0,
    l2: (misc & 0x04) !== 0,
    r2: (misc & 0x08) !== 0,
    create: (misc & 0x10) !== 0,
    options: (misc & 0x20) !== 0,
    l3: (misc & 0x40) !== 0,
    r3: (misc & 0x80) !== 0,
    ps: (misc2 & 0x01) !== 0,
    touchpad: (misc2 & 0x02) !== 0,
    mute: (misc2 & 0x04) !== 0,
  };

  const dpad = DPAD_DIRECTIONS[buttonByte & 0x0f] ?? "Neutral";

  const batteryByte = data[53];
  const battery: DualSenseBattery = {
    state: BATTERY_STATES[(batteryByte & 0xf0) >> 4] ?? "unknown",
    level: Math.min((batteryByte & 0x0f) * 10 + 5, 100),
  };

  const touch = (base: number): DualSenseTouchPoint => ({
    active: (data[base] & 0x80) === 0,
    id: data[base] & 0x7f,
    x: ((data[base + 2] & 0x0f) << 8) | data[base + 1],
    y: (data[base + 3] << 4) | ((data[base + 2] & 0xf0) >> 4),
  });

  return {
    leftStickX: data[1] - 128,
    leftStickY: data[2] - 128,
    rightStickX: data[3] - 128,
    rightStickY: data[4] - 128,
    leftTrigger: data[5],
    rightTrigger: data[6],
    dpad,
    buttons,
    gyro: {
      x: int16le(data, 16),
      y: int16le(data, 18),
      z: int16le(data, 20),
    },
    accel: {
      x: int16le(data, 22),
      y: int16le(data, 24),
      z: int16le(data, 26),
    },
    touch: [touch(33), touch(37)],
    battery,
  };
}

export type DualSenseTriggerMode =
  | "off"
  | "rigid"
  | "pulse"
  | "rigidA"
  | "rigidB"
  | "rigidAB"
  | "pulseA"
  | "pulseB"
  | "pulseAB"
  | "calibration";

const TRIGGER_MODE_VALUES: Record<DualSenseTriggerMode, number> = {
  off: 0x0,
  rigid: 0x1,
  pulse: 0x2,
  rigidA: 0x1 | 0x20,
  rigidB: 0x1 | 0x04,
  rigidAB: 0x1 | 0x20 | 0x04,
  pulseA: 0x2 | 0x20,
  pulseB: 0x2 | 0x04,
  pulseAB: 0x2 | 0x20 | 0x04,
  calibration: 0xfc,
};

export interface DualSenseTriggerEffect {
  mode: DualSenseTriggerMode;
  /** Up to 7 force parameters, meaning depends on mode; 0-255 each. */
  forces?: readonly number[];
}

export type DualSensePulseOption = "off" | "fadeBlue" | "fadeOut";

export interface DualSenseLightbar {
  /** 0-4; DualSense maps 1-4 to player LEDs, 0 clears them. */
  playerLeds: 0 | 1 | 2 | 3 | 4;
  pulse?: DualSensePulseOption;
  brightness?: "high" | "medium" | "low";
  color: { r: number; g: number; b: number };
}

export interface DualSenseOutputState {
  /** 0-255 high-frequency (right) motor. */
  rightMotor?: number;
  /** 0-255 low-frequency (left) motor. */
  leftMotor?: number;
  leftTrigger?: DualSenseTriggerEffect;
  rightTrigger?: DualSenseTriggerEffect;
  lightbar?: DualSenseLightbar;
  micLed?: boolean;
}

const PULSE_OPTION_VALUES: Record<DualSensePulseOption, number> = {
  off: 0x0,
  fadeBlue: 0x1,
  fadeOut: 0x2,
};

const BRIGHTNESS_VALUES: Record<NonNullable<DualSenseLightbar["brightness"]>, number> = {
  high: 0x0,
  medium: 0x1,
  low: 0x2,
};

function writeTriggerEffect(
  out: Uint8Array,
  offset: number,
  effect: DualSenseTriggerEffect | undefined
): void {
  if (!effect) return;
  out[offset] = TRIGGER_MODE_VALUES[effect.mode];
  const forces = effect.forces ?? [];
  // Force bytes are non-contiguous in the wire format (offsets 20 and 31 are
  // skipped for audio/reserved fields), matching pydualsense's layout.
  const forceOffsets = [1, 2, 3, 4, 5, 6, 9];
  for (let i = 0; i < forceOffsets.length; i++) {
    out[offset + forceOffsets[i]] = forces[i] ?? 0;
  }
}

/**
 * Builds a 64-byte DualSense USB output report (report id 0x02) setting
 * rumble motors, trigger effects, and the lightbar/player-LEDs in one shot.
 */
export function buildUsbOutputReport(state: DualSenseOutputState): Uint8Array {
  const out = new Uint8Array(USB_OUTPUT_REPORT_LENGTH);
  out[0] = USB_OUTPUT_REPORT_ID;

  // Enable-flag bytes: which fields this packet actually applies.
  out[1] = 0x01 | 0x02 | 0x04 | 0x08 | 0x10 | 0x40;
  out[2] = 0x01 | 0x02 | 0x04 | 0x10 | 0x40;

  out[3] = state.rightMotor ?? 0;
  out[4] = state.leftMotor ?? 0;

  out[9] = state.micLed ? 0x01 : 0x00;

  writeTriggerEffect(out, 11, state.rightTrigger);
  writeTriggerEffect(out, 22, state.leftTrigger);

  if (state.lightbar) {
    out[39] = state.lightbar.playerLeds > 0 ? 0x01 | 0x02 : 0x00;
    out[42] = PULSE_OPTION_VALUES[state.lightbar.pulse ?? "off"];
    out[43] = BRIGHTNESS_VALUES[state.lightbar.brightness ?? "high"];
    out[44] = state.lightbar.playerLeds;
    out[45] = state.lightbar.color.r;
    out[46] = state.lightbar.color.g;
    out[47] = state.lightbar.color.b;
  }

  return out;
}
