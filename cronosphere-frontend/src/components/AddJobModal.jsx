import { useState } from "react";
import AddJob from "./AddJob";
import "./AddJobModal.css";

export default function AddJobModal({ visible, onClose }) {
  if (!visible) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content bounce-in"
        onClick={(e) => e.stopPropagation()}
      >
        <AddJob onJobAdded={onClose} />
      </div>
    </div>
  );
}
