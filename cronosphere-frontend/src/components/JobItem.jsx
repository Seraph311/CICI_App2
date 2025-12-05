import { useState } from "react";
import "./JobItem.css";
import DeleteConfirmModal from "./DeleteConfirmModal";

export default function JobItem({ job, onRun, onDelete, onToggle, onViewLogs }) {
  const [showConfirm, setShowConfirm] = useState(false);

  const statusColor = {
    success: "#2ecc71",
    error: "#e74c3c",
    running: "#f1c40f",
    paused: "#7f8c8d",
  }[job.status] || "#7f8c8d";

  const handleDelete = () => {
    setShowConfirm(true);
  };

  const confirmDelete = () => {
    setShowConfirm(false);
    onDelete(job.id);
  };

  return (
    <>
    <div className="job-item" style={{ borderLeft: `5px solid ${statusColor}` }}>
    <div className="job-info">
    <h3>{job.name}</h3>
    <p><strong>Schedule:</strong> {job.schedule}</p>
    <p><strong>Command:</strong> <code>{job.command}</code></p>
    <p><strong>Status:</strong> <span style={{ color: statusColor }}>{job.status || "unknown"}</span></p>
    </div>

    <div className="job-actions">
    <button onClick={() => onRun(job.id)}>▶ Run Now</button>
    <button onClick={() => onToggle(job.id, job.status)}>
    {job.status === "paused" ? "Resume" : "Pause"}
    </button>
    <button onClick={() => onViewLogs(job.id)}>📜 Logs</button>
    <button className="danger" onClick={handleDelete}>🗑 Delete</button>
    </div>
    </div>

    {showConfirm && (
      <DeleteConfirmModal
      jobName={job.name}
      onCancel={() => setShowConfirm(false)}
      onConfirm={confirmDelete}
      />
    )}
    </>
  );
}
