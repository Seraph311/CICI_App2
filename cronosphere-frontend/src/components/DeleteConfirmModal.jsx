import "./DeleteConfirmModal.css";

export default function DeleteConfirmModal({ jobName, onCancel, onConfirm }) {
  return (
    <div className="confirm-modal-overlay">
      <div className="confirm-modal">
        <h2>Confirm Deletion</h2>
        <p>
          Are you sure you want to delete job:
          <br />
          <strong>"{jobName}"</strong>?
        </p>

        <div className="confirm-actions">
          <button className="cancel-btn" onClick={onCancel}>Cancel</button>
          <button className="delete-btn" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}
