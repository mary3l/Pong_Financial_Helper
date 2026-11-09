import { describe, expect, it } from "vitest";
import { scheduledItems, type ForecastItem, type ScheduleInputs } from "@/lib/forecast";
import { groupByPayee, paymentsByPeriod } from "@/lib/pay-periods";

const TODAY = "2026-11-08";

const payday = {
  id: "pay",
  kind: "payday" as const,
  name: "Payday",
  amount: 10000,
  amountVaries: false,
  accountId: "bank",
  category: null,
  frequency: "twice_monthly" as const,
  day1: 15,
  day2: 30,
  endsOn: null,
};

const iphone = { ...payday, id: "iphone", kind: "bill" as const, name: "iPhone", amount: 4500, frequency: "monthly" as const, day1: 30, day2: null };

function loan(id: string, lender: string, months: number, firstSeq: number, dates: string[], amount: number) {
  return dates.map((dueOn, i) => ({
    id: `${id}-${i}`,
    name: `${id} (${firstSeq + i} of ${months})`,
    dueOn,
    amount,
    payFromAccountId: "bank",
    transactionId: null,
    lenderAccountId: lender,
    seq: firstSeq + i,
    months,
  }));
}

function items(extra: Partial<ScheduleInputs> = {}) {
  return scheduledItems(
    {
      recurring: [payday, iphone],
      billPayments: [],
      planned: [],
      installments: [
        ...loan("SLoan", "sloan", 3, 1, ["2026-11-22", "2026-12-22", "2027-01-22"], 944.59),
        ...loan("Atome bill", "atome", 1, 1, ["2026-11-16"], 6456.12),
        ...loan("SPayLater bill", "spay", 1, 1, ["2026-12-05"], 5885.65),
      ],
      ...extra,
    },
    TODAY,
    "2027-03-01",
  );
}

describe("payments by pay period", () => {
  it("groups BNPL and loan payments into months from payday, against the pay in each", () => {
    const periods = paymentsByPeriod({ items: items(), today: TODAY, nextPayday: "2026-11-15" });
    expect(periods.map((p) => [p.from, p.to, p.total, p.income])).toEqual([
      ["2026-11-15", "2026-12-14", 13286.36, 20000],
      ["2026-12-15", "2027-01-14", 944.59, 20000],
      ["2027-01-15", "2027-02-14", 944.59, 20000],
    ]);
    expect(periods[0].share).toBeCloseTo(0.664, 3);
    // Bills like the iPhone aren't BNPL or loan payments here.
    expect(periods[0].payments.map((p) => p.name)).toEqual(["Atome bill (1 of 1)", "SLoan (1 of 3)", "SPayLater bill (1 of 1)"]);
  });

  it("adds up each lender and marks last payments", () => {
    const [first, , third] = paymentsByPeriod({ items: items(), today: TODAY, nextPayday: "2026-11-15" });
    expect(first.byLender).toEqual([
      { lenderId: "atome", total: 6456.12 },
      { lenderId: "spay", total: 5885.65 },
      { lenderId: "sloan", total: 944.59 },
    ]);
    expect(third.payments[0]).toMatchObject({ name: "SLoan (3 of 3)", lastPayment: true });
    expect(first.payments.find((p) => p.lenderId === "sloan")!.lastPayment).toBe(false);
    // A one-payment monthly bill isn't a "last payment".
    expect(first.payments.find((p) => p.lenderId === "atome")!.lastPayment).toBe(false);
  });

  it("gives the days before payday their own period when something's due, with late ones in it", () => {
    const periods = paymentsByPeriod({
      items: items({ installments: [...loan("GLoan", "gloan", 9, 7, ["2026-10-27", "2026-11-10"], 528.54)] }),
      today: TODAY,
      nextPayday: "2026-11-15",
    });
    expect(periods).toHaveLength(4);
    expect(periods[0]).toMatchObject({ from: TODAY, to: "2026-11-14", total: 1057.08, income: 0, share: null });
  });

  it("starts from today without a payday", () => {
    const periods = paymentsByPeriod({ items: items(), today: TODAY, nextPayday: null });
    expect(periods.map((p) => [p.from, p.to])).toEqual([
      ["2026-11-08", "2026-12-07"],
      ["2026-12-08", "2027-01-07"],
      ["2027-01-08", "2027-02-07"],
    ]);
  });
});

describe("payments by where they go", () => {
  const at = (name: string, dueOn: string, amount: number, lenderId: string | null, kind: ForecastItem["kind"] = "installment"): ForecastItem => ({
    key: `${name}|${dueOn}`,
    kind,
    flow: "out",
    id: name,
    name,
    amount,
    dueOn,
    accountId: null,
    category: null,
    estimate: false,
    transactionId: null,
    lenderId,
  });

  it("puts each lender's installments together and keeps other bills apart, soonest first", () => {
    const names: Record<string, string> = { atome: "Atome", sloan: "SLoan" };
    const groups = groupByPayee(
      [
        at("SLoan (1 of 3)", "2026-11-22", 944.59, "sloan"),
        at("Shawarma", "2026-11-16", 115, "atome"),
        at("October Billing", "2026-11-16", 6302.12, "atome"),
        at("SSS contribution", "2026-11-30", 750, null, "bill"),
        at("Hairbox", "2026-11-05", 456.12, "atome"),
      ],
      (id) => names[id],
      "2026-11-09",
    );
    expect(groups.map((g) => [g.name, g.total, g.count, g.firstDue, g.late])).toEqual([
      ["Atome", 6873.24, 3, "2026-11-05", true],
      ["SLoan", 944.59, 1, "2026-11-22", false],
      ["SSS contribution", 750, 1, "2026-11-30", false],
    ]);
  });
});
