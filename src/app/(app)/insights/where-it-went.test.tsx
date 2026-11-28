import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { monthBreakdown, type SpendTxn } from "@/lib/insights";
import { WhereItWent } from "./where-it-went";

const txn = (occurredOn: string, amount: number, category: string): SpendTxn => ({
  type: "expense",
  amount,
  category,
  subcategory: null,
  occurredOn,
});

const data = monthBreakdown(
  [
    txn("2026-10-04", 6200, "food"),
    txn("2026-10-06", 4350, "transport"),
    txn("2026-10-11", 3100, "bills"),
    txn("2026-11-03", 7000, "food"),
    txn("2026-11-05", 4050, "transport"),
    txn("2026-11-10", 3100, "bills"),
    txn("2026-11-12", 2500, "shopping"),
    txn("2026-11-20", 1750, "fun"),
  ],
  "2026-11-16",
  "2026-11-28",
)!;

function renderCard() {
  return render(
    <WhereItWent
      data={data}
      custom={[]}
      today="2026-11-28"
      activityHref={(c) => `/activity?c=${c}`}
    />,
  );
}

describe("WhereItWent", () => {
  it("ranks the top 3, each against last month", () => {
    renderCard();
    expect(screen.getByRole("heading", { name: "Where it went · Nov" })).toBeInTheDocument();
    // The top 3 are the only links on the card.
    const rows = screen.getAllByRole("link");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(/1.*Food.*₱7,000.*₱800 \(\+13%\) vs Oct/);
    expect(rows[1]).toHaveTextContent(/2.*₱4,050.*₱300 \(−7%\) vs Oct/);
    expect(rows[2]).toHaveTextContent(/3.*₱3,100.*Same as Oct/);
    expect(rows[0]).toHaveAttribute("href", "/activity?c=food");
  });

  it("totals the month against the same days last month", () => {
    renderCard();
    expect(screen.getByText("₱18,400")).toBeInTheDocument();
    expect(screen.getByText("so far")).toBeInTheDocument();
    expect(screen.getByText(/vs Oct 1–28/)).toBeInTheDocument();
  });

  it("names every slice and its share for screen readers", () => {
    renderCard();
    const donut = screen.getByRole("img");
    expect(donut).toHaveAccessibleName(/Food: ₱7,000 \(38%\).*Other: ₱4,250 \(23%\)/);
  });
});
