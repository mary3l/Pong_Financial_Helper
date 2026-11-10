"use client";

import { useState, useTransition } from "react";
import { updateSplit, type Who } from "@/app/people-actions";
import { AmountInput } from "@/components/amount-input";
import { FormDialog } from "@/components/form-dialog";
import { CloseIcon } from "@/components/icons";
import { amountToExpression, evaluate, expressionFromText } from "@/lib/calculator";
import { formatPeso, parseAmount, roundCents } from "@/lib/money";
import { newSharesProblem } from "@/lib/splits";

/** A share on the bill. `personId` is null for yours. */
type Share = { id: string; name: string; amount: number; personId: string | null };

/** Someone being added: picked from your people (`personId`), or a new name typed in. */
type Added = { key: number; personId: string | null; name: string; amount: string };

const NEW = "new";
const FIELD = "h-11 min-w-0 rounded-[14px] bg-card px-3 text-[15px] outline-none focus:ring-2 focus:ring-sea";

/** A share as typed, including a sum ("50+20"); NaN if it can't be read. */
function read(text: string): number {
  if (!text.trim()) return 0;
  const plain = parseAmount(text);
  if (!Number.isNaN(plain)) return plain;
  const expr = expressionFromText(text);
  const result = expr ? evaluate(expr) : null;
  return result !== null && result >= 0 ? roundCents(result) : NaN;
}

/**
 * Edit the whole bill: its description and date on every record, each
 * share, and + Add person for someone who joined in. The total follows the
 * shares, so changing one adds to or takes from the bill.
 */
export function EditSplit({
  splitId,
  note,
  date,
  shares,
  people,
}: {
  splitId: string;
  note: string;
  date: string;
  shares: Share[];
  /** Everyone you could add (getPeople). */
  people: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState(note);
  const [draftDate, setDraftDate] = useState(date);
  const [amounts, setAmounts] = useState<Record<string, string>>(() => start(shares));
  const [added, setAdded] = useState<Added[]>([]);
  const [nextKey, setNextKey] = useState(1);

  const oldTotal = roundCents(shares.reduce((s, x) => s + x.amount, 0));
  const values = shares.map((s) => read(amounts[s.id] ?? ""));
  const addedValues = added.map((a) => read(a.amount));
  const valid = [...values, ...addedValues].every((v) => !Number.isNaN(v));
  const total = valid ? roundCents([...values, ...addedValues].reduce((s, v) => s + v, 0)) : null;
  const change = total === null ? 0 : roundCents(total - oldTotal);
  // Only people not already on the bill (or picked in another new row) can be added.
  const onBill = new Set(shares.map((s) => s.personId).filter(Boolean));
  const choices = (row: Added) =>
    people.filter((p) => !onBill.has(p.id) && (p.id === row.personId || !added.some((a) => a.personId === p.id)));

  function reset() {
    setDraftNote(note);
    setDraftDate(date);
    setAmounts(start(shares));
    setAdded([]);
    setError(null);
  }

  function addPerson() {
    const first = people.find((p) => !onBill.has(p.id) && !added.some((a) => a.personId === p.id));
    setAdded((rows) => [...rows, { key: nextKey, personId: first?.id ?? null, name: "", amount: "" }]);
    setNextKey((k) => k + 1);
  }

  function patchRow(key: number, patch: Partial<Added>) {
    setAdded((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function save() {
    if (pending) return;
    if (total === null) {
      setError("Check the shares.");
      return;
    }
    const problem = newSharesProblem(
      added.map((a, i) => ({
        personId: a.personId,
        name: a.personId ? (people.find((p) => p.id === a.personId)?.name ?? "") : a.name,
        amount: addedValues[i],
      })),
      shares.flatMap((s, i) => (s.personId && values[i] > 0 ? [{ personId: s.personId, name: s.name }] : [])),
    );
    if (problem) {
      setError(problem);
      return;
    }
    if (total <= 0) {
      setError("The shares need to add up to more than ₱0.");
      return;
    }
    startTransition(async () => {
      const result = await updateSplit(splitId, {
        note: draftNote,
        occurredOn: draftDate,
        shares: shares.map((s, i) => ({ id: s.id, amount: values[i] })),
        added: added.map((a, i) => ({
          who: (a.personId ? { personId: a.personId } : { name: a.name }) satisfies Who,
          amount: addedValues[i],
        })),
      });
      if (result.error) setError(result.error);
      else setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="h-14 rounded-[18px] bg-sun font-extrabold text-ink"
      >
        Edit split
      </button>

      {open && (
        <FormDialog title="Edit this split" onClose={() => setOpen(false)} wide>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
            className="flex flex-col gap-3"
          >
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,10rem)] gap-2.5">
              <div className="flex flex-col gap-1">
                <label htmlFor="split-note" className="text-[13px] font-extrabold">Description</label>
                <input
                  id="split-note"
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value)}
                  maxLength={120}
                  placeholder="e.g. Chatuchak"
                  className={FIELD}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="split-date" className="text-[13px] font-extrabold">Date</label>
                <input
                  id="split-date"
                  type="date"
                  value={draftDate}
                  required
                  onChange={(e) => setDraftDate(e.target.value)}
                  className={FIELD}
                />
              </div>
            </div>

            <span className="text-[13px] font-extrabold text-muted">SHARES</span>
            <ul className="flex flex-col gap-1.5">
              {shares.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 text-[15px]">
                  <span className="font-bold">{s.name}</span>
                  <AmountInput
                    aria-label={`${s.name}'s share`}
                    value={amounts[s.id] ?? ""}
                    onChange={(v) => setAmounts((a) => ({ ...a, [s.id]: v }))}
                    placeholder="0.00"
                    wrapperClassName="w-32"
                    className="h-9 w-full rounded-[12px] bg-card px-3 text-right text-[15px] outline-none focus:ring-2 focus:ring-sea"
                  />
                </li>
              ))}

              {added.map((a, i) => {
                const options = choices(a);
                const label = a.personId ? (people.find((p) => p.id === a.personId)?.name ?? "New person") : a.name.trim() || "New person";
                return (
                  <li key={a.key} className="flex flex-col gap-1.5 rounded-[14px] bg-sea-tint/60 p-2">
                    {/* Who on top, with ✕; their name (when new) and share under it, so nothing gets cut on a phone. */}
                    <div className="flex items-center gap-2">
                      <label htmlFor={`add-who-${a.key}`} className="sr-only">Who to add</label>
                      <select
                        id={`add-who-${a.key}`}
                        value={a.personId ?? NEW}
                        onChange={(e) => patchRow(a.key, { personId: e.target.value === NEW ? null : e.target.value })}
                        className={`${FIELD} h-10 min-w-0 flex-1 rounded-[12px]`}
                      >
                        {options.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                        <option value={NEW}>Someone new…</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => setAdded((rows) => rows.filter((r) => r.key !== a.key))}
                        aria-label={`Don't add ${label}`}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-card"
                      >
                        <CloseIcon size={16} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      {a.personId ? (
                        <span className="min-w-0 flex-1 truncate pl-1 text-sm font-bold">{label}&apos;s share</span>
                      ) : (
                        <>
                          <label htmlFor={`add-name-${a.key}`} className="sr-only">Their name</label>
                          <input
                            id={`add-name-${a.key}`}
                            value={a.name}
                            onChange={(e) => patchRow(a.key, { name: e.target.value })}
                            maxLength={60}
                            placeholder="Their name"
                            autoFocus={i === added.length - 1}
                            className={`${FIELD} h-10 min-w-0 flex-1 rounded-[12px]`}
                          />
                        </>
                      )}
                      <AmountInput
                        aria-label={`${label}'s share`}
                        value={a.amount}
                        onChange={(v) => patchRow(a.key, { amount: v })}
                        placeholder="0.00"
                        wrapperClassName="w-32 shrink-0"
                        className="h-10 w-full rounded-[12px] bg-card px-3 text-right text-[15px] outline-none focus:ring-2 focus:ring-sea"
                      />
                    </div>
                  </li>
                );
              })}

              <li>
                <button
                  type="button"
                  onClick={addPerson}
                  className="h-10 rounded-full px-3 text-sm font-extrabold text-sea-dark hover:bg-card"
                >
                  + Add person
                </button>
              </li>

              <li
                aria-live="polite"
                className={`mt-1 flex items-center justify-between gap-3 rounded-[12px] px-3 py-2 text-[15px] ${
                  total === null ? "bg-coral-tint text-coral-text" : "bg-sea-tint text-sea-dark"
                }`}
              >
                <span className="font-extrabold">New total</span>
                <span className="text-right">
                  <span className="font-display font-semibold">{total === null ? "Check the shares" : formatPeso(total)}</span>
                  {total !== null && (
                    <span className="block text-xs text-muted">
                      {change === 0
                        ? `same as before`
                        : `${change > 0 ? "+" : "−"}${formatPeso(Math.abs(change))} from ${formatPeso(oldTotal)}`}
                    </span>
                  )}
                </span>
              </li>
            </ul>
            <p className="text-xs text-muted">
              Set a share to 0 to take that person off the bill. Anyone you add owes you their share (pautang),
              paid from the same wallet as the rest of the bill.
            </p>

            <p role="alert" className="text-sm font-bold text-coral-text empty:hidden">{error}</p>
            <div className="flex gap-2.5">
              <button type="button" onClick={() => setOpen(false)} className="h-12 flex-1 rounded-[16px] bg-card font-extrabold">
                Cancel
              </button>
              <button type="submit" disabled={pending} className="h-12 flex-[2] rounded-[16px] bg-sun font-extrabold text-ink disabled:opacity-60">
                {pending ? "Updating…" : "Update split"}
              </button>
            </div>
          </form>
        </FormDialog>
      )}
    </>
  );
}

function start(shares: Share[]): Record<string, string> {
  return Object.fromEntries(shares.map((s) => [s.id, amountToExpression(s.amount)]));
}
