// micro:bit V2 + DS1302 + FlashStorage + Bluetooth UART
// Required: Bluetooth, flashstorage, DS1302 extensions.
// Settings > No Pairing Required.
// DS1302: CLK=P13, DAT=P14, RST=P15, VCC=3.3V, GND=GND.
// RTC is NEVER set automatically on boot. A firmware upload may erase flash keys.
let rtc = DS1302.create(DigitalPin.P13, DigitalPin.P14, DigitalPin.P15)
let connected = false

function two(n: number): string {
    if (n < 10) return "0" + n
    return "" + n
}
function getDate(): string {
    return rtc.getYear() + "-" + two(rtc.getMonth()) + "-" + two(rtc.getDay())
}
function getTime(): string {
    return two(rtc.getHour()) + ":" + two(rtc.getMinute()) + ":" + two(rtc.getSecond())
}
function readSaved(): string {
    return flashstorage.get("rtc_combo").split("|")[0]
}
function saveStudy(seconds: number) {
    flashstorage.put("rtc_combo", seconds + "|")
    basic.showString("S" + seconds)
    if (connected) bluetooth.uartWriteLine("SAVE:" + seconds)
}
function isLeap(year: number): boolean {
    return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}
function daysOfMonth(year: number, month: number): number {
    if (month == 2) return isLeap(year) ? 29 : 28
    if (month == 4 || month == 6 || month == 9 || month == 11) return 30
    return 31
}
function validDateTime(command: string): boolean {
    // T:YYYYMMDDHHMMSSW (17 chars), ending newline read separately.
    if (command.length != 17 || command.substr(0, 2) != "T:") return false
    for (let i = 2; i < 17; i++) {
        let ch = command.charAt(i)
        if (ch < "0" || ch > "9") return false
    }
    let year = parseInt(command.substr(2, 4))
    let month = parseInt(command.substr(6, 2))
    let day = parseInt(command.substr(8, 2))
    let hour = parseInt(command.substr(10, 2))
    let minute = parseInt(command.substr(12, 2))
    let second = parseInt(command.substr(14, 2))
    let weekday = parseInt(command.substr(16, 1))
    return year >= 2020 && year <= 2099 &&
        month >= 1 && month <= 12 &&
        day >= 1 && day <= daysOfMonth(year, month) &&
        hour >= 0 && hour <= 23 &&
        minute >= 0 && minute <= 59 &&
        second >= 0 && second <= 59 &&
        weekday >= 1 && weekday <= 7
}

bluetooth.onBluetoothConnected(function () {
    connected = true
    basic.showIcon(IconNames.Yes)
})
bluetooth.onBluetoothDisconnected(function () {
    connected = false
    basic.showIcon(IconNames.No)
})

bluetooth.onUartDataReceived(serial.delimiters(Delimiters.NewLine), function () {
    let line = bluetooth.uartReadUntil(serial.delimiters(Delimiters.NewLine))
    if (!validDateTime(line)) {
        bluetooth.uartWriteLine("SYNC:ERR")
        return
    }
    let year = parseInt(line.substr(2, 4))
    let month = parseInt(line.substr(6, 2))
    let day = parseInt(line.substr(8, 2))
    let hour = parseInt(line.substr(10, 2))
    let minute = parseInt(line.substr(12, 2))
    let second = parseInt(line.substr(14, 2))
    let weekday = parseInt(line.substr(16, 1))
    rtc.DateTime(year, month, day, weekday, hour, minute, second)
    // Check the date, hour and minute read back before reporting success.
    if (rtc.getYear() == year &&
        rtc.getMonth() == month &&
        rtc.getDay() == day &&
        rtc.getHour() == hour &&
        rtc.getMinute() == minute) {
        bluetooth.uartWriteLine("SYNC:OK")
    } else {
        bluetooth.uartWriteLine("SYNC:ERR")
    }
})

input.onButtonPressed(Button.A, function () {
    saveStudy(240)
})
input.onButtonPressed(Button.AB, function () {
    saveStudy(360)
})
input.onButtonPressed(Button.B, function () {
    let saved = readSaved()
    let date = getDate()
    let time = getTime()
    if (saved == "") basic.showString("EMPTY")
    else basic.showString("R" + saved)
    if (connected) {
        bluetooth.uartWriteLine(saved == "" ? "READ:EMPTY" : "READ:" + saved)
        basic.pause(200)
        bluetooth.uartWriteLine("DATE:" + date)
        basic.pause(200)
        bluetooth.uartWriteLine("TIME:" + time)
    }
})

bluetooth.startUartService()
basic.showString("READY")
