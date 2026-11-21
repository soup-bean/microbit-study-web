// HC-SR04 + HC-SR501 interference isolation / micro:bit V2 MakeCode JavaScript
// Same verified wiring: ultrasonic TRIG=P1, ECHO via 3x10k divider to P2;
// PIR OUT=P8, both sensors powered from board 5V/GND.
// A toggles ultrasonic distance measurements every 3 seconds.
// B displays latest distance (cm) and current PIR 0/1.
// LED shows PIR state as check/X when that state changes.
// The PIR keeps being sampled every 100ms, even when ultrasound is enabled.
// No RTC, FlashStorage, BLE extensions or continuous serial output.

let ultrasoundOn = false
let latestDistance = -1
let lastPir = -1

pins.digitalWritePin(DigitalPin.P1, 0)
pins.setPull(DigitalPin.P8, PinPullMode.PullDown)

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

input.onButtonPressed(Button.A, function () {
    ultrasoundOn = !ultrasoundOn
    if (ultrasoundOn) {
        basic.showString("ON")
    } else {
        pins.digitalWritePin(DigitalPin.P1, 0)
        basic.showString("OFF")
    }
})

input.onButtonPressed(Button.B, function () {
    let pir = pins.digitalReadPin(DigitalPin.P8)
    if (latestDistance < 0) {
        basic.showString("D NO P " + pir)
    } else {
        basic.showString("D " + latestDistance + " P " + pir)
    }
})

basic.forever(function () {
    let pir = pins.digitalReadPin(DigitalPin.P8)
    if (pir != lastPir) {
        lastPir = pir
        if (pir == 1) {
            basic.showIcon(IconNames.Yes)
        } else {
            basic.showIcon(IconNames.No)
        }
    }
    basic.pause(100)
})

basic.forever(function () {
    if (ultrasoundOn) {
        latestDistance = distanceCm()
    }
    basic.pause(3000)
})

basic.showString("DUAL")
