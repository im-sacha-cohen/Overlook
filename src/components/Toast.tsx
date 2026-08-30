export function Toast({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div
      style={{
        position: "fixed",
        bottom: 22,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 14px",
        background: "#26241f",
        color: "#f7f6f2",
        borderRadius: 9,
        fontSize: 13,
        boxShadow: "0 12px 30px rgba(35,31,24,0.2)",
        zIndex: 90,
        animation: "om-pop 0.14s ease",
      }}
    >
      {message}
    </div>
  );
}
