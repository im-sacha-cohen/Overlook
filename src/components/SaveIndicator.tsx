export function SaveIndicator({
  visible,
  label,
  revertLabel,
  onRevert,
}: {
  visible: boolean;
  label: string;
  revertLabel: string;
  onRevert: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 22,
        right: 22,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 8px 7px 10px",
        background: "#fff",
        border: "1px solid #e5e2db",
        borderRadius: 8,
        boxShadow: "var(--shadow-pop)",
        fontSize: 12.5,
        color: "#6f6b62",
        zIndex: 85,
        transition: "opacity 0.18s ease, transform 0.18s ease",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(4px)",
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <span style={{ color: "#5f9c6e", fontSize: 12 }}>✓</span>
      <span>{label}</span>
      <button
        onClick={onRevert}
        style={{
          border: "none",
          background: "transparent",
          color: "#8b877e",
          fontSize: 12.5,
          cursor: "pointer",
          padding: "2px 3px",
          borderRadius: 5,
          textDecoration: "underline",
          textUnderlineOffset: 2,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "#8b877e")}
      >
        {revertLabel}
      </button>
    </div>
  );
}
