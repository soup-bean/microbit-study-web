// HC-SR501 PIR-only test for BBC micro:bit V2.
// MakeCode JavaScript. No extensions needed.
// HC-SR501 VCC -> expansion board 5V
// HC-SR501 GND -> expansion board GND
// HC-SR501 OUT -> expansion board P8 SIG
// Use board pin labels, not orientation assumptions.
// Standard HC-SR501 OUT is 3.3V HIGH; verify if using a different module.
// Warm-up: ignore readings for first 30-60 seconds.
// PIR detects *movement*, not reliably a motionless seated person.

let lastPIR = -1
pins.setPull(DigitalPin.P8, PinPullMode.PullDown)

input.onButtonPressed(Button.A, function () {
    // Re-check raw digital output whenever needed.
    basic.showNumber(pins.digitalReadPin(DigitalPin.P8))
})

basic.forever(function () {
    let current = pins.digitalReadPin(DigitalPin.P8)
    if (current != lastPIR) {
        lastPIR = current
        if (current == 1) {
            basic.showIcon(IconNames.Yes)
        } else {
            basic.showIcon(IconNames.No)
        }
    }
    basic.pause(200)
})
