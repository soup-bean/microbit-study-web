// micro:bit V2: 05:00 study-day + DS1302 + FlashStorage + BLE test.
// Extensions: Bluetooth, github:bsiever/microbit-pxt-flashstorage,
// github:makecode-extensions/DS1302. Settings: No Pairing Required.
// RTC wiring CLK=P13, DAT=P14, RST=P15; power=3.3V, GND.
// TEST FIRMWARE: A adds 300 seconds, A+B adds 60 seconds (no sensors yet).
// A SINGLE key H stores seven days at second precision in 30-byte compact format.
// Firmware reflash may erase records. Old disposable TEST keys are migrated/removed on first boot.

let rtc = DS1302.create(DigitalPin.P13, DigitalPin.P14, DigitalPin.P15)
let connected = false
let sending = false
let activeDay = 0
let savedAnchor = 0
let savedSeconds: number[] = []
const DAYS = 7
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_"

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
function prevDate(key: number): number {
    let y = Math.idiv(key, 10000)
    let m = Math.idiv(key % 10000, 100)
    let d = key % 100 - 1
    if (d == 0) {
        m -= 1
        if (m == 0) { y -= 1; m = 12 }
        d = monthDays(y, m)
    }
    return y * 10000 + m * 100 + d
}
function blankSeconds(): number[] {
    let values: number[] = []
    for (let i = 0; i < DAYS; i++) values.push(0)
    return values
}
function encodeSeconds(seconds: number): string {
    let n = Math.max(0, Math.min(86400, seconds))
    return ALPHABET.charAt(Math.idiv(n, 4096)) +
        ALPHABET.charAt(Math.idiv(n % 4096, 64)) +
        ALPHABET.charAt(n % 64)
}
function decodeSeconds(text: string): number {
    if (text.length != 3) return -1
    let a = ALPHABET.indexOf(text.charAt(0))
    let b = ALPHABET.indexOf(text.charAt(1))
    let c = ALPHABET.indexOf(text.charAt(2))
    if (a < 0 || b < 0 || c < 0) return -1
    let n = a * 4096 + b * 64 + c
    return n <= 86400 ? n : -1
}
function loadHistory(): boolean {
    savedAnchor = 0
    savedSeconds = blankSeconds()
    let parts = flashstorage.get("H").split("|")
    if (parts.length < 2 || parts[0].length != 6 || parts[1].length != 21) return false
    for (let j = 0; j < parts[0].length; j++) {
        let ch = parts[0].charAt(j)
        if (ch < "0" || ch > "9") return false
    }
    let key = 20000000 + parseInt(parts[0])
    if (keySerial(key) < 0) return false
    let values = blankSeconds()
    for (let i = 0; i < DAYS; i++) {
        let n = decodeSeconds(parts[1].substr(i * 3, 3))
        if (n < 0) return false
        values[i] = n
    }
    savedAnchor = key
    savedSeconds = values
    return true
}
function saveHistory(): boolean {
    if (keySerial(savedAnchor) < 0 || savedSeconds.length != DAYS) return false
    // YYMMDD + | + seven 3-char values + | + NUL = 30 bytes, below 32-byte limit.
    let payload = "" + (savedAnchor - 20000000) + "|"
    for (let i = 0; i < DAYS; i++) payload += encodeSeconds(savedSeconds[i])
    payload += "|" + "\u0000"
    flashstorage.put("H", payload)
    let written = flashstorage.get("H").split("|")
    if (written.length < 2) return false
    return written[0] == "" + (savedAnchor - 20000000) && written[1] == payload.split("|")[1]
}
function oldStudy(dateKey: number): number {
    let serial = keySerial(dateKey)
    if (serial < 0) return 0
    let fields = flashstorage.get("D" + serial % DAYS).split("|")[0].split(",")
    if (fields.length != 2 || fields[0] != "" + dateKey) return 0
    let n = parseInt(fields[1])
    return n >= 0 && n <= 86400 ? n : 0
}
function initStorage() {
    let today = studyDate()
    if (today == 0) return
    let hasHistory = loadHistory()
    let oldValues = blankSeconds()
    let found = false
    if (!hasHistory) {
        let day = today
        for (let i = 0; i < DAYS; i++) {
            oldValues[i] = oldStudy(day)
            if (oldValues[i] > 0) found = true
            day = prevDate(day)
        }
    }
    // Remove only prior project TEST keys, never unrelated system keys.
    // Old test records are migrated first if they can be read.
    for (let i = 0; i < DAYS; i++) flashstorage.remove("D" + i)
    flashstorage.remove("test_value")
    flashstorage.remove("rtc_combo")
    if (!hasHistory && found) {
        savedAnchor = today
        savedSeconds = oldValues
        saveHistory()
    }
}
function addStudy(amount: number) {
    if (sending) return
    let day = studyDate()
    if (day == 0) { basic.showString("RTC?"); return }
    activeDay = day
    if (!loadHistory()) { savedAnchor = day; savedSeconds = blankSeconds() }
    let delta = keySerial(day) - keySerial(savedAnchor)
    if (delta > 0) {
        let shifted = blankSeconds()
        if (delta < DAYS) {
            for (let i = delta; i < DAYS; i++) shifted[i] = savedSeconds[i - delta]
        }
        savedSeconds = shifted
        savedAnchor = day
    } else if (delta < -(DAYS - 1)) {
        basic.showString("OLD")
        if (connected) bluetooth.uartWriteLine("ERR:OLD")
        return
    }
    let index = keySerial(savedAnchor) - keySerial(day)
    savedSeconds[index] = Math.min(86400, savedSeconds[index] + amount)
    if (!saveHistory()) {
        basic.showString("E")
        if (connected) {
            bluetooth.uartWriteLine("ERR:STORE")
            basic.pause(140)
            bluetooth.uartWriteLine("DBG:SIZE:" + flashstorage.size())
            basic.pause(140)
            bluetooth.uartWriteLine("DBG:H:" + flashstorage.get("H").length)
        }
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
    if (today == 0) { bluetooth.uartWriteLine("ERR:RTC"); return }
    sending = true
    let hasHistory = loadHistory()
    let foundToday = false
    let sent = 0
    let todaySerial = keySerial(today)
    bluetooth.uartWriteLine("DATE:" + getClockDate())
    basic.pause(140)
    bluetooth.uartWriteLine("TIME:" + getClockTime())
    basic.pause(140)
    bluetooth.uartWriteLine("BEGIN:" + today)
    basic.pause(140)
    if (hasHistory) {
        let day = savedAnchor
        for (let i = 0; i < DAYS; i++) {
            let age = todaySerial - keySerial(day)
            if (age >= 0 && age < DAYS && (savedSeconds[i] > 0 || day == today)) {
                bluetooth.uartWriteLine("REC:" + day + ":" + savedSeconds[i])
                sent += 1
                if (day == today) foundToday = true
                basic.pause(160)
            }
            day = prevDate(day)
        }
    }
    if (!foundToday) {
        bluetooth.uartWriteLine("REC:" + today + ":0")
        sent += 1
        basic.pause(160)
    }
    bluetooth.uartWriteLine("END:" + sent)
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
initStorage()
activeDay = studyDate()
basic.forever(function () {
    // Automatic 05:00 rollover of the active date; does not write flash.
    let today = studyDate()
    if (today > 0 && today != activeDay) activeDay = today
    basic.pause(1000)
})
basic.showString("READY")
