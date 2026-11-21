// HC-SR04 + HC-SR501 simultaneous test (micro:bit V2 / MakeCode JavaScript)
// No extensions required. This is SENSOR-ONLY, not RTC/flash/BLE firmware.
//
// HC-SR04: VCC -> 5V, TRIG -> P1 SIG, GND -> common GND.
//           ECHO -> breadboard 15 -> 10k -> 12 -> 10k -> 13 -> 10k -> 14(GND)
//           Breadboard 12 -> P2 SIG; breadboard 14 -> common GND.
// HC-SR501: VCC -> 5V, OUT -> P8 SIG, GND -> any common GND on expansion board.
// Never connect the HC-SR04 5V ECHO directly to P2.
// Wait 30-60 seconds after power-on for PIR stabilization.

let currentDistance = -1
let currentPIR = 0

pins.setPull(DigitalPin.P8, PinPullMode.PullDown)

function readDistanceCm(): number {
    pins.digitalWritePin(DigitalPin.P1, 0)
    control.waitMicros(2)
    pins.digitalWritePin(DigitalPin.P1, 1)
    control.waitMicros(10)
    pins.digitalWritePin(DigitalPin.P1, 0)

    let durationUs = pins.pulseIn(DigitalPin.P2, PulseValue.High, 25000)
    if (durationUs == 0) return -1
    let cm = Math.round(durationUs / 58)
    if (cm < 2 || cm > 400) return -1
    return cm
}

// A: show the latest pair of readings on the LED display.
// Example "D 25 P 1" = 25cm and PIR detected movement.
input.onButtonPressed(Button.A, function () {
    if (currentDistance < 0) {
        basic.showString("D NO P " + currentPIR)
    } else {
        basic.showString("D " + currentDistance + " P " + currentPIR)
    }
})

// B: show just the live PIR value (0 or 1).
input.onButtonPressed(Button.B, function () {
    basic.showNumber(pins.digitalReadPin(DigitalPin.P8))
})

// USB serial also reports each pair continuously for MakeCode console.
basic.forever(function () {
    currentDistance = readDistanceCm()
    currentPIR = pins.digitalReadPin(DigitalPin.P8)
    serial.writeLine("DIST_CM:" + currentDistance + " PIR:" + currentPIR)
    basic.pause(500)
})

basic.showString("DUAL")
