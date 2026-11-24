import { ChoiceChip } from "@/components/choice-chip";

/**
 * Who? for a lend or borrow: type to search, tap a chip to pick someone, or
 * type a new name to add them. Shared by Add and Money › People › new.
 */
export function PersonPicker({
  id,
  people,
  personId,
  name,
  onPick,
  onType,
  inputClassName,
  labelClassName = "text-sm font-bold",
}: {
  id: string;
  people: { id: string; name: string }[];
  personId: string | null;
  /** What's typed, when nobody is picked. */
  name: string;
  onPick: (id: string) => void;
  onType: (text: string) => void;
  inputClassName: string;
  labelClassName?: string;
}) {
  const typed = name.trim().toLowerCase();
  const matches = typed ? people.filter((p) => p.name.toLowerCase().includes(typed)) : people;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={labelClassName}>
        Who?
      </label>
      <input
        id={id}
        value={personId ? (people.find((p) => p.id === personId)?.name ?? "") : name}
        onChange={(e) => onType(e.target.value)}
        maxLength={60}
        placeholder="Search or add a person"
        autoComplete="off"
        className={inputClassName}
      />
      {matches.length > 0 && (
        <div role="group" aria-label="People" className="flex flex-wrap gap-2">
          {matches.slice(0, 8).map((p) => (
            <ChoiceChip key={p.id} selected={personId === p.id} onClick={() => onPick(p.id)}>
              {p.name}
            </ChoiceChip>
          ))}
        </div>
      )}
      {!personId && typed && !people.some((p) => p.name.toLowerCase() === typed) && (
        <span className="text-xs text-muted">I&apos;ll add {name.trim()} as someone new.</span>
      )}
    </div>
  );
}
