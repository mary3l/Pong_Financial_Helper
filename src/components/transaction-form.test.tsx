import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteTransaction, saveBnplPurchase, saveTransaction } from "@/app/transaction-actions";
import type { Account, Template, Transaction } from "@/lib/data";
import { TransactionForm } from "./transaction-form";

// The Server Actions are tested on their own (src/app/*-actions.test.ts);
// here they're stand-ins so we can see what the form sends.
vi.mock("@/app/transaction-actions", () => ({
  saveTransaction: vi.fn(async () => ({})),
  saveBnplPurchase: vi.fn(async () => ({})),
  deleteTransaction: vi.fn(async () => ({})),
}));
vi.mock("@/app/people-actions", () => ({ saveSplit: vi.fn(async () => ({})) }));
const router = { back: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function account(id: string, name: string, patch: Partial<Account> = {}): Account {
  return {
    id,
    name,
    type: "cash",
    startingBalance: 0,
    balance: 1000,
    creditLimit: null,
    dueDay: null,
    cutoffDay: null,
    archived: false,
    purpose: "spending",
    interestRate: null,
    interestSince: null,
    interestPayout: "daily",
    goalAmount: null,
    goalDate: null,
    currency: "PHP",
    fxRate: null,
    boughtAt: null,
    fxAsOf: null,
    maturesOn: null,
    ...patch,
  };
}

const cash = account("cash", "Cash");
const gcash = account("gcash", "GCash", { type: "ewallet" });
const spl = account("spl", "SPayLater", { type: "credit_line", dueDay: 5, cutoffDay: 25 });
const usd = account("usd", "Dollars", { type: "bank", currency: "USD", fxRate: 58 });

const TODAY = "2026-11-19";

function renderForm(props: Partial<React.ComponentProps<typeof TransactionForm>> = {}) {
  const user = userEvent.setup();
  render(
    <TransactionForm
      accounts={[cash, gcash, spl, usd]}
      templates={[]}
      today={TODAY}
      mode="page"
      closeHref="/activity"
      {...props}
    />,
  );
  return user;
}

/** The phone and desktop layouts are both in the DOM (CSS picks one); take the first. */
const first = (name: string | RegExp) => screen.getAllByRole("button", { name })[0];
const submitButton = () =>
  screen.getAllByRole("button").find((b) => b.getAttribute("type") === "submit")!;

/** Picks a button inside the group labelled `group` ("Pay with", "Category", "To"…). */
async function pick(
  user: ReturnType<typeof userEvent.setup>,
  group: string,
  name: string | RegExp,
) {
  await user.click(
    within(screen.getByRole("group", { name: group })).getByRole("button", { name }),
  );
}

const describeIt = (user: ReturnType<typeof userEvent.setup>, text: string) =>
  user.type(screen.getByLabelText(/^Description/), text);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TransactionForm", () => {
  it("asks for a wallet first when there are none", () => {
    renderForm({ accounts: [] });
    expect(screen.getByText(/Add a wallet first/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Enter/ })).not.toBeInTheDocument();
  });

  it("won't save without an amount", async () => {
    const user = renderForm();
    expect(submitButton()).toHaveTextContent("Enter an amount");
    await user.click(submitButton());
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an amount above ₱0.");
    expect(saveTransaction).not.toHaveBeenCalled();
  });

  it("guesses nothing: Save names what's missing, in order", async () => {
    const user = renderForm();
    await user.keyboard("150");
    expect(submitButton()).toHaveTextContent("Add a description");
    expect(submitButton()).toBeDisabled();
    await describeIt(user, "Lunch");
    expect(submitButton()).toHaveTextContent("Pick a category");
    await pick(user, "Category", /Food/);
    expect(submitButton()).toHaveTextContent("Pick a wallet");
    // No wallet is picked for you.
    const payWith = within(screen.getByRole("group", { name: "Pay with" }));
    for (const b of payWith.getAllByRole("button"))
      expect(b).toHaveAttribute("aria-pressed", "false");
    await pick(user, "Pay with", "Cash");
    expect(submitButton()).toHaveTextContent("Enter ₱150");
    expect(submitButton()).toBeEnabled();
  });

  it("groups Pay with into wallets, savings, credit cards and BNPL", () => {
    renderForm({
      accounts: [
        cash,
        account("emergency", "Emergency Savings", { type: "bank", purpose: "emergency" }),
        spl,
      ],
    });
    const payWith = within(screen.getByRole("group", { name: "Pay with" }));
    expect(payWith.getByText("Wallets")).toBeInTheDocument();
    expect(payWith.getByText("Savings")).toBeInTheDocument();
    expect(payWith.getByText("BNPL")).toBeInTheDocument();
  });

  it("types the amount from the keyboard and saves a Food expense from the wallet you pick", async () => {
    const user = renderForm();
    await user.keyboard("120+30");
    await describeIt(user, "Lunch");
    await pick(user, "Category", /Food/);
    await pick(user, "Pay with", "Cash");
    expect(submitButton()).toHaveTextContent("Enter ₱150");
    await user.click(submitButton());

    expect(saveTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "expense",
        amount: 150,
        accountId: "cash",
        toAccountId: null,
        category: "food",
        note: "Lunch",
        occurredOn: TODAY,
      }),
      undefined,
      undefined,
    );
    expect(router.push).toHaveBeenCalledWith("/activity");
  });

  it("saves with the keypad buttons, the picked category and wallet", async () => {
    const user = renderForm();
    for (const k of ["4", "5", "0"]) await user.click(first(k));
    await user.click(
      within(screen.getByRole("group", { name: "Category" })).getByRole("button", {
        name: /Transpo/,
      }),
    );
    await user.click(
      within(screen.getByRole("group", { name: "Pay with" })).getByRole("button", {
        name: "GCash",
      }),
    );
    await describeIt(user, "  Grab home ");
    await user.click(submitButton());

    expect(saveTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 450,
        category: "transport",
        accountId: "gcash",
        note: "  Grab home ",
      }),
      undefined,
      undefined,
    );
  });

  it("shows the server's error and stays open", async () => {
    vi.mocked(saveTransaction).mockResolvedValueOnce({
      error: "Couldn't save that. Please try again.",
    });
    const user = renderForm();
    await user.keyboard("99");
    await describeIt(user, "Lunch");
    await pick(user, "Category", /Food/);
    await pick(user, "Pay with", "Cash");
    await user.click(submitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save that.");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("refuses to divide by zero", async () => {
    const user = renderForm();
    await user.keyboard("5/0{Enter}");
    expect(screen.getAllByText("Can't divide by 0").length).toBeGreaterThan(0);
    expect(saveTransaction).not.toHaveBeenCalled();
  });

  it("lists only wallets you receive into for income", async () => {
    const user = renderForm();
    await user.click(first("Income"));
    const into = within(screen.getByRole("group", { name: "Received in" }));
    expect(into.queryByRole("button", { name: "SPayLater" })).not.toBeInTheDocument();
    expect(into.queryByRole("button", { name: "Dollars" })).toBeInTheDocument();
    await user.keyboard("18000");
    await describeIt(user, "Payday");
    await pick(user, "Category", /Salary/);
    expect(submitButton()).toHaveTextContent("Pick where it went");
    await pick(user, "Received in", "GCash");
    await user.click(submitButton());
    expect(saveTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "income",
        category: "salary",
        amount: 18000,
        accountId: "gcash",
      }),
      undefined,
      undefined,
    );
  });

  it("moves money between two different wallets, with no category", async () => {
    const user = renderForm();
    await user.click(first("Transfer"));
    expect(screen.queryByRole("group", { name: "Category" })).not.toBeInTheDocument();
    await pick(user, "From", "Cash");
    const to = within(screen.getByRole("group", { name: "To" }));
    expect(to.queryByRole("button", { name: "Cash" })).not.toBeInTheDocument();
    await user.click(to.getByRole("button", { name: "GCash" }));
    await user.keyboard("500");
    await user.click(submitButton());
    expect(saveTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "transfer",
        accountId: "cash",
        toAccountId: "gcash",
        category: null,
      }),
      undefined,
      undefined,
    );
  });

  it("works out the dollars that land at the wallet's rate", async () => {
    const user = renderForm();
    await user.click(first("Transfer"));
    await pick(user, "From", "Cash");
    await user.click(
      within(screen.getByRole("group", { name: "To" })).getByRole("button", { name: "Dollars" }),
    );
    await user.keyboard("5800");
    await user.click(submitButton());
    expect(saveTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ toAccountId: "usd", amount: 5800, toAmount: 100 }),
      undefined,
      undefined,
    );
  });

  it("paying with a BNPL credit line saves a payment plan", async () => {
    const user = renderForm();
    await user.click(
      within(screen.getByRole("group", { name: "Pay with" })).getByRole("button", {
        name: "SPayLater",
      }),
    );
    await user.keyboard("3000");
    await describeIt(user, "Shoes");
    await pick(user, "Category", /Shopping/);
    await user.click(submitButton());
    expect(saveTransaction).not.toHaveBeenCalled();
    // Which wallet pays each bill isn't guessed either: any, picked when paying.
    expect(saveBnplPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "spl", amount: 3000, note: "Shoes" }),
      expect.objectContaining({ months: 3, ratePerMonth: 0, payFromAccountId: null }),
    );
  });

  it("puts a credit card purchase on the statement in full by default", async () => {
    const bpi = account("bpi", "BPI", {
      type: "credit_line",
      creditKind: "card",
      dueDay: 20,
      cutoffDay: 5,
    });
    const user = renderForm({ accounts: [cash, bpi, spl] });
    const payWith = within(screen.getByRole("group", { name: "Pay with" }));
    expect(payWith.getByText("Credit cards")).toBeInTheDocument();
    await pick(user, "Pay with", "BPI");
    const plan = within(screen.getByRole("group", { name: "Payment plan" }));
    expect(plan.getByRole("button", { name: "Straight" })).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("2500");
    await describeIt(user, "Groceries run");
    await pick(user, "Category", /Groceries/);
    await user.click(submitButton());
    expect(saveBnplPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "bpi", amount: 2500 }),
      expect.objectContaining({ months: 1, ratePerMonth: 0 }),
    );
  });

  it("logs a scheduled payday's link only for the type it was opened with", async () => {
    const prefill = {
      type: "income" as const,
      amount: 15000,
      category: "salary",
      accountId: "gcash",
      note: "Payday",
      link: "pay-1|2026-11-15",
    };
    const user = renderForm({ prefill });
    expect(submitButton()).toHaveTextContent("Enter ₱15,000");
    await user.click(submitButton());
    expect(saveTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "income", accountId: "gcash", note: "Payday" }),
      undefined,
      "pay-1|2026-11-15",
    );
  });

  describe("editing", () => {
    const txn: Transaction = {
      id: "t1",
      type: "expense",
      amount: 85,
      accountId: "gcash",
      toAccountId: null,
      toAmount: null,
      category: "load",
      subcategory: null,
      note: "Globe",
      occurredOn: "2026-11-18",
      createdAt: null,
      occurredTime: "09:15",
      splitId: null,
    };

    it("starts from the saved transaction and updates it", async () => {
      const user = renderForm({ transaction: txn, mode: "modal" });
      expect(submitButton()).toHaveTextContent("Update ₱85");
      await user.click(submitButton());
      expect(saveTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 85,
          accountId: "gcash",
          category: "load",
          occurredOn: "2026-11-18",
          occurredTime: "09:15",
        }),
        "t1",
        undefined,
      );
      expect(router.back).toHaveBeenCalled();
    });

    it("asks twice before deleting", async () => {
      const user = renderForm({ transaction: txn });
      await user.click(screen.getByRole("button", { name: "Delete" }));
      expect(deleteTransaction).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Tap again to delete" }));
      expect(deleteTransaction).toHaveBeenCalledWith("t1");
    });
  });

  it("reuses a recent template", async () => {
    const template: Template = {
      type: "expense",
      amount: 13,
      accountId: "cash",
      toAccountId: null,
      toAmount: null,
      category: "transport",
      subcategory: "Jeep",
      note: "Jeep to work",
    };
    const user = renderForm({ templates: [template] });
    const recent = within(screen.getByRole("group", { name: "RECENT · TAP TO REUSE" }));
    await user.click(recent.getAllByRole("button")[0]);
    await user.click(submitButton());
    expect(saveTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 13,
        category: "transport",
        subcategory: "Jeep",
        accountId: "cash",
        note: "Jeep to work",
      }),
      undefined,
      undefined,
    );
  });
});
