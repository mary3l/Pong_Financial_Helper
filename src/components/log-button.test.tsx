import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logRecurring } from "@/app/plan-actions";
import type { Account } from "@/lib/data";
import type { ForecastItem } from "@/lib/forecast";
import { LogButton } from "./log-button";

// The Server Actions are tested on their own; here they're stand-ins so we can
// see what the payday checklist sends.
vi.mock("@/app/plan-actions", () => ({
  logRecurring: vi.fn(async () => ({})),
  logPlanned: vi.fn(async () => ({})),
  undoPayday: vi.fn(async () => ({})),
}));
vi.mock("@/app/credit-actions", () => ({
  payInstallments: vi.fn(async () => ({})),
  undoInstallment: vi.fn(async () => ({})),
}));
vi.mock("@/app/people-actions", () => ({ settlePerson: vi.fn(async () => ({})) }));
vi.mock("@/app/transaction-actions", () => ({ deleteTransaction: vi.fn(async () => ({})) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const bank = {
  id: "bank",
  name: "Landbank Payroll",
  type: "bank",
  balance: 240,
  currency: "PHP",
  archived: false,
  purpose: "spending",
} as Account;

// ₱14,300 − ₱1,287 − ₱357.50 − ₱200 − ₱412 − ₱1,500 = ₱10,543.50 lands.
const payday: ForecastItem = {
  key: "payday|pay|2026-11-30",
  kind: "payday",
  flow: "in",
  id: "pay",
  name: "Payday",
  amount: 10543.5,
  dueOn: "2026-11-30",
  accountId: "bank",
  category: "salary",
  estimate: true,
  transactionId: null,
  pay: {
    gross: 14300,
    deductions: [
      { name: "GSIS", amount: 1287, kind: "gsis" },
      { name: "PhilHealth", amount: 357.5, kind: "philhealth" },
      { name: "Pag-IBIG", amount: 200, kind: "pagibig" },
      { name: "Withholding tax", amount: 412, kind: "tax" },
      { name: "GSIS loan (3 of 24)", amount: 1500, loanPaymentId: "lp1" },
    ],
  },
};

async function openChecklist(item: ForecastItem = payday) {
  const user = userEvent.setup();
  render(<LogButton item={item} accounts={[bank]} />);
  await user.click(screen.getByRole("button", { name: `Add income: ${item.name}` }));
  return { user, sheet: within(screen.getByRole("dialog")) };
}

const tick = (sheet: ReturnType<typeof within>, name: string) =>
  sheet.getByRole("checkbox", { name: `− ${name}` });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("payday checklist", () => {
  it("lists gross pay and every deduction ticked, and what lands in the bank", async () => {
    const { sheet } = await openChecklist();
    expect(sheet.getByRole("textbox", { name: "Gross pay" })).toHaveValue("14300");
    for (const name of ["GSIS", "PhilHealth", "Pag-IBIG", "Withholding tax", "GSIS loan (3 of 24)"])
      expect(tick(sheet, name)).toBeChecked();
    expect(sheet.getByText("₱10,543.50", { selector: "span.font-extrabold" })).toBeInTheDocument();
    // No "Is the estimate right?" step any more.
    expect(sheet.queryByText("Is the estimate right?")).not.toBeInTheDocument();
  });

  it("unticking one adds it back to what lands", async () => {
    const { user, sheet } = await openChecklist();
    await user.click(tick(sheet, "Withholding tax"));
    expect(sheet.getByRole("button", { name: /Add income · ₱10,955.50/ })).toBeEnabled();
  });

  it("changing a contribution changes what lands, and that's what's logged", async () => {
    const { user, sheet } = await openChecklist();
    const philhealth = sheet.getByRole("textbox", { name: "PhilHealth" });
    await user.clear(philhealth);
    await user.type(philhealth, "400", { skipClick: true });
    await user.click(sheet.getByRole("button", { name: /Add income · ₱10,501$/ }));
    expect(logRecurring).toHaveBeenCalledWith("pay", "2026-11-30", "bank", 10501, ["lp1"]);
  });

  it("an unticked salary loan isn't paid this payday", async () => {
    const { user, sheet } = await openChecklist();
    // Tick only: its amount is the loan's scheduled payment.
    expect(sheet.queryByRole("textbox", { name: "GSIS loan (3 of 24)" })).not.toBeInTheDocument();
    await user.click(tick(sheet, "GSIS loan (3 of 24)"));
    await user.click(sheet.getByRole("button", { name: /Add income · ₱12,043.50/ }));
    expect(logRecurring).toHaveBeenCalledWith("pay", "2026-11-30", "bank", 12043.5, []);
  });

  it("won't log while an amount doesn't add up", async () => {
    const { user, sheet } = await openChecklist();
    const gross = sheet.getByRole("textbox", { name: "Gross pay" });
    await user.clear(gross);
    await user.type(gross, "1000", { skipClick: true });
    expect(sheet.getByRole("button", { name: "Check the amounts" })).toBeDisabled();
    expect(logRecurring).not.toHaveBeenCalled();
  });

  it("a payday without a breakdown still asks whether the estimate is right", async () => {
    const { sheet } = await openChecklist({ ...payday, pay: undefined });
    expect(sheet.getByText("Is the estimate right?")).toBeInTheDocument();
    expect(sheet.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
