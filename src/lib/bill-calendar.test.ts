import { describe, expect, it } from "vitest";
import { billCalendar, formatPesoShort, parseBillsView, payShare } from "@/lib/bill-calendar";
import type { ForecastItem } from "@/lib/forecast";

const TODAY = "2026-11-14";

function bill(name: string, dueOn: string, amount: number, extra: Partial<ForecastItem> = {}): ForecastItem {
  return {
    key: `${name}|${dueOn}`,
    kind: "bill",
    flow: "out",
    id: name,
    name,
    amount,
    dueOn,
    accountId: null,
    category: null,
    estimate: false,
    transactionId: null,
    ...extra,
  };
}

const lenderName = (id: string) => ({ spay: "SPayLater" })[id];

describe("billCalendar", () => {
  // The Nov 30 pay from the screenshot: covers Nov 30 – Dec 14.
  const bills = [
    bill("iPhone Installment", "2026-11-30", 4500),
    bill("SSS contribution", "2026-11-30", 750),
    bill("Pag-IBIG contribution", "2026-11-30", 400),
    bill("Shopee (1 of 3)", "2026-12-05", 3000, { kind: "installment", lenderId: "spay" }),
    bill("Lazada (2 of 6)", "2026-12-05", 3835.37, { kind: "installment", lenderId: "spay" }),
    bill("SLoan 1", "2026-12-05", 3100.72),
  ];
  const cal = billCalendar({ from: "2026-11-30", to: "2026-12-14", payday: "2026-11-30", pay: 11550, bills, today: TODAY, lenderName });

  it("draws every day the pay covers, starting on the right weekday", () => {
    expect(cal.days).toHaveLength(15);
    expect(cal.days[0].date).toBe("2026-11-30");
    expect(cal.days.at(-1)!.date).toBe("2026-12-14");
    // Nov 30, 2026 is a Monday; more than a week starts on Sunday.
    expect(cal.weekStart).toBe(0);
    expect(cal.blanks).toBe(1);
  });

  it("marks the payday and labels the month on the first day and the 1st", () => {
    expect(cal.days[0].payday).toBe(true);
    expect(cal.days.filter((d) => d.payday)).toHaveLength(1);
    expect(cal.days.filter((d) => d.showMonth).map((d) => d.date)).toEqual(["2026-11-30", "2026-12-01"]);
    expect(cal.days[1].dayOfMonth).toBe(1);
  });

  it("puts each bill on its due day, grouped like the list", () => {
    const nov30 = cal.days[0];
    expect(nov30.bills.map((g) => g.name)).toEqual(["iPhone Installment", "SSS contribution", "Pag-IBIG contribution"]);
    expect(nov30.total).toBe(5650);
    expect(nov30.count).toBe(3);

    const dec5 = cal.days.find((d) => d.date === "2026-12-05")!;
    expect(dec5.bills.map((g) => [g.name, g.total, g.count])).toEqual([
      ["SPayLater", 6835.37, 2],
      ["SLoan 1", 3100.72, 1],
    ]);
    expect(dec5.count).toBe(3);
    expect(cal.days.filter((d) => d.count === 0)).toHaveLength(13);
  });

  it("gives the payday the pay's share against its bills, and bill days none", () => {
    // ₱11,550 pay against ₱5,650 due the same day: about two thirds pay.
    expect(cal.days[0].payShare).toBeCloseTo(11550 / 17200);
    expect(cal.days.find((d) => d.date === "2026-12-05")!.payShare).toBe(0);
    expect(cal.days.find((d) => d.date === "2026-12-01")!.payShare).toBeNull();
  });

  it("adds up to the same total as the list", () => {
    const sum = cal.days.reduce((s, d) => s + d.total, 0) + cal.lateTotal;
    expect(Math.round(sum * 100) / 100).toBe(15586.09);
    expect(cal.late).toEqual([]);
  });

  it("keeps late bills off the days, and marks today", () => {
    const before = billCalendar({
      from: TODAY,
      to: "2026-11-29",
      payday: null,
      bills: [bill("Meralco", "2026-11-10", 2100), bill("Water", "2026-11-20", 500), bill("Too late", "2026-12-01", 9)],
      today: TODAY,
      lenderName,
    });
    expect(before.late.map((g) => [g.name, g.late])).toEqual([["Meralco", true]]);
    expect(before.lateTotal).toBe(2100);
    expect(before.days[0].today).toBe(true);
    expect(before.days.some((d) => d.payday)).toBe(false);
    expect(before.days.flatMap((d) => d.bills.map((g) => g.name))).toEqual(["Water"]);
    // Nov 14, 2026 is a Saturday.
    expect(before.weekStart).toBe(0);
    expect(before.blanks).toBe(6);
  });

  it("puts a weekly pay's week in one row, starting on payday", () => {
    // Friday Nov 20 to Thursday Nov 26.
    const week = billCalendar({
      from: "2026-11-20",
      to: "2026-11-26",
      payday: "2026-11-20",
      pay: 4200,
      bills: [bill("Water", "2026-11-23", 500)],
      today: TODAY,
      lenderName,
    });
    expect(week.weekStart).toBe(5);
    expect(week.blanks).toBe(0);
    expect(week.days).toHaveLength(7);
    expect(week.days[0].payShare).toBe(1);
    expect(week.days[3].payShare).toBe(0);

    // A short stretch before the first payday is one row too.
    const short = billCalendar({ from: TODAY, to: "2026-11-19", payday: null, bills: [], today: TODAY, lenderName });
    expect([short.weekStart, short.blanks, short.days.length]).toEqual([6, 0, 6]);
  });

  it("draws nothing for an empty range and caps a long one", () => {
    expect(billCalendar({ from: "2026-12-02", to: "2026-12-01", payday: null, bills: [], today: TODAY, lenderName })).toEqual({
      weekStart: 0,
      blanks: 0,
      days: [],
      late: [],
      lateTotal: 0,
    });
    expect(billCalendar({ from: "2026-01-01", to: "2026-12-31", payday: null, bills: [], today: TODAY, lenderName }).days).toHaveLength(62);
  });
});

describe("payShare", () => {
  it("shrinks as the bills that day grow past the pay", () => {
    expect(payShare(10000, 0)).toBe(1);
    expect(payShare(null, 0)).toBe(1);
    expect(payShare(10000, 10000)).toBe(0.5);
    expect(payShare(10000, 30000)).toBe(0.25);
    expect(payShare(30000, 10000)).toBe(0.75);
    expect(payShare(null, 4500)).toBe(0.5);
    expect(payShare(0, 4500)).toBe(0);
  });
});

describe("formatPesoShort", () => {
  it("shortens to fit a calendar day", () => {
    expect(formatPesoShort(0)).toBe("₱0");
    expect(formatPesoShort(400)).toBe("₱400");
    expect(formatPesoShort(144.59)).toBe("₱145");
    expect(formatPesoShort(999.6)).toBe("₱1k");
    expect(formatPesoShort(4500)).toBe("₱4.5k");
    expect(formatPesoShort(5650)).toBe("₱5.7k");
    expect(formatPesoShort(3000)).toBe("₱3k");
    expect(formatPesoShort(9960)).toBe("₱10k");
    expect(formatPesoShort(17286.34)).toBe("₱17k");
    expect(formatPesoShort(999_600)).toBe("₱1M");
    expect(formatPesoShort(1_250_000)).toBe("₱1.3M");
    expect(formatPesoShort(-4500)).toBe("−₱4.5k");
  });
});

describe("parseBillsView", () => {
  it("only knows List and Calendar", () => {
    expect(parseBillsView("calendar")).toBe("calendar");
    expect(parseBillsView("list")).toBe("list");
    expect(parseBillsView(null)).toBe("list");
    expect(parseBillsView("grid")).toBe("list");
  });
});
