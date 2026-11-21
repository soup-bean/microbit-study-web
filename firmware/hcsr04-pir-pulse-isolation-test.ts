// HC-SR04 + HC-SR501 isolated polling (BBC micro:bit V2 / MakeCode JS)
// Both sensors stay wired: HC-SR04 TRIG=P1, ECHO=3x10k divider -> P2;
// PIR OUT=P8. Sensors share 5V and GND. Do NOT connect 5V ECHO directly to P2.
// Test only; RTC, flash storage and Bluetooth are not included.
//
// PIR is sampled about once every 3 seconds, then ultrasound is triggered
// 200ms later (only when enabled). This does not repair wrong distance echoes.
// A: toggle ultrasound measurement on/off. B: show latest D, P and raw echo pulse time (US).

let ultrasonicEnabled = false
let distanceCm = -1
let echoUs = 0
let pirValue = 0
let lastPirShown = -1

pins.digitalWritePin(DigitalPin.P1, 0)
pins.setPull(DigitalPin.P8, PinPullMode.PullDown)

function measureUltrasound() {
    pins.digitalWritePin(DigitalPin.P1, 0)
    control.waitMicros(2)
    pins.digitalWritePin(DigitalPin.P1, 1)
    control.waitMicros(10)
    pins.digitalWritePin(DigitalPin.P1, 0)

    echoUs = pins.pulseIn(DigitalPin.P2, PulseValue.High, 25000)
    if (echoUs == 0) {
        distanceCm = -1
    } else {
        let cm = Math.round(echoUs / 58)
        if (cm < 2 || cm > 400) {
            distanceCm = -1
        } else {
            distanceCm = cm
        }
    }
}

input.onButtonPressed(Button.A, function () {
    ultrasonicEnabled = !ultrasonicEnabled
    if (ultrasonicEnabled) {
        basic.showString("U ON")
    } else {
        pins.digitalWritePin(DigitalPin.P1, 0)
        basic.showString("U OFF")
    }
})

// B alone shows distance, PIR and raw ultrasound time (microseconds).
// Avoid A+B: on real hardware the two presses may register separately.
input.onButtonPressed(Button.B, function () {
    if (distanceCm < 0) {
        basic.showString("D NO P " + pirValue + " U " + echoUs)
    } else {
        basic.showString("D " + distanceCm + " P " + pirValue + " U " + echoUs)
    }
})

basic.forever(function () {
    // Only sample the PIR once per cycle, not every 100ms.
    pirValue = pins.digitalReadPin(DigitalPin.P8)
    if (pirValue != lastPirShown) {
        lastPirShown = pirValue
        if (pirValue == 1) {
            basic.showIcon(IconNames.Yes)
        } else {
            basic.showIcon(IconNames.No)
        }
    }

    // Offset the ultrasonic trigger from the moment the PIR is sampled.
    basic.pause(200)
    if (ultrasonicEnabled) {
        measureUltrasound()
    }

    // Debugging via MakeCode serial console if attached over USB.
    serial.writeLine("CM:" + distanceCm + " US:" + echoUs + " PIR:" + pirValue +
        " ULTRA:" + (ultrasonicEnabled ? 1 : 0))

    basic.pause(2800)
})

basic.showString("DUAL")
