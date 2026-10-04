# Café Manager

Simple offline table & order app for a café/lounge. Windows 10/11. No internet, no account, no server.
Electron + React + TypeScript + SQLite (one local file).

## Build the Windows installer (on a Windows PC)

1. Install Node.js 22 LTS (22.12 or newer) from nodejs.org. It is only needed to build, not on the café PC.
2. Open a terminal in this folder and run:

       npm install
       npm run dist

3. The installer appears in `release\CafeManager-Setup.exe`. Copy it to the café PC and run it.

To try it without building: `npm run dev`.

## Daily use

1. Pick your name (enter your PIN if you have one).
2. Tap a table (green = free, red = occupied, with a running timer and total).
3. Tap products. Every tap adds one; tapping again increases the quantity. The order is saved on every tap.
4. SAVE goes back to the tables. SAVE & PRINT prints the order first.
5. Customer wants to pay: REQUEST PAYMENT, choose CASH or CARD, PAY (or PAY & PRINT). The table turns green.

- **Move table** (top of the order): moves the order to a free table. If you pick an occupied table, the two orders are
  merged.
- **Void**: removing an item that was already printed asks for confirmation and is recorded under the employee (shown in
  Reports). Items not yet printed are removed silently.
- **Most used**: the 10 best sellers of the last 30 days; filled with menu items until there is enough history.
- **Switch employee** (top right) logs out; the next person picks their name and PIN.

Admins also see Reports and Settings. Staff see Tables and Orders only, and only today's orders. Revenue per employee
counts the person who took the payment.

## Printing (Settings -> Café & printing)

- **Windows printer**: any installed printer through its normal Windows driver. Pick the printer, and optionally tick
  "Print without the Windows dialog".
- **Thermal receipt printer (ESC/POS)**: sends raw commands. Printer address can be
    - a network printer's IP: `192.168.1.50` (port 9100) or `192.168.1.50:9100`
    - a USB printer shared in Windows: `\\localhost\ShareName`
    - a serial port: `COM3`
      Choose 80 mm or 58 mm paper. Characters like ë and ç and the € sign are supported; Cyrillic is not.
- Use "Save & print test page" to check it.

## Your data

- Database: `%APPDATA%\Cafe Manager\cafe.db`
- Automatic backups every ~3 hours: `%APPDATA%\Cafe Manager\backups\` (last 30 days)
- Settings -> Backup database / Restore database for manual copies (a USB stick is a good idea).
- Updating the app never touches the database.

## Notes

- Prices are stored in cents; paid orders keep the product names and prices from the time of sale.
- Demo data (tables 1-10, a small menu, "Demo Employee" with admin rights) is created on first launch. Add your own
  employee with a PIN, then deactivate the demo one.
- PINs are a convenience lock to tell employees apart, not strong security.

## Security

- **Who is logged in is decided by the app core, not the screen.** Staff cannot reach admin functions (settings, menu,
  employees, reports, backup/restore) even if the UI is tampered with. Orders, voids and payments are always recorded
  under the logged-in employee. Reloading the window logs everyone out.
- **PINs** are stored salted and hashed (scrypt). After 5 wrong tries an employee is locked out for 30 seconds, doubling
  on repeated failures. A PIN still only tells employees apart: anyone with Windows access to the PC can read the
  database file. Use a Windows account password and BitLocker if the PC is not under your control.
- **Hardened window**: sandboxed, no Node access from the screen, no navigation, no pop-ups, no DevTools or reload menu
  in the installed app, only the app's own window can talk to the core.
- **Inputs are validated** in the core: ids, prices, text length, printer address (IP, `\\localhost\Share` or COM port
  only), currency, print mode.
- **CSV export** neutralises names that start with `=`, `+`, `-` or `@` so Excel never runs them as formulas.
- **Restore** only accepts an intact file that has exactly this app's tables, with no triggers or views, and saves a
  safety copy first.
- Dependencies are current and `npm audit` reports 0 known vulnerabilities (Electron 44, better-sqlite3 13).
- Build-time hardening: Electron "fuses" disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and inspector flags, and only
  load code from the packaged app.

## Performance notes

- **Database**: statements are prepared once and reused. A new index on `payments(order_id)` is added automatically on
  first start after the update (schema version 2). It only adds an index, never touches your data; on a database with
  270,000 orders it took about 85 ms. Without it, history and reports got dramatically slower as orders accumulated.
- **Durability**: the database runs with `synchronous=FULL`, so an order change that was acknowledged survives a power
  cut. If a very slow disk makes taps feel slow, `NORMAL` (in `src/main/db.ts`, function `openDb`) is faster and still
  cannot corrupt the database in WAL mode, but the last second or so of changes can be lost in a power cut.
- **Table board** does not poll. It is loaded once after login and each order change updates only its own table. Timers
  show `1h 24m` and refresh every 20 seconds.
- **Orders list** shows the newest 300 orders of the chosen period with the real total; Export CSV in Reports always
  contains everything.
- The menu is cached on the screen and only re-sent when it was edited. Adding a product and "+" on an order line appear
  immediately and are confirmed by the database a moment later; paying is never optimistic and always waits for pending
  changes.
