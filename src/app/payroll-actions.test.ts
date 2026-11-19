import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { SIGNED_OUT_ERROR } from "@/lib/auth";
import { addDays } from "@/lib/dates";
import { defaultDay, type PayrollDay, type PayrollSettings } from "@/lib/payroll";
import { fail, fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";
import {
  removeCutoffChange,
  removePayChange,
  saveContributionAmounts,
  saveCutoff,
  saveCutoffChange,
  savePayrollSettings,
  setContributionDay,
  type CutoffInput,
} from "./payroll-actions";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

let db: FakeSupabase;
function useDb(
  seed?: Parameters<typeof fakeSupabase>[0],
  opts?: Parameters<typeof fakeSupabase>[1],
) {
  db = fakeSupabase(seed, opts);
  vi.mocked(createClient).mockResolvedValue(db.client);
  return db;
}

const FAILED = { error: "Couldn't save that. Please try again." };
const MISSING = { error: "Run step 13 in supabase/SQL_GUIDE.md first, then try again." };

// ₱1,000 a day, 8 hours from 8:00. Contributions are on 22 days: ₱22,000 a month.
const settings: PayrollSettings = {
  dailyRate: 1000,
  hoursPerDay: 8,
  startTime: "08:00",
  overtimeRate: 1.25,
  monthlyBase: null,
  startedOn: null,
  paySss: true,
  payPhilhealth: true,
  payPagibig: true,
  payTax: false,
  sssAmount: null,
  philhealthAmount: null,
  pagibigAmount: null,
};

/** The same settings as saved in payroll_settings. */
const savedRow = {
  user_id: "user-1",
  daily_rate: 1000,
  hours_per_day: 8,
  start_time: "08:00:00",
  overtime_rate: 1.25,
  monthly_base: null,
  started_on: null,
  pay_sss: true,
  pay_philhealth: true,
  pay_pagibig: true,
  pay_tax: false,
  sss_amount: null,
  philhealth_amount: null,
  pagibig_amount: null,
};

// Twice a month on ₱1,000 a day: 22 × ½ days. SSS on a ₱22,000 credit is 15%,
// PhilHealth 5%, Pag-IBIG 4% of ₱10,000.
const TYPICAL_PAYDAY = 11000;
const bill = (key: string, name: string, amount: number, day1 = 30) => ({
  kind: "bill",
  name,
  amount,
  amount_varies: false,
  category: "gov",
  frequency: "monthly",
  day1,
  day2: null,
  payroll_key: key,
});
const SSS = bill("sss", "SSS contribution", 3300);
const PHILHEALTH = bill("philhealth", "PhilHealth contribution", 1100);
const PAGIBIG = bill("pagibig", "Pag-IBIG contribution", 400);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-19T02:00:00Z"));
  useDb();
});
afterEach(() => vi.useRealTimers());

describe("signed out", () => {
  const days = Array.from({ length: 15 }, (_, i) => defaultDay(addDays("2026-11-16", i)));
  it.each<[string, () => Promise<{ error?: string }>]>([
    ["savePayrollSettings", () => savePayrollSettings(settings)],
    [
      "saveCutoffChange",
      () =>
        saveCutoffChange({
          usual: "2026-12-01",
          start: "2026-11-28",
          end: "2026-12-14",
          paidOn: null,
        }),
    ],
    ["removeCutoffChange", () => removeCutoffChange("2026-12-01")],
    ["removePayChange", () => removePayChange("2026-12-01")],
    [
      "saveContributionAmounts",
      () => saveContributionAmounts({ sssAmount: 1, philhealthAmount: null, pagibigAmount: null }),
    ],
    ["saveCutoff", () => saveCutoff({ start: "2026-11-16", days, overtime: [] })],
    ["setContributionDay", () => setContributionDay("sss", 15)],
  ])("%s needs a session", async (_, run) => {
    useDb({ payroll_settings: [savedRow] }, { user: null });
    expect(await run()).toEqual({ error: SIGNED_OUT_ERROR });
    expect(db.writeLog()).toEqual([]);
  });
});

describe("savePayrollSettings", () => {
  it.each<[string, Partial<PayrollSettings>, string]>([
    ["zero daily rate", { dailyRate: 0 }, "Enter your daily rate."],
    ["25 hours a day", { hoursPerDay: 25 }, "Hours per day should be between 1 and 24."],
    ["a bad start time", { startTime: "25:00" }, "Check your start time."],
    ["overtime below 1×", { overtimeRate: 0.5 }, "Overtime rate should be between 1 and 5."],
    [
      "a negative monthly base",
      { monthlyBase: -1 },
      "Check the monthly pay for contributions, or leave it blank.",
    ],
    [
      "a bad start date",
      { startedOn: "2026-02-30" },
      "Check the date you started, or leave it blank.",
    ],
    [
      "cutoff days out of order",
      { cutoffDays: [16, 1] },
      "Pick two different days, 1 to 28, for your cutoffs.",
    ],
    ["weekday 7", { cutoffWeekday: 7 }, "Pick the day your cutoff week starts."],
    ["the 29th", { cutoffMonthDay: 29 }, "Pick a day, 1 to 28, for your cutoff to start."],
    ["a Saturday mode", { saturday: "sometimes" as never }, "Pick what a Saturday is."],
  ])("rejects %s before signing in", async (_, patch, error) => {
    expect(await savePayrollSettings({ ...settings, ...patch })).toEqual({ error });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects a bad payday schedule before signing in", async () => {
    expect(
      await savePayrollSettings(settings, null, { frequency: "twice_monthly", day1: 30, day2: 15 }),
    ).toEqual({ error: "Check your paydays." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("saves your pay the first time and adds the contribution bills", async () => {
    expect(await savePayrollSettings({ ...settings, monthlyBase: 22000.004 })).toEqual({});

    expect(db.writes("payroll_settings", "insert")).toEqual([
      {
        daily_rate: 1000,
        hours_per_day: 8,
        start_time: "08:00",
        overtime_rate: 1.25,
        monthly_base: 22000,
        started_on: null,
        pay_sss: true,
        pay_philhealth: true,
        pay_pagibig: true,
        pay_tax: false,
        updated_at: "2026-11-19T02:00:00.000Z",
        // The usual cutoffs and weekends are saved as null / off.
        cutoff_day1: null,
        cutoff_day2: null,
        cutoff_weekday: null,
        cutoff_month_day: null,
        monthly_pay: null,
        saturday: "off",
        sunday: "off",
      },
    ]);
    expect(db.writes("recurring_items", "insert")).toEqual([SSS, PHILHEALTH, PAGIBIG]);
    // Nothing to clear the first time.
    expect(db.writeLog()).not.toContain("delete payroll_pay_changes");
    // No tax: it's off.
    expect(db.writes("planned_expenses")).toEqual([]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("works out the daily rate from a monthly pay and saves your own cutoff days", async () => {
    expect(
      await savePayrollSettings({
        ...settings,
        dailyRate: 1,
        monthlyPay: 30000,
        cutoffDays: [3, 18],
      }),
    ).toEqual({});
    expect(db.writes("payroll_settings", "insert")[0]).toMatchObject({
      daily_rate: 1363.64, // 30,000 ÷ 22
      monthly_pay: 30000,
      cutoff_day1: 3,
      cutoff_day2: 18,
    });
    // Contributions on ₱30,000: SSS 15% of 30,000, PhilHealth 5%, Pag-IBIG 4% of 10,000.
    expect(db.writes("recurring_items", "insert")).toEqual([
      { ...SSS, amount: 4500 },
      { ...PHILHEALTH, amount: 1500 },
      PAGIBIG,
    ]);
  });

  it("updates your settings, clears pay changes and syncs the bills you have", async () => {
    useDb({
      payroll_settings: [savedRow],
      payroll_pay_changes: [{ id: "pc1", starts_on: "2026-12-01", daily_rate: 1200 }],
      recurring_items: [
        {
          id: "pay",
          kind: "payday",
          frequency: "twice_monthly",
          amount: 9000,
          pay_amounts: [1, 2],
        },
        { id: "sss", kind: "bill", payroll_key: "sss", day1: 15 },
        { id: "ph", kind: "bill", payroll_key: "philhealth", day1: 30 },
      ],
    });
    expect(await savePayrollSettings({ ...settings, payPhilhealth: false })).toEqual({});

    expect(db.writes("payroll_settings", "insert")).toEqual([]);
    expect(db.writes("payroll_settings", "update")).toEqual([
      expect.objectContaining({ daily_rate: 1000, pay_philhealth: false }),
    ]);
    expect(db.table("payroll_pay_changes")).toEqual([]);

    const items = db.table("recurring_items");
    expect(items.find((r) => r.id === "pay")).toMatchObject({
      amount: TYPICAL_PAYDAY,
      amount_varies: true,
      pay_amounts: null,
    });
    // SSS keeps the 15th you picked; PhilHealth is turned off so its bill goes.
    expect(items.find((r) => r.id === "sss")).toMatchObject({ ...SSS, day1: 15 });
    expect(items.find((r) => r.id === "ph")).toBeUndefined();
    expect(db.writes("recurring_items", "insert")).toEqual([PAGIBIG]);
  });

  it("adds a weekly payday and pays a typical week", async () => {
    expect(
      await savePayrollSettings(settings, null, { frequency: "weekly", day1: 5, day2: null }),
    ).toEqual({});
    expect(db.writes("recurring_items", "insert")[0]).toEqual({
      kind: "payday",
      name: "Payday",
      amount_varies: true,
      frequency: "weekly",
      day1: 5,
      day2: null,
      pay_weeks: null,
      pay_amounts: null,
      pay_weekdays: null,
    });
    // Five work days a week.
    expect(db.table("recurring_items").find((r) => r.kind === "payday")).toMatchObject({
      amount: 5000,
    });
  });

  it("asks for migration 23 before daily paydays", async () => {
    db.respond((q) =>
      q.table === "recurring_items" && q.op === "insert" && "pay_weekdays" in (q.payload as object)
        ? fail("PGRST204", "no column")
        : undefined,
    );
    expect(
      await savePayrollSettings(settings, null, { frequency: "daily", day1: 1, day2: null }),
    ).toEqual({ error: "To get paid every work day, run step 23 in supabase/SQL_GUIDE.md first." });
    expect(db.writes("payroll_settings")).toEqual([]);
  });

  it("saves without the weekend and monthly pay columns before migration 23", async () => {
    db.respond((q) =>
      q.table === "payroll_settings" && q.op === "insert" && "saturday" in (q.payload as object)
        ? fail("PGRST204", "no column")
        : undefined,
    );
    expect(await savePayrollSettings(settings)).toEqual({});
    const [first, second] = db.writes("payroll_settings", "insert") as Record<string, unknown>[];
    expect(first).toHaveProperty("saturday", "off");
    expect(second).not.toHaveProperty("saturday");
    expect(second).not.toHaveProperty("monthly_pay");
    expect(second).toMatchObject({ cutoff_day1: null, cutoff_weekday: null });
    expect(db.table("payroll_settings")).toHaveLength(1);
  });

  it("won't drop working weekends before migration 23", async () => {
    db.respond((q) =>
      q.table === "payroll_settings" && q.op === "insert"
        ? fail("PGRST204", "no column")
        : undefined,
    );
    expect(await savePayrollSettings({ ...settings, saturday: "regular" })).toEqual({
      error: "To work weekends, run step 23 in supabase/SQL_GUIDE.md first.",
    });
    expect(db.writes("payroll_settings", "insert")).toHaveLength(1);
  });

  it("asks for migration 13 when there's no payroll table", async () => {
    db.respond((q) => (q.table === "payroll_settings" ? fail("PGRST205", "no table") : undefined));
    expect(await savePayrollSettings(settings)).toEqual(MISSING);
    expect(db.writeLog()).toEqual([]);
  });

  it("fails when a contribution bill can't be saved", async () => {
    db.respond((q) => (q.table === "recurring_items" && q.op === "insert" ? fail() : undefined));
    expect(await savePayrollSettings(settings)).toEqual(FAILED);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("adds this year's income tax when you pay it", async () => {
    expect(await savePayrollSettings({ ...settings, payTax: true })).toEqual({});
    // 2026 has 261 weekdays: ₱261,000, so 8% of ₱11,000 on the annual return.
    // The quarters before and 2027's first three come to ₱0, so they're left out.
    expect(db.writes("planned_expenses", "insert")).toEqual([
      {
        type: "expense",
        name: "Income tax 8%, annual 2026",
        amount: 880,
        category: "gov",
        due_on: "2027-04-15",
        payroll_key: "2026-Q4",
      },
    ]);
  });

  it("drops upcoming unpaid tax when you stop paying it, keeping paid and late ones", async () => {
    useDb({
      payroll_settings: [{ ...savedRow, pay_tax: true }],
      planned_expenses: [
        { id: "q4", payroll_key: "2026-Q4", due_on: "2027-04-15", transaction_id: null },
        { id: "paid", payroll_key: "2027-Q1", due_on: "2027-05-15", transaction_id: "t1" },
        { id: "late", payroll_key: "2026-Q3", due_on: "2026-11-15", transaction_id: null },
      ],
    });
    expect(await savePayrollSettings(settings)).toEqual({});
    expect(db.table("planned_expenses").map((r) => r.id)).toEqual(["paid", "late"]);
  });

  describe("from a cutoff on", () => {
    beforeEach(() => {
      useDb({ payroll_settings: [savedRow] });
    });

    it("saves a raise as a pay change and leaves the rate in your settings", async () => {
      expect(await savePayrollSettings({ ...settings, dailyRate: 1200 }, "2026-12-01")).toEqual({});
      const upsert = db.queries.find(
        (q) => q.table === "payroll_pay_changes" && q.op === "upsert",
      )!;
      expect(upsert.payload).toEqual({
        starts_on: "2026-12-01",
        daily_rate: 1200,
        hours_per_day: 8,
        start_time: "08:00",
        overtime_rate: 1.25,
      });
      expect(upsert.options).toEqual({ onConflict: "user_id,starts_on" });
      const [update] = db.writes("payroll_settings", "update") as Record<string, unknown>[];
      expect(update).not.toHaveProperty("daily_rate");
      expect(db.table("payroll_settings")[0].daily_rate).toBe(1000);
    });

    it("drops the change when the pay is the same as the cutoff before", async () => {
      useDb({
        payroll_settings: [savedRow],
        payroll_pay_changes: [{ id: "pc1", starts_on: "2026-12-01", daily_rate: 1200 }],
      });
      expect(await savePayrollSettings(settings, "2026-12-01")).toEqual({});
      expect(db.writes("payroll_pay_changes")).toEqual([]);
      expect(db.table("payroll_pay_changes")).toEqual([]);
    });

    it("only takes the first day of a cutoff", async () => {
      expect(await savePayrollSettings(settings, "2026-12-02")).toEqual({
        error: "Pick a cutoff.",
      });
      expect(db.writeLog()).toEqual([]);
    });

    it("asks for migration 21 when there's no pay changes table", async () => {
      db.respond((q) =>
        q.table === "payroll_pay_changes" && q.op === "upsert"
          ? fail("PGRST205", "no table")
          : undefined,
      );
      expect(await savePayrollSettings({ ...settings, dailyRate: 1200 }, "2026-12-01")).toEqual({
        error: "To change your pay from one cutoff on, run step 21 in supabase/SQL_GUIDE.md first.",
      });
    });

    // Suspected bug: the "from a cutoff on" path writes the monthly_pay column
    // (partColumns' v23) onto payroll_settings, the rate every cutoff before
    // the first change uses. So moving to a monthly rate from December also
    // puts every earlier cutoff on that monthly pay (with the old daily rate).
    it.fails("keeps the cutoffs before it on pay per day when a monthly rate starts", async () => {
      expect(await savePayrollSettings({ ...settings, monthlyPay: 30000 }, "2026-12-01")).toEqual(
        {},
      );
      expect(db.table("payroll_pay_changes")[0]).toMatchObject({ monthly_pay: 30000 });
      expect(db.table("payroll_settings")[0].monthly_pay ?? null).toBeNull();
    });
  });
});

describe("saveCutoffChange", () => {
  const change = { usual: "2026-12-01", start: "2026-11-28", end: "2026-12-14", paidOn: null };

  it("rejects bad dates before signing in", async () => {
    expect(await saveCutoffChange({ ...change, end: "2026-12-32" })).toEqual({
      error: "Pick the dates.",
    });
    expect(await saveCutoffChange({ ...change, paidOn: "soon" })).toEqual({
      error: "Check the day it's paid.",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects a change that isn't a cutoff or ends before it starts", async () => {
    useDb({ payroll_settings: [savedRow] });
    expect(await saveCutoffChange({ ...change, usual: "2026-12-02" })).toEqual({
      error: "Pick a cutoff.",
    });
    expect(await saveCutoffChange({ ...change, end: "2026-11-27" })).toEqual({
      error: "The cutoff can't end before it starts.",
    });
    expect(db.writeLog()).toEqual([]);
  });

  it("saves the cutoff's new dates", async () => {
    useDb({ payroll_settings: [savedRow] });
    expect(await saveCutoffChange({ ...change, paidOn: "2026-12-20" })).toEqual({});
    const upsert = db.queries.find((q) => q.op === "upsert")!;
    expect(upsert.table).toBe("payroll_cutoff_changes");
    expect(upsert.payload).toEqual({
      usual_start: "2026-12-01",
      starts_on: "2026-11-28",
      ends_on: "2026-12-14",
      paid_on: "2026-12-20",
    });
    expect(upsert.options).toEqual({ onConflict: "user_id,usual_start" });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("asks for migration 23 when there's no cutoff changes table", async () => {
    useDb({ payroll_settings: [savedRow] });
    db.respond((q) =>
      q.table === "payroll_cutoff_changes" && q.op === "upsert"
        ? fail("PGRST205", "no table")
        : undefined,
    );
    expect(await saveCutoffChange(change)).toEqual({
      error: "To change a cutoff's dates, run step 23 in supabase/SQL_GUIDE.md first.",
    });
  });
});

describe("removeCutoffChange", () => {
  it("rejects a bad date before signing in", async () => {
    expect(await removeCutoffChange("2026-13-01")).toEqual({ error: "Pick a cutoff." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("deletes the change for that cutoff only", async () => {
    useDb({
      payroll_settings: [savedRow],
      payroll_cutoff_changes: [
        { id: "a", usual_start: "2026-12-01" },
        { id: "b", usual_start: "2026-12-16" },
      ],
    });
    expect(await removeCutoffChange("2026-12-01")).toEqual({});
    expect(db.table("payroll_cutoff_changes").map((r) => r.id)).toEqual(["b"]);
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe("removePayChange", () => {
  it("rejects a bad date before signing in", async () => {
    expect(await removePayChange("December")).toEqual({ error: "Pick a pay change." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("deletes the change from that cutoff", async () => {
    useDb({
      payroll_settings: [savedRow],
      payroll_pay_changes: [
        { id: "a", starts_on: "2026-12-01", daily_rate: 1200 },
        { id: "b", starts_on: "2027-01-01", daily_rate: 1300 },
      ],
    });
    expect(await removePayChange("2026-12-01")).toEqual({});
    expect(db.table("payroll_pay_changes").map((r) => r.id)).toEqual(["b"]);
  });

  it("asks for migration 21, and fails on other errors", async () => {
    db.respond((q) =>
      q.table === "payroll_pay_changes" ? fail("PGRST205", "no table") : undefined,
    );
    expect((await removePayChange("2026-12-01")).error).toMatch(/run step 21/);
    useDb();
    db.respond((q) => (q.table === "payroll_pay_changes" ? fail() : undefined));
    expect(await removePayChange("2026-12-01")).toEqual(FAILED);
  });
});

describe("saveContributionAmounts", () => {
  it.each([0, -5, Number.NaN, 1e15])("rejects %s before signing in", async (amount) => {
    expect(
      await saveContributionAmounts({
        sssAmount: null,
        philhealthAmount: amount,
        pagibigAmount: null,
      }),
    ).toEqual({ error: "Enter an amount above ₱0, or leave it blank to use the calculated one." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("saves your own amounts and puts them on the bills", async () => {
    useDb({ payroll_settings: [savedRow] });
    expect(
      await saveContributionAmounts({
        sssAmount: 1234.567,
        philhealthAmount: null,
        pagibigAmount: 200,
      }),
    ).toEqual({});
    expect(db.writes("payroll_settings", "update")).toEqual([
      {
        sss_amount: 1234.57,
        philhealth_amount: null,
        pagibig_amount: 200,
        updated_at: "2026-11-19T02:00:00.000Z",
      },
    ]);
    expect(db.writes("recurring_items", "insert")).toEqual([
      { ...SSS, amount: 1234.57 },
      PHILHEALTH,
      { ...PAGIBIG, amount: 200 },
    ]);
  });

  it("needs your pay set up first", async () => {
    expect(
      await saveContributionAmounts({
        sssAmount: 100,
        philhealthAmount: null,
        pagibigAmount: null,
      }),
    ).toEqual({ error: "Set up your pay first." });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("asks for migration 18 when the amount columns are missing", async () => {
    db.respond((q) => (q.op === "update" ? fail("42703", "no column") : undefined));
    expect(
      await saveContributionAmounts({
        sssAmount: 100,
        philhealthAmount: null,
        pagibigAmount: null,
      }),
    ).toEqual({ error: "To use your own amounts, run step 18 in supabase/SQL_GUIDE.md first." });
  });
});

describe("saveCutoff", () => {
  // Nov 16–30, 2026: Monday the 16th to Monday the 30th.
  const days: PayrollDay[] = Array.from({ length: 15 }, (_, i) =>
    defaultDay(addDays("2026-11-16", i)),
  );
  const input: CutoffInput = { start: "2026-11-16", days, overtime: [] };
  const withDay = (i: number, patch: Partial<PayrollDay>) =>
    days.map((d, j) => (j === i ? { ...d, ...patch } : d));

  beforeEach(() => {
    useDb({ payroll_settings: [savedRow] });
  });

  it.each<[string, Partial<CutoffInput>, string]>([
    ["a day that isn't a cutoff start", { start: "2026-11-17" }, "Pick a cutoff."],
    ["a missing day", { days: days.slice(1) }, "Reload the page and try again."],
    [
      "a bad status",
      { days: withDay(0, { status: "away" as never }) },
      "Pick worked, leave or off for each day.",
    ],
    [
      "leave without a type",
      { days: withDay(0, { status: "leave" }) },
      "Pick sick or personal leave for each leave day.",
    ],
    [
      "a long leave reason",
      { days: withDay(0, { status: "leave", leaveType: "sick", note: "x".repeat(101) }) },
      "Keep leave reasons to 100 characters.",
    ],
    ["a bad time in", { days: withDay(0, { timeIn: "8am" }) }, "Check your time in."],
    [
      "overtime outside the cutoff",
      { overtime: [{ date: "2026-12-01", start: "17:00", end: "19:00" }] },
      "Overtime must be on a day in this cutoff.",
    ],
    [
      "overtime that ends when it starts",
      { overtime: [{ date: "2026-11-16", start: "17:00", end: "17:00" }] },
      "Overtime needs an end time after its start.",
    ],
  ])("rejects %s", async (_, patch, error) => {
    expect(await saveCutoff({ ...input, ...patch })).toEqual({ error });
    expect(db.writeLog()).toEqual([]);
  });

  it("saves every day and replaces the cutoff's overtime", async () => {
    useDb({
      payroll_settings: [savedRow],
      payroll_overtime: [
        { id: "in", work_date: "2026-11-20", starts_at: "17:00", ends_at: "18:00" },
        { id: "before", work_date: "2026-11-15", starts_at: "17:00", ends_at: "18:00" },
        { id: "after", work_date: "2026-12-01", starts_at: "17:00", ends_at: "18:00" },
      ],
    });
    const edited = days.map((d, i) =>
      i === 0
        ? { ...d, timeIn: "08:15" }
        : i === 1
          ? {
              ...d,
              status: "leave" as const,
              leaveType: "sick" as const,
              note: "  flu \n day ",
              timeIn: "09:00",
            }
          : i === 2
            ? {
                ...d,
                status: "off" as const,
                leaveType: "sick" as const,
                note: "ignored",
                timeIn: "09:00",
              }
            : d,
    );
    expect(
      await saveCutoff({
        ...input,
        days: edited,
        overtime: [{ date: "2026-11-18", start: "17:00", end: "20:00" }],
      }),
    ).toEqual({});

    const upsert = db.queries.find((q) => q.op === "upsert")!;
    expect(upsert.table).toBe("payroll_days");
    expect(upsert.options).toEqual({ onConflict: "user_id,work_date" });
    const saved = upsert.payload as Record<string, unknown>[];
    expect(saved).toHaveLength(15);
    expect(saved.slice(0, 3)).toEqual([
      { work_date: "2026-11-16", status: "worked", leave_type: null, note: null, time_in: "08:15" },
      {
        work_date: "2026-11-17",
        status: "leave",
        leave_type: "sick",
        note: "flu day",
        time_in: null,
      },
      { work_date: "2026-11-18", status: "off", leave_type: null, note: null, time_in: null },
    ]);
    expect(saved[5]).toMatchObject({ work_date: "2026-11-21", status: "off" }); // Saturday

    expect(db.table("payroll_overtime").map((r) => r.id ?? r.work_date)).toEqual([
      "before",
      "after",
      expect.stringMatching(/^payroll_overtime-/),
    ]);
    expect(db.writes("payroll_overtime", "insert")).toEqual([
      [{ work_date: "2026-11-18", starts_at: "17:00", ends_at: "20:00" }],
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("asks for migration 13 when there's no days table", async () => {
    db.respond((q) => (q.table === "payroll_days" ? fail("PGRST205", "no table") : undefined));
    expect(await saveCutoff(input)).toEqual(MISSING);
    expect(db.writes("payroll_overtime")).toEqual([]);
  });
});

describe("setContributionDay", () => {
  it("rejects an unknown contribution or day before signing in", async () => {
    expect(await setContributionDay("tax" as never, 15)).toEqual({ error: "Pick a contribution." });
    expect(await setContributionDay("sss", 0)).toEqual({ error: "Pick a day." });
    expect(await setContributionDay("sss", 15.5)).toEqual({ error: "Pick a day." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("moves the monthly bill to that day", async () => {
    useDb({
      recurring_items: [
        { id: "sss", payroll_key: "sss", frequency: "monthly", day1: 30 },
        { id: "ph", payroll_key: "philhealth", frequency: "monthly", day1: 30 },
      ],
    });
    expect(await setContributionDay("sss", 15)).toEqual({});
    const update = db.queries.find((q) => q.op === "update")!;
    expect(update.payload).toEqual({ day1: 15 });
    expect(update.filters).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["payroll_key", "sss"] },
        { method: "eq", args: ["frequency", "monthly"] },
      ]),
    );
    expect(db.table("recurring_items").map((r) => r.day1)).toEqual([15, 30]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("needs the bill saved first", async () => {
    expect(await setContributionDay("pagibig", 15)).toEqual({
      error: "Save your pay first, so the bill is in Money going out.",
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
