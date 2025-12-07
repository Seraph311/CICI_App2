import "./FAB.css";

export default function FAB({ visible, onClick }) {
  if (!visible) return null;

  return (
    <button className="fab" onClick={onClick}>
      + Add Job
    </button>
  );
}
