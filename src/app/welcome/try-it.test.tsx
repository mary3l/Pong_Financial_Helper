import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetDemo } from "./demo-store";
import { StartCard } from "./start-card";
import { TryIt } from "./try-it";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {} }) }));

afterEach(() => resetDemo());

const amount = () => screen.getByRole("status");
const math = (id: string) => screen.getByTestId(id);

describe("Try it", () => {
  it("starts with the worked example: ₱433 a day and a happy Pong", () => {
    render(<TryIt />);
    expect(amount()).toHaveTextContent("₱433");
    expect(screen.getByRole("img", { name: "Pong happy" })).toBeInTheDocument();
  });

  it("updates the amount and Pong's face as the sweldo changes", async () => {
    const user = userEvent.setup();
    render(<TryIt />);
    const pay = screen.getByLabelText("Sweldo this payday");

    await user.clear(pay);
    await user.type(pay, "30000");
    // (30,000 − 4,500 − 1,000) ÷ 15 = 1,633.33…
    expect(amount()).toHaveTextContent("₱1,633");
    expect(screen.getByRole("img", { name: /Pong proudly/ })).toBeInTheDocument();

    await user.clear(pay);
    await user.type(pay, "5000");
    expect(amount()).toHaveTextContent("₱0");
    expect(screen.getByRole("img", { name: "Pong shocked" })).toBeInTheDocument();
  });

  it("steps the days with − and +", async () => {
    const user = userEvent.setup();
    render(<TryIt />);
    await user.click(screen.getByRole("button", { name: "One day more" }));
    // 6,500 ÷ 16 = 406.25
    expect(amount()).toHaveTextContent("₱406");
  });

  it("shows Pong's working: what's left, then split by day", async () => {
    const user = userEvent.setup();
    render(<TryIt />);
    expect(math("math-left")).toHaveTextContent("₱12,000 − ₱4,500 − ₱1,000 = ₱6,500 left");
    expect(math("math-split")).toHaveTextContent("₱6,500 ÷ 15 days = ₱433 a day");

    await user.click(screen.getByRole("button", { name: "One day fewer" }));
    expect(math("math-split")).toHaveTextContent("₱6,500 ÷ 14 days = ₱464 a day");
  });

  it("'Let Pong track it for real' carries the amount to the sign-in card", async () => {
    const user = userEvent.setup();
    Element.prototype.scrollIntoView = vi.fn();
    render(
      <>
        <StartCard />
        <TryIt />
      </>,
    );
    expect(screen.queryByText(/on track/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: /Let Pong track it for real/ }));
    expect(screen.getByText(/Sign in and Pong will keep your/)).toHaveTextContent(
      "Sign in and Pong will keep your ₱433 a day on track.",
    );
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
