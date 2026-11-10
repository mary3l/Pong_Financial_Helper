// Pong the turtle, ported from the Pong component on the design canvas.
// Swap the art here and every screen picks it up.

export type PongMood =
  | "happy"
  | "worried"
  | "proud"
  | "shocked"
  | "sleepy"
  | "sleep"
  | "peek"
  | "ask"
  | "listen";

const LABELS: Record<PongMood, string> = {
  happy: "Pong happy",
  worried: "Pong looking worried",
  proud: "Pong proudly holding a peso coin",
  shocked: "Pong shocked",
  sleepy: "Pong drowsy",
  sleep: "Pong napping in his shell",
  peek: "Pong peeking out of his shell",
  ask: "Pong asking what you spent",
  listen: "Pong listening",
};

const HEAD: Record<PongMood, string> = {
  happy: "translate(0 -3)",
  worried: "translate(-6 3) rotate(6 98 60)",
  proud: "translate(2 -6) rotate(-6 98 60)",
  shocked: "translate(-3 -7)",
  sleepy: "translate(-13 5)",
  sleep: "translate(-34 8)",
  peek: "translate(-10 4)",
  ask: "translate(2 -4)",
  listen: "translate(0 -2) rotate(-9 98 60)",
};

type PongProps = {
  mood?: PongMood;
  size?: number;
  sprout?: boolean;
  className?: string;
  /** Set when a visible caption already says what Pong is doing. */
  decorative?: boolean;
};

export function Pong({
  mood = "happy",
  size = 160,
  sprout = true,
  className,
  decorative = false,
}: PongProps) {
  const on = (...moods: PongMood[]) => (moods.includes(mood) ? 1 : 0);
  const a11y = decorative
    ? { "aria-hidden": true }
    : { role: "img", "aria-label": LABELS[mood] };

  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={className}
      style={{ display: "block", overflow: "visible", flexShrink: 0 }}
      {...a11y}
    >
      <ellipse cx="9" cy="90" rx="7" ry="3.6" fill="#8CBF7E" transform="rotate(-25 9 90)" />
      <ellipse cx="24" cy="97" rx="10" ry="6.5" fill="#8CBF7E" />
      <ellipse cx="74" cy="97" rx="10" ry="6.5" fill="#8CBF7E" />

      <g transform={HEAD[mood]}>
        <path d="M68 88 C74 78 82 71 90 68 L101 77 C93 83 85 89 79 96 Z" fill="#A9D69B" />
        <circle cx="98" cy="60" r="18" fill="#A9D69B" />
        <ellipse cx="98" cy="68" rx="11" ry="6.5" fill="#BEE2B1" />

        <Face mood={mood} />
      </g>

      <path d="M6 90 C6 58 27 40 50 40 C73 40 94 58 94 90 Z" fill="#5E9E6E" />
      <ellipse cx="50" cy="63" rx="15" ry="12" fill="#7DB88A" />
      <ellipse cx="24" cy="79" rx="9" ry="8" fill="#7DB88A" />
      <ellipse cx="76" cy="79" rx="9" ry="8" fill="#7DB88A" />
      <ellipse cx="50" cy="84" rx="8" ry="4.5" fill="#7DB88A" />
      <path d="M20 62 C24 53 32 47 40 45" stroke="#FFFFFF" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.35" />
      <rect x="2" y="86" width="96" height="10" rx="5" fill="#3F7350" />

      <g opacity={sprout ? 1 : 0}>
        <circle cx="50" cy="31" r="3.4" fill="#F5B83D" />
        <circle cx="54.8" cy="34.5" r="3.4" fill="#F5B83D" />
        <circle cx="53" cy="40" r="3.4" fill="#F5B83D" />
        <circle cx="47" cy="40" r="3.4" fill="#F5B83D" />
        <circle cx="45.2" cy="34.5" r="3.4" fill="#F5B83D" />
        <circle cx="50" cy="36" r="2.6" fill="#E09A1E" />
      </g>
      <g opacity={on("proud")}>
        <circle cx="111" cy="92" r="8.5" fill="#F5B83D" stroke="#E09A1E" strokeWidth="2" />
        <text x="111" y="96" textAnchor="middle" fontSize="11" fontWeight="800" fontFamily="Arial, sans-serif" fill="#7A4E05">₱</text>
      </g>
      <g opacity={on("sleep", "sleepy")} fill="#2F7F7A" fontFamily="Fredoka, Nunito, sans-serif" fontWeight="700">
        <text x="66" y="32" fontSize="13">z</text>
        <text x="77" y="21" fontSize="9">z</text>
      </g>
      <g opacity={on("happy", "proud")} fill="#F5B83D">
        <path d="M12 30 L14.6 36.4 L21 39 L14.6 41.6 L12 48 L9.4 41.6 L3 39 L9.4 36.4 Z" />
        <path d="M78 22 L80 26.8 L84.8 28.8 L80 30.8 L78 35.6 L76 30.8 L71.2 28.8 L76 26.8 Z" />
        <path d="M114 26 L115.2 29 L118.2 30.2 L115.2 31.4 L114 34.4 L112.8 31.4 L109.8 30.2 L112.8 29 Z" />
      </g>
      <g opacity={on("peek", "ask", "shocked")} stroke="#E09A1E" strokeWidth="3" strokeLinecap="round">
        <path d="M110 38 L115 31" />
        <path d="M116 46 L121 44" />
        <path d="M86 36 L82 29" />
      </g>
      <g opacity={on("listen")} fill="#2F7F7A">
        <circle cx="104" cy="34" r="2.5" />
        <circle cx="111" cy="29" r="2.5" />
        <circle cx="118" cy="24" r="2.5" />
      </g>
    </svg>
  );
}

/** Eyes, brows, cheeks and mouth for each mood, around the head at (98, 60). */
function Face({ mood }: { mood: PongMood }) {
  const on = (...moods: PongMood[]) => (moods.includes(mood) ? 1 : 0);
  return (
    <>
      <g opacity={on("peek", "ask", "listen", "worried")}>
        <ellipse cx="91" cy="57" rx="3.6" ry="4.4" fill="#22301F" />
        <ellipse cx="105" cy="57" rx="3.6" ry="4.4" fill="#22301F" />
        <circle cx="92.2" cy="55.4" r="1.3" fill="#FFFFFF" />
        <circle cx="106.2" cy="55.4" r="1.3" fill="#FFFFFF" />
      </g>
      <g opacity={on("shocked")}>
        <ellipse cx="91" cy="56.5" rx="4.6" ry="5.6" fill="#FFFFFF" stroke="#22301F" strokeWidth="1.6" />
        <ellipse cx="105" cy="56.5" rx="4.6" ry="5.6" fill="#FFFFFF" stroke="#22301F" strokeWidth="1.6" />
        <circle cx="91" cy="57" r="2.2" fill="#22301F" />
        <circle cx="105" cy="57" r="2.2" fill="#22301F" />
      </g>
      <g opacity={on("sleep")} stroke="#22301F" strokeWidth="2.3" fill="none" strokeLinecap="round">
        <path d="M87 57 Q91 61 95 57" />
        <path d="M101 57 Q105 61 109 57" />
      </g>
      <g opacity={on("happy", "proud")} stroke="#22301F" strokeWidth="2.5" fill="none" strokeLinecap="round">
        <path d="M87 59 Q91 53 95 59" />
        <path d="M101 59 Q105 53 109 59" />
      </g>
      <g opacity={on("sleepy")}>
        <ellipse cx="91" cy="58.5" rx="3.6" ry="1.9" fill="#22301F" />
        <ellipse cx="105" cy="58.5" rx="3.6" ry="1.9" fill="#22301F" />
        <path d="M86.5 56.6 H95.5 M100.5 56.6 H109.5" stroke="#6E9E62" strokeWidth="2.3" strokeLinecap="round" />
      </g>
      <path
        d={
          mood === "shocked"
            ? "M86 47.5 Q91 44.5 95 47 M101 47 Q105 44.5 110 47.5"
            : "M87 50.5 L95 52.5 M109 50.5 L101 52.5"
        }
        stroke="#22301F"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
        opacity={on("worried", "shocked")}
      />
      <ellipse cx="85.5" cy="65" rx="5" ry="3.2" fill="#F09A8A" opacity="0.6" />
      <ellipse cx="110.5" cy="65" rx="5" ry="3.2" fill="#F09A8A" opacity="0.6" />
      <path d="M94 68 Q98 72.5 102 68" stroke="#22301F" strokeWidth="2.1" fill="none" strokeLinecap="round" opacity={on("sleep", "peek", "listen", "happy", "sleepy")} />
      <path d="M92.5 69.5 Q98 76 103.5 69.5 Z" fill="#4A2A24" stroke="#22301F" strokeWidth="1.6" strokeLinejoin="round" opacity={on("proud")} />
      <path d="M93 70 q2.5 -2.2 5 0 q2.5 2.2 5 0" stroke="#22301F" strokeWidth="2.1" fill="none" strokeLinecap="round" opacity={on("worried")} />
      <ellipse cx="98" cy="69.5" rx="3.6" ry="3" fill="#4A2A24" opacity={on("ask")} />
      <ellipse cx="98" cy="70" rx="3.2" ry="4.2" fill="#4A2A24" opacity={on("shocked")} />
      <path d="M115 41 Q119.5 47.5 115 51 Q110.5 47.5 115 41 Z" fill="#8FD0F2" stroke="#2F7F7A" strokeWidth="1.2" opacity={on("worried", "shocked")} />
    </>
  );
}
