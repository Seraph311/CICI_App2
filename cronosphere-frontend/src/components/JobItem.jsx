import "./JobItem.css";

export default function JobItem({ job, onRun, onDelete, onToggle }) {
  const statusColor = {
    success: "green",
    error: "red",
    running: "gold",
    paused: "gray",
  }[job.status || "gray"];

  return (
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
    <button className="danger" onClick={() => onDelete(job.id)}>🗑 Delete</button>
    </div>
    </div>
  );
}
