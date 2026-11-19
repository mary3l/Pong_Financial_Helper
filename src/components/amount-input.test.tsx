import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AmountInput } from "./amount-input";

/** AmountInput is controlled, so hold its value like a real form does. */
function Field({
  start = "",
  onChange,
  ...props
}: { start?: string; onChange?: (v: string) => void } & Partial<
  React.ComponentProps<typeof AmountInput>
>) {
  const [value, setValue] = useState(start);
  return (
    <AmountInput
      aria-label="Amount"
      {...props}
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

const field = () => screen.getByRole("textbox", { name: "Amount" });
const sheet = () => screen.getByRole("dialog", { name: "Calculator for Amount" });

describe("AmountInput", () => {
  it("doesn't open the phone keyboard", () => {
    render(<Field />);
    expect(field()).toHaveAttribute("inputmode", "none");
    expect(field()).toHaveAttribute("type", "text");
  });

  it("works out a typed sum when you leave the field", async () => {
    const user = userEvent.setup();
    render(<Field />);
    // Reach it with Tab, like a keyboard user: no calculator sheet.
    await user.tab();
    expect(field()).toHaveFocus();
    await user.keyboard("120+45.5");
    expect(field()).toHaveValue("120+45.5");
    await user.tab();
    expect(field()).toHaveValue("165.5");
  });

  it("works out a typed sum on Enter without submitting the form", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Field />
      </form>,
    );
    await user.tab();
    await user.keyboard("100*3{Enter}");
    expect(field()).toHaveValue("300");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("leaves a plain number or an impossible sum alone", async () => {
    const user = userEvent.setup();
    render(<Field />);
    await user.tab();
    await user.keyboard("5/0");
    await user.tab();
    expect(field()).toHaveValue("5/0");
  });

  it("opens the calculator on tap, and Use puts the answer in the field", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Field onChange={onChange} />);
    await user.click(field());

    const calc = within(sheet());
    for (const key of ["1", "2", "0", "Plus", "4", "5"]) {
      await user.click(calc.getByRole("button", { name: key }));
    }
    expect(calc.getByText("120 + 45")).toBeInTheDocument();
    await user.click(calc.getByRole("button", { name: /^Use / }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(field()).toHaveValue("165");
    expect(onChange).toHaveBeenLastCalledWith("165");
  });

  it("starts the calculator from what's already in the field", async () => {
    const user = userEvent.setup();
    render(<Field start="250" />);
    await user.click(screen.getByRole("button", { name: "Calculator for Amount" }));
    expect(within(sheet()).getByRole("button", { name: /^Use .*250/ })).toBeInTheDocument();
  });

  it("won't use a division by zero", async () => {
    const user = userEvent.setup();
    render(<Field />);
    await user.click(field());
    const calc = within(sheet());
    for (const key of ["8", "Divide", "0"])
      await user.click(calc.getByRole("button", { name: key }));
    await user.click(calc.getByRole("button", { name: /^Use / }));
    expect(calc.getByText("Can't divide by 0")).toBeInTheDocument();
    expect(field()).toHaveValue("");
  });

  it("takes the keyboard inside the sheet, and Enter uses the answer", async () => {
    const user = userEvent.setup();
    render(<Field />);
    await user.click(field());
    sheet().focus();
    await user.keyboard("9*9{Enter}");
    expect(field()).toHaveValue("81");
  });

  it("closes without changing anything, and gives focus back to the calculator button", async () => {
    const user = userEvent.setup();
    render(<Field start="40" />);
    await user.click(field());
    await user.click(within(sheet()).getByRole("button", { name: "7" }));
    await user.click(screen.getByRole("button", { name: "Close calculator" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(field()).toHaveValue("40");
    expect(screen.getByRole("button", { name: "Calculator for Amount" })).toHaveFocus();
  });

  it("doesn't open when disabled or read-only", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Field readOnly />);
    await user.click(field());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<Field disabled />);
    await user.click(field());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("titles the calculator with its label", async () => {
    const user = userEvent.setup();
    render(<Field label="Rent" />);
    await user.click(screen.getByRole("button", { name: "Calculator for Rent" }));
    expect(screen.getByRole("dialog", { name: "Calculator for Rent" })).toBeInTheDocument();
  });
});
