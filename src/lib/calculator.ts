// The Add screen's calculator keypad, ported from the design canvas.
// The expression is a string like "120+45×2"; × and ÷ bind tighter.

export const OPERATORS = ["+", "−", "×", "÷"] as const;
export type Key =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "."
  | "C"
  | "⌫"
  | "="
  | (typeof OPERATORS)[number];

const isOperator = (c: string) => (OPERATORS as readonly string[]).includes(c);

export function hasOperator(expr: string): boolean {
  return /[+−×÷]/.test(expr);
}

/** The value of an expression, ignoring a trailing operator; null on ÷ 0. */
export function evaluate(expr: string): number | null {
  let e = expr;
  while (e && (isOperator(e.slice(-1)) || e.endsWith("."))) e = e.slice(0, -1);
  if (!e) return 0;

  const tokens: string[] = e.match(/\d+(\.\d+)?|[+−×÷]/g) ?? [];
  const terms = [parseFloat(tokens[0])];
  const ops: string[] = [];
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i];
    const n = parseFloat(tokens[i + 1]);
    if (op === "×") terms[terms.length - 1] *= n;
    else if (op === "÷") {
      if (n === 0) return null;
      terms[terms.length - 1] /= n;
    } else {
      ops.push(op);
      terms.push(n);
    }
  }
  let result = terms[0];
  ops.forEach((op, j) => {
    result = op === "+" ? result + terms[j + 1] : result - terms[j + 1];
  });
  return Math.round(result * 100) / 100;
}

export type PressResult = { expr: string; error?: string };

/** Applies one key press. Numbers are capped at 9 digits and 2 decimals. */
export function press(expr: string, key: Key): PressResult {
  const last = expr.slice(-1);
  const current = expr.split(/[+−×÷]/).pop() ?? "";

  if (key === "C") return { expr: "" };
  if (key === "⌫") return { expr: expr.slice(0, -1) };
  if (key === "=") {
    const r = evaluate(expr);
    if (r === null) return { expr, error: "Can't divide by 0" };
    if (r < 0) return { expr, error: "Amount can't be negative" };
    return { expr: r ? String(r) : "" };
  }
  if (isOperator(key)) {
    if (!expr) return { expr };
    const base = isOperator(last) || last === "." ? expr.slice(0, -1) : expr;
    return { expr: base + key };
  }
  if (key === ".") {
    if (current.includes(".")) return { expr };
    return { expr: expr + (current === "" ? "0." : ".") };
  }
  if (current.includes(".") && current.split(".")[1].length >= 2) return { expr };
  if (current.replace(".", "").length >= 9) return { expr };
  const base = current === "0" ? expr.slice(0, -1) : expr;
  return { expr: base + key };
}

/** Maps a physical key to a keypad key, for the desktop keyboard shortcuts. */
export function keyFromKeyboard(key: string): Key | null {
  if (/^[0-9]$/.test(key)) return key as Key;
  switch (key) {
    case ".":
    case ",":
      return ".";
    case "+":
      return "+";
    case "-":
      return "−";
    case "*":
    case "x":
    case "X":
      return "×";
    case "/":
      return "÷";
    case "=":
      return "=";
    case "Backspace":
      return "⌫";
    case "Delete":
    case "c":
    case "C":
      return "C";
    default:
      return null;
  }
}

/** Shows an expression with spaces around operators: "120 + 45". */
export function prettyExpression(expr: string): string {
  return expr.replace(/([+−×÷])/g, " $1 ");
}

const NUMBER = String.raw`(?:\d+(?:\.\d*)?|\.\d+)`;
const TYPED = new RegExp(`^${NUMBER}(?:[+−×÷]${NUMBER})*[+−×÷]?$`);

/**
 * Typed text as a keypad expression, e.g. "1,200 + 3*45" → "1200+3×45", or
 * null when it isn't one. Takes the keyboard's - * x / as well.
 */
export function expressionFromText(text: string): string | null {
  const e = text
    .replace(/[₱,\s]/g, "")
    .replace(/-/g, "−")
    .replace(/[*xX]/g, "×")
    .replace(/\//g, "÷");
  if (!TYPED.test(e)) return null;
  // ".5" → "0.5" and "12." → "12", so evaluate reads every number whole.
  return e.replace(/(^|[+−×÷])\./g, (_, op) => `${op}0.`).replace(/\.(?=[+−×÷]|$)/g, "");
}

/** An amount as keypad text, e.g. 150.5 → "150.5". */
export function amountToExpression(amount: number): string {
  return String(Math.round(amount * 100) / 100);
}
