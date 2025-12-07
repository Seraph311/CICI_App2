import { useEffect, useRef, useState } from "react";
import api from "../api";
import JobItem from "./JobItem";
import FAB from "./FAB";
import JobRuns from "./JobRuns";
import "./JobList.css";

export default function JobList({ onAddClick, reloadCounter = 0 }) {
  const [jobs, setJobs] = useState([]);
  const [showFAB, setShowFAB] = useState(false);
  const addBtnRef = useRef(null);

  // logs modal state
  const [showLogs, setShowLogs] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState(null);

  const loadJobs = async () => {
    try {
      const res = await api.get("/jobs");
      setJobs(res.data || []);
    } catch (err) {
      console.error("Failed loading jobs:", err);
    }
  };

  useEffect(() => {
    // initial load
    loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload whenever the parent signals a change (Add/Update)
  useEffect(() => {
    loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadCounter]);

  // === Job actions === //
  const handleRun = async (id) => {
    try {
      await api.post(`/jobs/${id}/run`);
      await loadJobs();
    } catch (err) {
      console.error("Run job failed:", err);
      alert(err.response?.data?.error || "Failed to run job");
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/jobs/${id}`);
      await loadJobs();
    } catch (err) {
      console.error("Delete failed:", err);
      alert(err.response?.data?.error || "Failed to delete");
    }
  };

  const handleToggle = async (id, status) => {
    try {
      // compute newStatus (server expects PUT /:id/status with {status})
      const newStatus = status === "paused" ? "active" : "paused";
      await api.put(`/jobs/${id}/status`, { status: newStatus });
      await loadJobs();
    } catch (err) {
      console.error("Toggle failed:", err);
      alert(err.response?.data?.error || "Failed to toggle job status");
    }
  };

  const handleViewLogs = async (id) => {
    setSelectedJobId(id);
    setShowLogs(true);
  };

  // === Detect visibility of Centered Add Button === //
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        setShowFAB(!entries[0].isIntersecting);
      },
      { threshold: 0.1 }
    );

    if (addBtnRef.current) observer.observe(addBtnRef.current);

    return () => observer.disconnect();
  }, []);

  return (
    <div className="joblist-wrapper">
    {/* Centered Add Button */}
    <div className="addjob-center-wrapper" ref={addBtnRef}>
    <button className="addjob-center-btn" onClick={onAddClick}>
    + Add Job
    </button>
    </div>

    {/* Job List */}
    <div className="jobs-container">
    {jobs.length === 0 && <p className="empty-note">No jobs yet — click “Add Job” to create one.</p>}
    {jobs.map((job) => (
      <JobItem
      key={job.id}
      job={job}
      onRun={handleRun}
      onDelete={handleDelete}
      onToggle={handleToggle}
      onViewLogs={handleViewLogs}
      />
    ))}
    </div>

    {/* FAB (floating action button) */}
    <FAB visible={showFAB} onClick={onAddClick} />

    {/* Logs modal */}
    {showLogs && (
      <JobRuns jobId={selectedJobId} onClose={() => setShowLogs(false)} />
    )}
    </div>
  );
}
