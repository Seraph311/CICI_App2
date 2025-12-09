import { useState } from "react";
import "./DeleteConfirmModal.css";

export default function DeleteConfirmModal({ jobName, onCancel, onConfirm }) {
  const [closing, setClosing] = useState(false);

  const handleCancel = () => {
    setClosing(true);
    setTimeout(() => {
      onCancel();
    }, 250);
  };

  const handleConfirm = () => {
    setClosing(true);
    setTimeout(() => {
      onConfirm();
    }, 250);
  };

  return (
    <div className="confirm-modal-overlay">
    <div className={`confirm-modal ${closing ? 'closing' : ''}`}>
    <h2>Confirm Deletion</h2>
    <p>
    Are you sure you want to delete job:
    <br />
    <strong>"{jobName}"</strong>?
    </p>

    <div className="confirm-actions">
    <button className="cancel-btn" onClick={handleCancel}>Cancel</button>
    <button className="delete-btn" onClick={handleConfirm}>Delete</button>
    </div>
    </div>
    </div>
  );
}
