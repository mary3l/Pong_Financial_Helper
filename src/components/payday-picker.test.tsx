import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  PaydayPicker,
  choiceFrom,
  dayLabel,
  ordinal,
  scheduleFrom,
  type PayKind,
  type PaydayChoice,
} from "./payday-picker";

const ALL: PayKind[] = ["daily", "weekly", "twice_monthly", "monthly", "irregular"];

function Picker({
  start,
  onChange,
}: {
  start: PaydayChoice;
  onChange?: (c: PaydayChoice) => void;
}) {
  const [value, setValue] = useState(start);
  return (
    <>
      <h2 id="when">When do you get paid?</h2>
      <PaydayPicker
        value={value}
        onChange={(c) => {
          setValue(c);
          onChange?.(c);
        }}
        kinds={ALL}
        idPrefix="pay"
        labelledBy="when"
      />
    </>
  );
}

describe("ordinal and dayLabel", () => {
  it.each([
    [1, "1st"],
    [2, "2nd"],
    [3, "3rd"],
    [4, "4th"],
    [11, "11th"],
    [12, "12th"],
    [13, "13th"],
    [21, "21st"],
    [22, "22nd"],
    [23, "23rd"],
    [31, "31st"],
  ])("%i is %s", (n, s) => expect(ordinal(n)).toBe(s));

  it("says the last day stands in from the 29th", () => {
    expect(dayLabel(28)).toBe("28th");
    expect(dayLabel(30)).toBe("30th (or last day)");
  });
});

describe("choiceFrom", () => {
  it("defaults for someone with no payday", () => {
    expect(choiceFrom(null, "twice_monthly")).toEqual({
      kind: "twice_monthly",
      twice: [15, 30],
      monthDay: 30,
      weekday: 5,
      weeks: [1, 2, 3, 4, 5],
      weekdays: [1, 2, 3, 4, 5],
    });
  });

  it("fills in the saved weekly schedule", () => {
    const c = choiceFrom({ frequency: "weekly", day1: 4, day2: null, weeks: [2, 4] }, "monthly");
    expect(c).toMatchObject({ kind: "weekly", weekday: 4, weeks: [2, 4] });
  });
});

describe("scheduleFrom", () => {
  const base = choiceFrom(null, "twice_monthly");

  it("orders twice-a-month days and says which came first", () => {
    expect(scheduleFrom({ ...base, twice: [30, 15] })).toEqual({
      schedule: { frequency: "twice_monthly", day1: 15, day2: 30 },
      order: [1, 0],
    });
  });

  it("rejects the same day twice", () => {
    expect(scheduleFrom({ ...base, twice: [15, 15] }).error).toBe("Pick two different paydays.");
  });

  it("needs one of the first four weeks for weekly", () => {
    expect(scheduleFrom({ ...base, kind: "weekly", weeks: [5] }).error).toMatch(/at least one/);
  });

  it("stores every week as no list", () => {
    expect(scheduleFrom({ ...base, kind: "weekly" }).schedule).toEqual({
      frequency: "weekly",
      day1: 5,
      day2: null,
      weeks: null,
    });
    expect(scheduleFrom({ ...base, kind: "weekly", weeks: [3, 1] }).schedule?.weeks).toEqual([
      1, 3,
    ]);
  });

  it("needs a day for daily pay", () => {
    expect(scheduleFrom({ ...base, kind: "daily", weekdays: [] }).error).toBe(
      "Pick the days you're paid.",
    );
    expect(scheduleFrom({ ...base, kind: "daily", weekdays: [5, 1] }).schedule).toMatchObject({
      day1: 1,
      weekdays: [1, 5],
    });
  });

  it("has no schedule for irregular pay", () => {
    expect(scheduleFrom({ ...base, kind: "irregular" }).schedule).toBeNull();
  });
});

describe("PaydayPicker", () => {
  it("offers the kinds as a labelled group, with the current one pressed", () => {
    render(<Picker start={choiceFrom(null, "monthly")} />);
    const group = screen.getByRole("group", { name: "When do you get paid?" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Monthly" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Weekly" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("combobox", { name: "Payday" })).toHaveValue("30");
  });

  it("switching kinds keeps what you picked before", async () => {
    const user = userEvent.setup();
    render(<Picker start={choiceFrom(null, "monthly")} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Payday" }), "10");
    await user.click(screen.getByRole("button", { name: "Twice a month" }));
    expect(screen.getByRole("combobox", { name: "First payday" })).toHaveValue("15");
    await user.click(screen.getByRole("button", { name: "Monthly" }));
    expect(screen.getByRole("combobox", { name: "Payday" })).toHaveValue("10");
  });

  it("sets both days twice a month", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Picker start={choiceFrom(null, "twice_monthly")} onChange={onChange} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Second payday" }), "31");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ twice: [15, 31] }));
    const second = screen.getByRole("combobox", { name: "Second payday" });
    expect(within(second).getByRole("option", { selected: true })).toHaveTextContent(
      "31st (or last day)",
    );
  });

  it("toggles which weeks pay, and explains when none of the first four are on", async () => {
    const user = userEvent.setup();
    render(<Picker start={choiceFrom(null, "weekly")} />);
    expect(
      screen.getByText("Every Friday. The 5th comes only in some months."),
    ).toBeInTheDocument();

    for (const w of ["1st", "3rd"]) await user.click(screen.getByRole("button", { name: w }));
    expect(screen.getByText("Only the 2nd, 4th, 5th Friday of the month.")).toBeInTheDocument();
    for (const w of ["2nd", "4th"]) await user.click(screen.getByRole("button", { name: w }));
    expect(screen.getByText(/Pick at least one of the 1st to 4th Friday/)).toBeInTheDocument();
  });

  it("changing the weekday renames the weeks question", async () => {
    const user = userEvent.setup();
    render(<Picker start={choiceFrom(null, "weekly")} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Payday" }), "Monday");
    expect(
      screen.getByRole("group", { name: "Which Mondays of the month are paydays?" }),
    ).toBeInTheDocument();
  });

  it("lists daily paydays Monday first and toggles them", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Picker start={choiceFrom(null, "daily")} onChange={onChange} />);
    const days = screen.getByRole("group", { name: "Paid on" });
    const labels = [...days.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels[0]).toBe("Mon");
    expect(labels.at(-1)).toBe("Sun");
    await user.click(screen.getByRole("button", { name: "Sat" }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ weekdays: [1, 2, 3, 4, 5, 6] }),
    );
  });

  it("shows no day fields for irregular pay", () => {
    render(<Picker start={choiceFrom(null, "irregular")} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
