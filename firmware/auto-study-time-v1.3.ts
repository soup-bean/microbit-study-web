// micro:bit V2: automatic study time v1.3, RTC + flash + BLE + ultrasonic + PIR + I2C LCD.
// Extensions: Bluetooth, github:bsiever/microbit-pxt-flashstorage,
// github:makecode-extensions/DS1302, github:makecode-extensions/i2cLCD1602.
// Settings: No Pairing Required. LCD SDA=P20, SCL=P19, shared GND.
// Use 3.3V for LCD testing, or 5V with bidirectional I2C level shifting.
// No RGB LED or NeoPixel dependency.
// RTC wiring CLK=P13, DAT=P14, RST=P15; power=3.3V, GND.
// AUTO FIRMWARE: no manual time-add buttons. A wakes LCD for 10s, B sends record snapshot.
// A SINGLE key H stores seven days at second precision in 30-byte compact format.
// Firmware reflash may erase records. Legacy test records are migrated when possible.

let rtc = DS1302.create(DigitalPin.P13, DigitalPin.P14, DigitalPin.P15)
let connected = false
let sending = false
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
// Sensor-only definitions (the successful dual-sensor wiring is unchanged).
const MIN_CM = 10
const ENTRY_MAX_CM = 60
const HOLD_MAX_CM = 80
const PIR_ZERO_LIMIT = 3
const WAIT_MISSES = 2
const AWAY_MISSES = 5
const MAX_PENDING_SECONDS = 60
const WARMUP_MS = 60000
const FIVE_AM_SECONDS = 18000
const SAVE_EVERY_MS = 300000  // Every 5 minutes while studying; save on AWAY/B/R.
let echoUs = 0
let distanceCm = -1
let pirValue = 0
let pirZeros = 0
let distanceMisses = 0
let presence = "WAIT"
let trackingUser = false
let previousEpoch = -1
let pendingWaitStart = -1
let dirtyHistory = false
let lastSaveMs = input.runningTime()
let lastAttemptMs = -1
let bootMs = input.runningTime()

pins.digitalWritePin(DigitalPin.P1, 0)
pins.setPull(DigitalPin.P8, PinPullMode.PullDown)

function keyFromSerial(serial: number): number {
    if (serial < 0) return 0
    let y = 2020
    while (y <= 2099) {
        let daysInYear = isLeap(y) ? 366 : 365
        if (serial < daysInYear) break
        serial -= daysInYear
        y += 1
    }
    if (y > 2099) return 0
    let m = 1
    while (m <= 12 && serial >= monthDays(y, m)) {
        serial -= monthDays(y, m)
        m += 1
    }
    if (m > 12) return 0
    return y * 10000 + m * 100 + serial + 1
}
function studyDayFromEpoch(epoch: number): number {
    if (epoch < FIVE_AM_SECONDS) return 0
    return keyFromSerial(Math.idiv(epoch - FIVE_AM_SECONDS, 86400))
}
function clockEpoch(): number {
    let y = rtc.getYear()
    let m = rtc.getMonth()
    let d = rtc.getDay()
    let h = rtc.getHour()
    let min = rtc.getMinute()
    let sec = rtc.getSecond()
    if (!validDate(y, m, d) || h < 0 || h > 23 || min < 0 ||
        min > 59 || sec < 0 || sec > 59) return -1
    return daySerial(y, m, d) * 86400 + h * 3600 + min * 60 + sec
}
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
        distanceCm = (value < 2 || value > 400) ? -1 : value
    }
}
// All accrued seconds stay in RAM until a scheduled/explicit flash commit.
function creditDay(dayKey: number, seconds: number) {
    if (seconds <= 0 || keySerial(dayKey) < 0) return
    if (savedAnchor == 0) {
        savedAnchor = dayKey
        savedSeconds = blankSeconds()
    }
    let shift = keySerial(dayKey) - keySerial(savedAnchor)
    if (shift > 0) {
        let next = blankSeconds()
        if (shift < DAYS) {
            for (let i = shift; i < DAYS; i++) next[i] = savedSeconds[i - shift]
        }
        savedSeconds = next
        savedAnchor = dayKey
    }
    let index = keySerial(savedAnchor) - keySerial(dayKey)
    if (index < 0 || index >= DAYS) return
    savedSeconds[index] = Math.min(86400, savedSeconds[index] + seconds)
    dirtyHistory = true
}
// The end RTC time selects the study day. Split a short interval at 05:00
// so elapsed seconds immediately before 05:00 belong to yesterday.
function creditInterval(startEpoch: number, endEpoch: number) {
    if (startEpoch < 0 || endEpoch <= startEpoch || endEpoch - startEpoch > 60) return
    let endDay = studyDayFromEpoch(endEpoch)
    if (endDay == 0) return
    let boundary = Math.idiv(endEpoch - FIVE_AM_SECONDS, 86400) * 86400 + FIVE_AM_SECONDS
    if (startEpoch < boundary && boundary <= endEpoch) {
        creditDay(prevDate(endDay), boundary - startEpoch)
        creditDay(endDay, endEpoch - boundary)
    } else {
        creditDay(endDay, endEpoch - startEpoch)
    }
}
function commitHistory(force: boolean) {
    if (!dirtyHistory || sending) return
    let now = input.runningTime()
    if (!force && now - lastSaveMs < SAVE_EVERY_MS) return
    // Avoid flash-write retries on every sensor poll when the storage is full.
    if (lastAttemptMs >= 0 && now - lastAttemptMs < 15000) return
    lastAttemptMs = now
    if (saveHistory()) {
        dirtyHistory = false
        lastSaveMs = now
    } else {
        basic.showString("E")
        if (connected) bluetooth.uartWriteLine("ERR:STORE")
    }
}
function updatePresence(nowEpoch: number) {
    // Presence hysteresis: enter at <=60cm, retain at <=80cm until AWAY.
    let wasTracking = trackingUser
    let hadMisses = distanceMisses > 0
    let maxCm = wasTracking ? HOLD_MAX_CM : ENTRY_MAX_CM
    let near = distanceCm >= MIN_CM && distanceCm <= maxCm

    if (pirValue == 0) pirZeros = Math.min(99, pirZeros + 1)
    else pirZeros = 0
    if (near) distanceMisses = 0
    else distanceMisses = Math.min(99, distanceMisses + 1)

    let previousValid = previousEpoch >= 0 && nowEpoch >= previousEpoch &&
        nowEpoch - previousEpoch <= 30
    if (!previousValid) pendingWaitStart = -1

    let next = "WAIT"
    if (near) {
        if (wasTracking && previousValid) {
            if (hadMisses) {
                // Credit the tentative interval exactly once on recovery.
                // Long unresolved waits are not treated as study time.
                if (pendingWaitStart >= 0 && nowEpoch >= pendingWaitStart &&
                    nowEpoch - pendingWaitStart <= MAX_PENDING_SECONDS) {
                    creditInterval(pendingWaitStart, nowEpoch)
                }
            } else {
                creditInterval(previousEpoch, nowEpoch)
            }
        }
        pendingWaitStart = -1
        trackingUser = true
        next = pirZeros >= PIR_ZERO_LIMIT ? "STILL" : "HERE"
    } else {
        // First failed sample marks the beginning of the uncertain period.
        // The preceding interval belongs to the last confirmed sample.
        // Do NOT credit later intervals based on the screen's held H/S state.
        if (wasTracking && !hadMisses && previousValid) {
            creditInterval(previousEpoch, nowEpoch)
            pendingWaitStart = nowEpoch
        }
        if (distanceMisses >= AWAY_MISSES && pirZeros >= PIR_ZERO_LIMIT &&
            input.runningTime() - bootMs >= WARMUP_MS) {
            trackingUser = false
            pendingWaitStart = -1
            next = "AWAY"
        } else if (wasTracking && distanceMisses < WAIT_MISSES) {
            // Tolerate a single distance miss on the display only.
            next = presence
        }
        // When distance remains out of range and PIR detects movement,
        // WAIT alone never starts or resumes crediting a new session.
    }
    previousEpoch = nowEpoch

    if (next != presence) {
        presence = next
        if (presence == "HERE") basic.showString("H")
        else if (presence == "STILL") basic.showString("S")
        else if (presence == "AWAY") basic.showString("A")
        else basic.showString("W")
        if (connected && !sending) bluetooth.uartWriteLine("STATE:" + presence)
        if (presence == "AWAY") commitHistory(true)
    }
    commitHistory(false)
}
function resetClockTracking() {
    // Used after explicit phone sync / boundary test; never count a clock jump.
    previousEpoch = -1
    pendingWaitStart = -1
}
function todaySeconds(): number {
    let today = studyDate()
    if (today == 0 || savedAnchor == 0) return 0
    let index = keySerial(savedAnchor) - keySerial(today)
    if (index < 0 || index >= DAYS) return 0
    return savedSeconds[index]
}

// LCD UI only: never changes presence, RTC or credited study time.
const LCD_ADDRESS = 39
const LCD_ON_MS = 10000
const LCD_TICK_MS = 50
let lcdRequestedAt = -1
let lcdVisible = false
let lcdLastLine0 = ""
let lcdLastLine1 = ""
let lcdTodaySeconds = 0

function lcdLine(text: string): string {
    // Pad to 16 columns so shorter new text erases old characters.
    return (text + "                ").substr(0, 16)
}
function lcdTime(seconds: number): string {
    return two(Math.idiv(seconds, 3600)) + ":" +
        two(Math.idiv(seconds % 3600, 60)) + ":" + two(seconds % 60)
}
function lcdInit() {
    I2C_LCD1602.LcdInit(LCD_ADDRESS)
    I2C_LCD1602.off()
    I2C_LCD1602.BacklightOff()
}
function requestLcd() {
    // Button event only changes a deadline; all I2C writes use the sensor loop.
    lcdRequestedAt = input.runningTime()
}
function tickLcd() {
    let requested = lcdRequestedAt >= 0 &&
        input.runningTime() - lcdRequestedAt < LCD_ON_MS
    if (!requested) {
        if (lcdVisible) {
            I2C_LCD1602.off()
            I2C_LCD1602.BacklightOff()
            lcdVisible = false
        }
        return
    }

    // Display current confirmed time, excluding unresolved WAIT intervals.
    let line0 = lcdLine(presence + " " +
        (distanceCm < 0 ? "--cm" : "" + distanceCm + "cm"))
    let line1 = lcdLine("TODAY " + lcdTime(lcdTodaySeconds))
    if (!lcdVisible) {
        // Write fresh content while the screen is dark to avoid stale text flash.
        lcdLastLine0 = ""
        lcdLastLine1 = ""
    }
    if (line0 != lcdLastLine0) {
        I2C_LCD1602.ShowString(line0, 0, 0)
        lcdLastLine0 = line0
    }
    if (line1 != lcdLastLine1) {
        I2C_LCD1602.ShowString(line1, 0, 1)
        lcdLastLine1 = line1
    }
    if (!lcdVisible) {
        I2C_LCD1602.on()
        I2C_LCD1602.BacklightOn()
        lcdVisible = true
    }
}
// Sole runtime owner of LCD writes. I2C transfers cannot overlap pulseIn.
// Keep the original 2.8s sensor idle window (including LCD write time).
function idleWithLcd(ms: number) {
    let started = input.runningTime()
    while (input.runningTime() - started < ms) {
        tickLcd()
        let remaining = ms - (input.runningTime() - started)
        if (remaining > 0) basic.pause(Math.min(LCD_TICK_MS, remaining))
    }
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
    commitHistory(true)
    sending = true
    let foundToday = false
    // Freeze this transfer: it is a complete replacement snapshot.
    let snapshotAnchor = savedAnchor
    let snapshotSeconds = blankSeconds()
    for (let i = 0; i < DAYS; i++) snapshotSeconds[i] = savedSeconds[i]
    let sent = 0
    let todaySerial = keySerial(today)
    bluetooth.uartWriteLine("DATE:" + getClockDate())
    basic.pause(140)
    bluetooth.uartWriteLine("TIME:" + getClockTime())
    basic.pause(140)
    bluetooth.uartWriteLine("BEGIN:" + today)
    basic.pause(140)
    if (snapshotAnchor > 0) {
        let day = snapshotAnchor
        for (let i = 0; i < DAYS; i++) {
            let age = todaySerial - keySerial(day)
            if (age >= 0 && age < DAYS && (snapshotSeconds[i] > 0 || day == today)) {
                bluetooth.uartWriteLine("REC:" + day + ":" + snapshotSeconds[i])
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
        resetClockTracking()
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
        resetClockTracking()
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
// A: show the LCD on demand; repeat presses restart the 10-second window.
input.onButtonPressed(Button.A, function () {
    requestLcd()
})
// B: save and send live seven-day records. Without Bluetooth, show today's seconds.
input.onButtonPressed(Button.B, function () {
    if (connected) sendRecords()
    else {
        commitHistory(true)
        basic.showString("T " + todaySeconds() + "s")
    }
})
bluetooth.startUartService()
initStorage()
// Read existing compact H once at boot; subsequent counts remain in RAM.
// Do not re-read H on each BLE request (that would overwrite uncommitted seconds).
if (!loadHistory()) {
    savedAnchor = 0
    savedSeconds = blankSeconds()
}
lastSaveMs = input.runningTime()
lcdInit()
lcdTodaySeconds = todaySeconds()

basic.forever(function () {
    // PIR first, ultrasonic pulse after a 200ms offset.
    // The sequence was validated on actual sensors with a ~3s polling cycle.
    pirValue = pins.digitalReadPin(DigitalPin.P8)
    basic.pause(200)
    measureDistance()
    let nowEpoch = clockEpoch()
    updatePresence(nowEpoch)
    lcdTodaySeconds = todaySeconds()
    serial.writeLine("STATE:" + presence + " D:" + distanceCm +
        " P:" + pirValue + " Z:" + pirZeros + " F:" + distanceMisses +
        " T:" + todaySeconds() + " U:" + echoUs +
        " HOLD:" + (pendingWaitStart >= 0 ? 1 : 0))
    idleWithLcd(2800)
})
basic.showString("V1.3")
