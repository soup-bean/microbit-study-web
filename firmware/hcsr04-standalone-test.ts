// HC-SR04 standalone distance test for BBC micro:bit V2
// No extensions needed. Fresh MakeCode project; keep the RTC+Flash+BLE project.
// Wiring: VCC -> verified 5V; GND -> GND; TRIG -> P1 (SIG);
// ECHO -> divider (10k high / 10k low) -> P2 (SIG).
// NEVER connect 5V ECHO directly to the micro:bit pin.

function distanceCm(): number {
    pins.digitalWritePin(DigitalPin.P1, 0)
    control.waitMicros(2)
    pins.digitalWritePin(DigitalPin.P1, 1)
    control.waitMicros(10)
    pins.digitalWritePin(DigitalPin.P1, 0)

    let us = pins.pulseIn(DigitalPin.P2, PulseValue.High, 25000)
    if (us == 0) return -1
    let cm = Math.round(us / 58)
    if (cm < 2 || cm > 400) return -1
    return cm
}

// A: one distance reading in cm
input.onButtonPressed(Button.A, function () {
    let cm = distanceCm()
    if (cm < 0) {
        basic.showString("NO")
    } else {
        basic.showNumber(cm)
    }
})

// B: three readings, display median to reject one noisy reading
input.onButtonPressed(Button.B, function () {
    let a = distanceCm()
    basic.pause(75)
    let b = distanceCm()
    basic.pause(75)
    let c = distanceCm()
    if (a < 0 || b < 0 || c < 0) {
        basic.showString("NO")
    } else {
        let median = a + b + c - Math.min(a, Math.min(b, c)) - Math.max(a, Math.max(b, c))
        basic.showNumber(median)
    }
})

basic.showString("US")
