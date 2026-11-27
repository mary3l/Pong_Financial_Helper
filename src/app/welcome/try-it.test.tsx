import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TryIt } from "./try-it";

const amount = () => screen.getByRole("status");

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
});
