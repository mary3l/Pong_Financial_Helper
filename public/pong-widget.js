// Pong Money: Safe to spend today
// A home screen widget for Scriptable (free on the App Store).
//
// Shows what's left of today's Safe to spend (the daily amount Home works out,
// minus what you've spent today) and today's expenses. Needs step 20 in
// supabase/SQL_GUIDE.md; before that it shows Spent today.
//
// Setup: in Pong Money open Settings › Home screen widget, make a widget key
// and copy the setup code. Run this script once in Scriptable and paste it.
// Run it again any time to preview the widget or change the setup code.

const KEYCHAIN = "pong-money-widget";
const CACHE = FileManager.local().joinPath(FileManager.local().documentsDirectory(), "pong-money-widget.json");
const TIME_ZONE = "Asia/Manila";

// Pong Money colors (src/app/globals.css).
const SEA = new Color("#13795a");
const SEA_TEXT = new Color("#e6f7ef");
const PANEL = Color.dynamic(Color.white(), new Color("#16241f"));
const INK = Color.dynamic(new Color("#12302a"), new Color("#e6f7ef"));
const MUTED = Color.dynamic(new Color("#4d6b63"), new Color("#9db8ae"));

// Same labels as src/lib/categories.ts.
const CATEGORIES = {
  food: "Food",
  groceries: "Groceries",
  transport: "Transpo",
  bills: "Bills",
  load: "Load",
  shopping: "Shopping",
  health: "Health",
  family: "Family",
  fun: "Fun",
  gifts: "Gifts",
  fees: "Fees & interest",
  other: "Other",
};

const font = {
  label: Font.boldRoundedSystemFont(11),
  big: Font.boldRoundedSystemFont(34),
  huge: Font.boldRoundedSystemFont(44),
  body: Font.semiboldRoundedSystemFont(13),
  small: Font.mediumRoundedSystemFont(11),
  sub: Font.mediumRoundedSystemFont(12),
};

// ---------- Setup ----------

function readSetup() {
  if (!Keychain.contains(KEYCHAIN)) return null;
  try {
    return JSON.parse(Keychain.get(KEYCHAIN));
  } catch {
    return null;
  }
}

function decodeSetup(code) {
  try {
    const b64 = code.trim().replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const setup = JSON.parse(Data.fromBase64String(padded).toRawString());
    return setup.url && setup.key && setup.widget && setup.app ? setup : null;
  } catch {
    return null;
  }
}

async function askForSetup() {
  const alert = new Alert();
  alert.title = "Connect Pong Money";
  alert.message =
    "In Pong Money, open Settings › Home screen widget, tap Make widget key, then copy the setup code and paste it here.";
  alert.addTextField("Setup code", Pasteboard.pasteString() || "");
  alert.addAction("Connect");
  alert.addCancelAction("Cancel");
  if ((await alert.present()) === -1) return null;

  const setup = decodeSetup(alert.textFieldValue(0));
  if (!setup) {
    const oops = new Alert();
    oops.title = "That's not a setup code";
    oops.message = "Copy it again from Settings › Home screen widget. It's a long line of letters and numbers.";
    oops.addAction("OK");
    await oops.present();
    return null;
  }
  Keychain.set(KEYCHAIN, JSON.stringify(setup));
  // Drop numbers cached under the old key.
  if (FileManager.local().fileExists(CACHE)) FileManager.local().remove(CACHE);
  return setup;
}

// ---------- Data ----------

function todayInManila() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function rpc(setup, name) {
  const req = new Request(`${setup.url}/rest/v1/rpc/${name}`);
  req.method = "POST";
  req.headers = { apikey: setup.key, "Content-Type": "application/json" };
  req.body = JSON.stringify({ widget_key: setup.widget });
  req.timeoutInterval = 15;
  const body = await req.loadString();
  return { status: req.response.statusCode, body };
}

/**
 * { date, perDay, left, asOf, nextPayday, daysLeft, total, count, items: [{ amount, category, note, wallet }] },
 * or null for a bad key. perDay and left are null until Home has worked out Safe to spend (or after payday).
 */
async function fetchSpent(setup) {
  let res = await rpc(setup, "widget_safe_to_spend");
  // Before step 20: Spent today only.
  if (res.status === 404) res = await rpc(setup, "widget_spent_today");
  if (res.status === 404) throw new Error("Run step 9 in SQL_GUIDE.md");
  if (res.status !== 200) throw new Error(`Supabase said ${res.status}`);
  return JSON.parse(res.body);
}

function readCache() {
  const fm = FileManager.local();
  if (!fm.fileExists(CACHE)) return null;
  try {
    return JSON.parse(fm.readString(CACHE));
  } catch {
    return null;
  }
}

function writeCache(data) {
  FileManager.local().writeString(CACHE, JSON.stringify({ data, at: Date.now() }));
}

/** { data } when fresh, { data, stale } from the cache when offline, or { error }. */
async function load(setup) {
  try {
    const data = await fetchSpent(setup);
    if (data === null) return { error: "Your widget key doesn't work anymore. Run this script in Scriptable and paste a new setup code." };
    writeCache(data);
    return { data };
  } catch (e) {
    const cached = readCache();
    // Only today's numbers are worth showing; at midnight they start over.
    if (cached && cached.data.date === todayInManila()) return { data: cached.data, stale: new Date(cached.at) };
    return { error: `Couldn't update. ${e.message || "Check your connection."}` };
  }
}

// ---------- Formatting ----------

function peso(value) {
  const whole = Number.isInteger(Math.round(value * 100) / 100);
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(value);
}

function countLabel(count) {
  if (count === 0) return "Nothing logged yet";
  return count === 1 ? "1 expense" : `${count} expenses`;
}

function dayLabel(date) {
  // Noon, so the date is the same in every time zone.
  return new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric" }).format(
    new Date(`${date}T12:00:00`),
  );
}

function timeLabel(when) {
  return new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" }).format(when);
}

function itemTitle(item) {
  return item.note || CATEGORIES[item.category] || item.category || "Expense";
}

// ---------- Widget ----------

function text(stack, value, f, color, { lines = 1, scale = 1 } = {}) {
  const t = stack.addText(value);
  t.font = f;
  t.textColor = color;
  t.lineLimit = lines;
  if (scale < 1) t.minimumScaleFactor = scale;
  return t;
}

function hasSafeToSpend(data) {
  return data.perDay !== null && data.perDay !== undefined && data.left !== null && data.left !== undefined;
}

function paydayLabel(data) {
  if (data.daysLeft === 1) return "Payday tomorrow";
  return `Payday ${shortDay(data.nextPayday)} · ${data.daysLeft} days`;
}

function shortDay(date) {
  return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00`));
}

/**
 * The green block: SAFE TO SPEND TODAY, what's left of today's amount, and
 * what you've spent. Falls back to SPENT TODAY until Home has worked it out.
 */
function addTotal(stack, result, big) {
  const { data, stale } = result;
  const when = stale ? `Offline · as of ${timeLabel(stale)}` : dayLabel(data.date);
  if (!hasSafeToSpend(data)) {
    text(stack, "SPENT TODAY", font.label, SEA_TEXT);
    stack.addSpacer(big ? 6 : null);
    text(stack, peso(data.total), big ? font.huge : font.big, Color.white(), { scale: 0.5 });
    stack.addSpacer(3);
    text(stack, countLabel(data.count), font.sub, SEA_TEXT);
    // perDay is in the answer once step 20 is run: Home just hasn't saved one (or payday passed).
    text(stack, "perDay" in data ? "Open Pong Money to update" : when, font.small, SEA_TEXT, { lines: 2 });
    return;
  }
  const over = data.left < 0;
  text(stack, over ? "OVER TODAY BY" : "SAFE TO SPEND TODAY", font.label, SEA_TEXT);
  stack.addSpacer(big ? 6 : null);
  text(stack, peso(Math.abs(data.left)), big ? font.huge : font.big, over ? new Color("#ffd2c6") : Color.white(), { scale: 0.5 });
  stack.addSpacer(3);
  text(stack, data.total > 0 ? `Spent ${peso(data.total)} of ${peso(data.perDay)}` : `${peso(data.perDay)} a day`, font.sub, SEA_TEXT, { scale: 0.7 });
  text(stack, paydayLabel(data), font.small, SEA_TEXT, { scale: 0.7 });
  // The daily amount is from the last time Home was opened.
  if (stale || data.asOf !== data.date) text(stack, stale ? when : `As of ${shortDay(data.asOf)}`, font.small, SEA_TEXT);
}

function addItems(stack, data, max, withWallet) {
  if (!data.items.length) {
    text(stack, "Tap + in Pong Money when you spend.", font.sub, MUTED, { lines: 2 });
    return;
  }
  for (const item of data.items.slice(0, max)) {
    const row = stack.addStack();
    row.centerAlignContent();
    const left = row.addStack();
    left.layoutVertically();
    text(left, itemTitle(item), font.body, INK);
    if (withWallet) text(left, `${CATEGORIES[item.category] || "Expense"} · ${item.wallet}`, font.small, MUTED);
    row.addSpacer(6);
    text(row, peso(item.amount), font.body, INK);
    stack.addSpacer(withWallet ? 6 : 4);
  }
  const more = data.count - Math.min(max, data.items.length);
  if (more > 0) text(stack, `+${more} more`, font.small, MUTED);
}

function smallWidget(w, result) {
  w.backgroundColor = SEA;
  w.setPadding(14, 14, 14, 14);
  addTotal(w, result, false);
}

function mediumWidget(w, result) {
  w.backgroundColor = PANEL;
  w.setPadding(0, 0, 0, 0);
  const row = w.addStack();

  const left = row.addStack();
  left.layoutVertically();
  left.backgroundColor = SEA;
  left.size = new Size(150, 0);
  left.setPadding(14, 14, 14, 14);
  addTotal(left, result, false);

  const right = row.addStack();
  right.layoutVertically();
  right.setPadding(14, 14, 14, 14);
  const head = right.addStack();
  text(head, "Today", Font.boldRoundedSystemFont(14), INK);
  head.addSpacer();
  right.addSpacer(6);
  addItems(right, result.data, 3, false);
  right.addSpacer();
}

function largeWidget(w, result) {
  w.backgroundColor = PANEL;
  w.setPadding(0, 0, 0, 0);

  const top = w.addStack();
  top.backgroundColor = SEA;
  top.setPadding(16, 16, 16, 16);
  const totals = top.addStack();
  totals.layoutVertically();
  addTotal(totals, result, true);
  top.addSpacer();

  const list = w.addStack();
  list.layoutVertically();
  list.setPadding(14, 16, 14, 16);
  const head = list.addStack();
  text(head, "Today", Font.boldRoundedSystemFont(15), INK);
  head.addSpacer();
  list.addSpacer(8);
  addItems(list, result.data, 5, true);
  w.addSpacer();
}

function messageWidget(w, message) {
  w.backgroundColor = SEA;
  w.setPadding(14, 14, 14, 14);
  text(w, "PONG MONEY", font.label, SEA_TEXT);
  w.addSpacer();
  text(w, message, font.sub, Color.white(), { lines: 5 });
  w.addSpacer();
}

async function buildWidget(setup, family) {
  const w = new ListWidget();
  // Widgets refresh when iOS allows; this asks for every 15 minutes.
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  if (!setup) {
    messageWidget(w, "Open Scriptable and run Pong Money to connect it.");
    return w;
  }
  w.url = `${setup.app}/activity`;

  const result = await load(setup);
  if (result.error) messageWidget(w, result.error);
  else if (family === "small") smallWidget(w, result);
  else if (family === "large") largeWidget(w, result);
  else mediumWidget(w, result);
  return w;
}

// ---------- Run ----------

let setup = readSetup();

if (config.runsInWidget) {
  Script.setWidget(await buildWidget(setup, config.widgetFamily));
} else {
  if (!setup) setup = await askForSetup();
  if (setup) {
    const menu = new Alert();
    menu.title = "Pong Money widget";
    menu.message = "Connected. Add a Scriptable widget to your home screen and pick this script.";
    menu.addAction("Preview small");
    menu.addAction("Preview medium");
    menu.addAction("Preview large");
    menu.addAction("Paste a new setup code");
    menu.addDestructiveAction("Disconnect");
    menu.addCancelAction("Done");
    const choice = await menu.present();
    if (choice >= 0 && choice <= 2) {
      const family = ["small", "medium", "large"][choice];
      const w = await buildWidget(setup, family);
      if (family === "small") await w.presentSmall();
      else if (family === "large") await w.presentLarge();
      else await w.presentMedium();
    } else if (choice === 3) {
      await askForSetup();
    } else if (choice === 4) {
      Keychain.remove(KEYCHAIN);
      if (FileManager.local().fileExists(CACHE)) FileManager.local().remove(CACHE);
    }
  }
}

Script.complete();
