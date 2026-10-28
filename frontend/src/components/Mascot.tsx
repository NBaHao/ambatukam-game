import "./Mascot.css";

/** idle: màn bắt đầu · tired: điểm thấp · almost: suýt tới (Ambatu…) · kam: Ambatukam trở lên */
export type MascotMood = "idle" | "tired" | "almost" | "kam";

const INK = "#0b0b0b";
const BODY = "#f2f2f2";
const SHADE = "#cfcfcf";
const RED = "#ff3b3b";
const SWEAT = "#7cc8ff";

function Eyes({ mood }: { mood: MascotMood }) {
  if (mood === "tired") {
    // Mắt lờ đờ: mí sụp nửa
    return (
      <g fill={INK}>
        <path d="M44 62 a7 7 0 0 0 14 0 z" />
        <path d="M66 62 a7 7 0 0 0 14 0 z" />
        <path d="M42 60 h18 M64 60 h18" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      </g>
    );
  }
  if (mood === "almost") {
    // Nhắm tịt, gồng: > <
    return (
      <g fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M44 54 l12 7 l-12 7" />
        <path d="M80 54 l-12 7 l12 7" />
      </g>
    );
  }
  if (mood === "kam") {
    // Mắt sao
    const star = "M0 -9 L2.6 -2.8 L9 -2.8 L3.9 1.2 L5.6 7.8 L0 4 L-5.6 7.8 L-3.9 1.2 L-9 -2.8 L-2.6 -2.8 Z";
    return (
      <g fill={RED} stroke={INK} strokeWidth="2" strokeLinejoin="round">
        <path d={star} transform="translate(51 60) scale(1.15)" />
        <path d={star} transform="translate(73 60) scale(1.15)" />
      </g>
    );
  }
  return (
    <g>
      <ellipse cx="51" cy="60" rx="5" ry="7" fill={INK} />
      <ellipse cx="73" cy="60" rx="5" ry="7" fill={INK} />
      <circle cx="53" cy="57" r="1.8" fill={BODY} />
      <circle cx="75" cy="57" r="1.8" fill={BODY} />
    </g>
  );
}

function Mouth({ mood }: { mood: MascotMood }) {
  if (mood === "tired") {
    return <path d="M54 82 q4 -3 8 0 q4 3 8 0" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />;
  }
  if (mood === "almost") {
    // Nghiến răng
    return (
      <g>
        <rect x="50" y="76" width="24" height="11" rx="4" fill={BODY} stroke={INK} strokeWidth="3" />
        <path d="M56 77 v9 M62 77 v9 M68 77 v9" stroke={INK} strokeWidth="2" />
      </g>
    );
  }
  if (mood === "kam") {
    return (
      <g stroke={INK} strokeWidth="3">
        <ellipse cx="62" cy="84" rx="10" ry="12" fill={INK} />
        <ellipse cx="62" cy="91" rx="6" ry="4" fill={RED} stroke="none" />
      </g>
    );
  }
  return <path d="M53 78 q9 9 18 0" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />;
}

function Arms({ mood }: { mood: MascotMood }) {
  const d =
    mood === "kam"
      ? "M37 92 l-14 -22 l-4 -12 M87 92 l14 -22 l4 -12" // giơ hai tay
      : mood === "almost"
        ? "M37 96 l-14 -6 l-2 -12 M87 96 l14 -6 l2 -12" // gồng
        : mood === "tired"
          ? "M37 96 l-10 18 M87 96 l10 18" // buông thõng
          : "M37 96 l-12 10 M87 96 l12 -10 l4 -10"; // vẫy tay
  return <path d={d} fill="none" stroke={BODY} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />;
}

/** Mascot "Trụ": cây trụ có mặt, vẽ phẳng 2D */
export function Mascot({ mood, className }: { mood: MascotMood; className?: string }) {
  return (
    <svg
      className={`mascot mascot-${mood}${className ? ` ${className}` : ""}`}
      viewBox="0 0 124 160"
      aria-hidden="true"
    >
      {mood === "kam" && (
        <g className="mascot-burst">
          <path
            d="M62 -2 L72 34 L106 14 L92 50 L128 58 L94 74 L112 106 L76 92 L62 128 L48 92 L12 106 L30 74 L-4 58 L32 50 L18 14 L52 34 Z"
            fill={RED}
          />
        </g>
      )}
      <g className="mascot-body">
        <Arms mood={mood} />
        <rect x="37" y="22" width="50" height="126" rx="25" fill={BODY} />
        {/* Mảng tối phẳng bên phải, không gradient */}
        <path d="M74 25 a25 25 0 0 1 13 22 v76 a25 25 0 0 1 -13 22 z" fill={SHADE} />
        <ellipse cx="44" cy="74" rx="5" ry="3" fill={RED} opacity=".55" />
        <ellipse cx="80" cy="74" rx="5" ry="3" fill={RED} opacity=".55" />
        <Eyes mood={mood} />
        <Mouth mood={mood} />
        {(mood === "tired" || mood === "almost") && (
          <path d="M92 40 q6 9 0 13 q-6 -4 0 -13 z" fill={SWEAT} stroke={INK} strokeWidth="2" />
        )}
        {mood === "almost" && <path d="M30 34 q-5 8 0 11 q5 -3 0 -11 z" fill={SWEAT} stroke={INK} strokeWidth="2" />}
      </g>
    </svg>
  );
}
