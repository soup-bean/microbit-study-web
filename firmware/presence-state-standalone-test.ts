// micro:bit V2 / MakeCode JavaScript: HC-SR04 + HC-SR501 presence-state test.
// TEST ONLY: No RTC, FlashStorage, Bluetooth, or automatic study-time accumulation.
//
// HC-SR04: VCC=5V, TRIG=P1, ECHO=10k/10k/10k divider into P2, GND=GND
// HC-SR501: VCC=5V, OUT=P8, GND=GND
// IMPORTANT: never feed the HC-SR04 5V ECHO directly into P2.
//
// PIR sampled once every ~3 seconds. Ultrasound sampled 0.2 seconds later.
// 3 consecutive PIR zeros AND 3 consecutive out-of-range distances -> AWAY.
// PIR zero x3 by itself does NOT mean AWAY if distance remains 10..60cm.
// Start-up 60s: don't declare AWAY while PIR stabilizes.
// A: current state + streak counts; B: distance, PIR, raw echo microseconds.

const MIN_CM = 10
const MAX_CM = 60
const STREAK_LIMIT = 3
const PIR_WARMUP_MS = 60000

let distanceCm = -1
let echoUs = 0
let pirValue = 0
let pirZeroStreak = 0
let distanceMissStreak = 0
let userState = "WAIT"
let bootMs = input.runningTime()

pins.digitalWritePin(DigitalPin.P1, 0)
pins.setPull(DigitalPin.P8, PinPullMode.PullDown)

function measureDistance() {
    pins.digitalWritePin(DigitalPin.P1, 0)
    control.waitMicros(2)
    pins.digitalWritePin(DigitalPin.P1, 1)
    control.waitMicros(10)
    pins.digitalWritePin(DigitalPin.P1, 0)

    echoUs = pins.pulseIn(DigitalPin.P2, PulseValue.High, 25000)
    if (echoUs == 0) {
        distanceCm = -1
    } else {
        let value = Math.round(echoUs / 58)
        if (value < 2 || value > 400) {
            distanceCm = -1
        } else {
            distanceCm = value
        }
    }
}

function updatePresence() {
    let near = distanceCm >= MIN_CM && distanceCm <= MAX_CM

    if (pirValue == 0) {
        pirZeroStreak = Math.min(99, pirZeroStreak + 1)
    } else {
        pirZeroStreak = 0
    }

    if (near) {
        distanceMissStreak = 0
    } else {
        distanceMissStreak = Math.min(99, distanceMissStreak + 1)
    }

    let nextState = "WAIT"
    if (near) {
        if (pirZeroStreak >= STREAK_LIMIT) {
            nextState = "STILL"
        } else {
            nextState = "HERE"
        }
    } else if (pirZeroStreak >= STREAK_LIMIT &&
        distanceMissStreak >= STREAK_LIMIT &&
        input.runningTime() - bootMs >= PIR_WARMUP_MS) {
        nextState = "AWAY"
    }

    if (userState != nextState) {
        userState = nextState
        if (userState == "HERE") {
            basic.showString("H")
        } else if (userState == "STILL") {
            basic.showString("S")
        } else if (userState == "AWAY") {
            basic.showString("A")
        } else {
            basic.showString("W")
        }
    }
}

input.onButtonPressed(Button.A, function () {
    basic.showString("S " + userState + " Z " + pirZeroStreak + " F " + distanceMissStreak)
})

input.onButtonPressed(Button.B, function () {
    if (distanceCm < 0) {
        basic.showString("D NO P " + pirValue + " U " + echoUs)
    } else {
        basic.showString("D " + distanceCm + " P " + pirValue + " U " + echoUs)
    }
})

basic.forever(function () {
    pirValue = pins.digitalReadPin(DigitalPin.P8)
    basic.pause(200)
    measureDistance()
    updatePresence()

    serial.writeLine("STATE:" + userState +
        " D:" + distanceCm +
        " P:" + pirValue +
        " Z:" + pirZeroStreak +
        " F:" + distanceMissStreak +
        " U:" + echoUs)

    basic.pause(2800)
})

basic.showString("WAIT")
