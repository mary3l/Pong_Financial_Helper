"use client";

import { useActionState } from "react";
import { setDisplayName, type DisplayNameState } from "@/app/actions";
import { DISPLAY_NAME_MAX } from "@/lib/display-name";

export function DisplayNameForm({
  initialName,
  label = "Display name",
  hint = "This is what Pong calls you.",
}: {
  initialName: string | null;
  label?: string;
  hint?: string;
}) {
  const [state, action, pending] = useActionState<DisplayNameState, FormData>(setDisplayName, {});

  return (
    <form action={action} className="flex flex-col gap-2">
      <label htmlFor="display_name" className="text-sm font-bold">
        {label}
      </label>
      <p id="display_name_hint" className="text-sm text-muted">
        {hint}
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          id="display_name"
          name="display_name"
          defaultValue={initialName ?? ""}
          maxLength={DISPLAY_NAME_MAX}
          required
          autoComplete="nickname"
          aria-describedby="display_name_hint display_name_status"
          aria-invalid={state.error ? true : undefined}
          className="h-12 min-w-0 flex-1 basis-48 rounded-[14px] border-2 border-line bg-card px-4 text-base outline-none focus:border-sea"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-12 rounded-[18px] bg-sun px-5 font-extrabold text-ink disabled:opacity-60"
        >
          {pending ? "Saving…" : "Use this name"}
        </button>
      </div>
      <p
        id="display_name_status"
        role={state.error ? "alert" : "status"}
        className={`min-h-5 text-sm font-bold ${state.error ? "text-coral-text" : "text-sea-dark"}`}
      >
        {state.error ?? (state.saved && !pending ? "Saved." : "")}
      </p>
    </form>
  );
}
