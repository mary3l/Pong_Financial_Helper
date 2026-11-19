import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Keypad } from "./keypad";

describe("Keypad", () => {
  it("has all 18 keys, each with a spoken name", () => {
    render(<Keypad onPress={() => {}} className="" />);
    const keys = screen.getAllByRole("button");
    expect(keys).toHaveLength(18);
    for (const name of [
      "Clear",
      "Delete last digit",
      "Divide",
      "Multiply",
      "Minus",
      "Plus",
      "Equals",
      "Decimal point",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    for (let d = 0; d <= 9; d++) {
      expect(screen.getByRole("button", { name: String(d) })).toBeInTheDocument();
    }
  });

  it("reports the key pressed, not its label", async () => {
    const onPress = vi.fn();
    render(<Keypad onPress={onPress} className="" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "7" }));
    await user.click(screen.getByRole("button", { name: "Minus" }));
    await user.click(screen.getByRole("button", { name: "Delete last digit" }));
    await user.click(screen.getByRole("button", { name: "Equals" }));
    expect(onPress.mock.calls.map((c) => c[0])).toEqual(["7", "−", "⌫", "="]);
  });

  it("never submits a surrounding form", async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Keypad onPress={() => {}} className="" />
      </form>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Equals" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("passes the row heights through", () => {
    const { container } = render(
      <Keypad onPress={() => {}} className="grid-rows-[repeat(5,52px)]" />,
    );
    expect(container.firstChild).toHaveClass("grid", "grid-cols-4", "grid-rows-[repeat(5,52px)]");
  });
});
