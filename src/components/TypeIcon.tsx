import type { LogicalType } from "@/lib/types";
import { iconFor } from "@/lib/client/format";

// Column type marker. Dates get a drawn calendar, the same one as the date picker.
export function TypeIcon({ type, style }: { type: LogicalType; style?: React.CSSProperties }) {
  if (type === "date") {
    return (
      <svg aria-hidden width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ flex: "none", color: "#c2bdb3", ...style, fontSize: undefined }}>
        <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
        <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
      </svg>
    );
  }
  return <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#c2bdb3", ...style }}>{iconFor(type)}</span>;
}
