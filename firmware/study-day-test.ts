// micro:bit V2: 05:00 study-day + DS1302 + FlashStorage + BLE test.
// Extensions: Bluetooth, github:bsiever/microbit-pxt-flashstorage,
// github:makecode-extensions/DS1302. Settings: No Pairing Required.
// RTC wiring CLK=P13, DAT=P14, RST=P15; power=3.3V, GND.
// TEST FIRMWARE: A adds 300 seconds, A+B adds 60 seconds (no sensors yet).
// Keys D0..D6 store seven rolling calendar-day slots, values YYYYMMDD,seconds|.
// Firmware reflash can erase flash records. Existing rtc_combo key is untouched.

let rtc = DS1302.create(DigitalPin.P13, DigitalPin.P14, DigitalPin.P15)
let connected = false
let sending = false
let activeDay = 0
const DAYS = 7

function two(n: number): string {
    if (n < 10) return "0" + n
    return "" + n
}
function isLeap(y: number): boolean {
    return (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}
function monthDays(y: number, m: number): number {
    if (m == 2) return isLeap(y) ? 29 : 28
    if (m == 4 || m == 6 || m == 9 || m == 11) return 30
    return 31
}
function validDate(y: number, m: number, d: number): boolean {
    return y >= 2020 && y <= 2099 && m >= 1 && m <= 12 &&
        d >= 1 && d <= monthDays(y, m)
}
function daySerial(y: number, m: number, d: number): number {
    let total = 0
    for (let yy = 2020; yy < y; yy++) {
        total += isLeap(yy) ? 366 : 365
    }
    for (let mm = 1; mm < m; mm++) {
        total += monthDays(y, mm)
    }
    return total + d - 1
}
function keySerial(dateKey: number): number {
    let y = Math.idiv(dateKey, 10000)
    let m = Math.idiv(dateKey % 10000, 100)
    let d = dateKey % 100
    if (!validDate(y, m, d)) return -1
    return daySerial(y, m, d)
}
function studyDate(): number {
    let y = rtc.getYear()
    let m = rtc.getMonth()
    let d = rtc.getDay()
    let hour = rtc.getHour()
    if (!validDate(y, m, d) || hour < 0 || hour > 23) return 0
    // Before 05:00 KST, the study date is the previous calendar date.
    if (hour < 5) {
        d -= 1
        if (d == 0) {
            m -= 1
            if (m == 0) {
                y -= 1
                m = 12
            }
            d = monthDays(y, m)
        }
    }
    if (!validDate(y, m, d)) return 0
    return y * 10000 + m * 100 + d
}
function storageKey(slot: number): string {
    return "D" + slot
}
function slotOf(dateKey: number): number {
    return keySerial(dateKey) % DAYS
}
function readStudy(dateKey: number): number {
    let serialDay = keySerial(dateKey)
    if (serialDay < 0) return 0
    let raw = flashstorage.get(storageKey(serialDay % DAYS)).split("|")[0]
    let fields = raw.split(",")
    if (fields.length != 2 || fields[0] != "" + dateKey || fields[1] == "") return 0
    let seconds = parseInt(fields[1])
    if (seconds < 0 || seconds > 86400) return 0
    return seconds
}
function addStudy(amount: number) {
    if (sending) return
    let day = studyDate()
    if (day == 0) {
        basic.showString("RTC?")
        return
    }
    activeDay = day
    let before = readStudy(day)
    let after = Math.min(86400, before + amount)
    // Write only when the user explicitly adds time; no flash writes in the loop.
    flashstorage.put(storageKey(slotOf(day)), day + "," + after + "|")
    if (readStudy(day) != after) {
        basic.showString("E")
        if (connected) bluetooth.uartWriteLine("ERR:STORE")
        return
    }
    basic.showString("+" + amount)
    if (connected) bluetooth.uartWriteLine("ADD:" + amount)
}
function getClockDate(): string {
    return rtc.getYear() + "-" + two(rtc.getMonth()) + "-" + two(rtc.getDay())
}
function getClockTime(): string {
    return two(rtc.getHour()) + ":" + two(rtc.getMinute()) + ":" + two(rtc.getSecond())
}
function sendRecords() {
    if (!connected || sending) return
    let today = studyDate()
    if (today == 0) {
        bluetooth.uartWriteLine("ERR:RTC")
        return
    }
    sending = true
    activeDay = today
    let serialToday = keySerial(today)
    let count = 0
    let foundToday = false
    bluetooth.uartWriteLine("DATE:" + getClockDate())
    basic.pause(120)
    bluetooth.uartWriteLine("TIME:" + getClockTime())
    basic.pause(120)
    bluetooth.uartWriteLine("BEGIN:" + today)
    basic.pause(120)
    for (let slot = 0; slot < DAYS; slot++) {
        let raw = flashstorage.get(storageKey(slot)).split("|")[0]
        let parts = raw.split(",")
        if (parts.length == 2 && parts[1] != "") {
            let day = parseInt(parts[0])
            let number = parseInt(parts[1])
            let serial = keySerial(day)
            // Reject a corrupt entry, an expired entry or a mismatched slot.
            if (serial >= serialToday - 6 && serial <= serialToday &&
                serial % DAYS == slot && number >= 0 && number <= 86400) {
                bluetooth.uartWriteLine("REC:" + day + ":" + number)
                if (day == today) foundToday = true
                count += 1
                basic.pause(140)
            }
        }
    }
    if (!foundToday) {
        bluetooth.uartWriteLine("REC:" + today + ":0")
        count += 1
        basic.pause(140)
    }
    bluetooth.uartWriteLine("END:" + count)
    sending = false
}
function validClockCommand(command: string): boolean {
    if (command.length != 17 || command.substr(0, 2) != "T:") return false
    for (let i = 2; i < 17; i++) {
        let ch = command.charAt(i)
        if (ch < "0" || ch > "9") return false
    }
    let y = parseInt(command.substr(2, 4))
    let m = parseInt(command.substr(6, 2))
    let d = parseInt(command.substr(8, 2))
    let hh = parseInt(command.substr(10, 2))
    let mm = parseInt(command.substr(12, 2))
    let ss = parseInt(command.substr(14, 2))
    let weekday = parseInt(command.substr(16, 1))
    return validDate(y, m, d) && hh <= 23 && mm <= 59 && ss <= 59 &&
        weekday >= 1 && weekday <= 7
}
function setClockFromCommand(command: string) {
    if (!validClockCommand(command)) {
        bluetooth.uartWriteLine("SYNC:ERR")
        return
    }
    let y = parseInt(command.substr(2, 4))
    let m = parseInt(command.substr(6, 2))
    let d = parseInt(command.substr(8, 2))
    let hh = parseInt(command.substr(10, 2))
    let mm = parseInt(command.substr(12, 2))
    let ss = parseInt(command.substr(14, 2))
    let weekday = parseInt(command.substr(16, 1))
    rtc.DateTime(y, m, d, weekday, hh, mm, ss)
    if (rtc.getYear() == y && rtc.getMonth() == m &&
        rtc.getDay() == d && rtc.getHour() == hh &&
        rtc.getMinute() == mm) {
        activeDay = studyDate()
        bluetooth.uartWriteLine("SYNC:OK")
    } else {
        bluetooth.uartWriteLine("SYNC:ERR")
    }
}
function setBoundaryTestTime() {
    // Set RTC to the current RTC calendar date at 04:59:30.
    // TEST ONLY: must restore real KST using the webpage's sync button afterwards.
    let y = rtc.getYear()
    let m = rtc.getMonth()
    let d = rtc.getDay()
    let w = rtc.getWeekday()
    if (!validDate(y, m, d)) {
        bluetooth.uartWriteLine("TEST:ERR")
        return
    }
    rtc.DateTime(y, m, d, w, 4, 59, 30)
    if (rtc.getHour() == 4 && rtc.getMinute() == 59) {
        activeDay = studyDate()
        bluetooth.uartWriteLine("TEST:OK")
    } else {
        bluetooth.uartWriteLine("TEST:ERR")
    }
}
bluetooth.onBluetoothConnected(function () {
    connected = true
    basic.showIcon(IconNames.Yes)
})
bluetooth.onBluetoothDisconnected(function () {
    connected = false
    sending = false
    basic.showIcon(IconNames.No)
})
bluetooth.onUartDataReceived(serial.delimiters(Delimiters.NewLine), function () {
    let line = bluetooth.uartReadUntil(serial.delimiters(Delimiters.NewLine))
    if (line == "R") sendRecords()
    else if (line == "X") setBoundaryTestTime()
    else setClockFromCommand(line)
})
input.onButtonPressed(Button.A, function () {
    addStudy(300)
})
input.onButtonPressed(Button.AB, function () {
    addStudy(60)
})
input.onButtonPressed(Button.B, function () {
    sendRecords()
})
bluetooth.startUartService()
activeDay = studyDate()
basic.forever(function () {
    // Automatic 05:00 rollover of the active date; does not write flash.
    let today = studyDate()
    if (today > 0 && today != activeDay) activeDay = today
    basic.pause(1000)
})
basic.showString("READY")
