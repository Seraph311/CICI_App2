import { useState } from "react";
import AddJob from "./AddJob";
import "./AddJobModal.css";

export default function AddJobModal({ visible, onClose, onJobAdded }) {
  if (!visible) return null;

  const handleAdded = (job) => {
    if (onJobAdded) onJobAdded(job);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
    <div
    className="modal-content bounce-in"
    onClick={(e) => e.stopPropagation()}
    >
    <AddJob onJobAdded={handleAdded} />
    </div>
    </div>
  );
}
