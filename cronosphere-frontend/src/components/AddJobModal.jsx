import { useState } from "react";
import AddJob from "./AddJob";
import "./AddJobModal.css";

export default function AddJobModal({ visible, onClose, onJobAdded }) {
  const [closing, setClosing] = useState(false);

  if (!visible && !closing) return null;

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onClose();
    }, 250); // matches bounceOut duration
  };

  const handleAdded = (job) => {
    if (onJobAdded) onJobAdded(job);
    handleClose();
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
    <div
    className={`modal-content ${closing ? "bounce-out" : "bounce-in"}`}
    onClick={(e) => e.stopPropagation()}
    >
    <AddJob onJobAdded={handleAdded} />
    </div>
    </div>
  );
}
