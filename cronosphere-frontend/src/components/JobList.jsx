import { useEffect, useState } from "react";
import api from "../api";
import JobItem from "./JobItem";
import JobRuns from "./JobRuns";
import AddJob from "./AddJob";

export default function JobList() {
  const [jobs, setJobs] = useState([]);
  const [showLogs, setShowLogs] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState(null);

  const fetchJobs = async () => {
    try {
      const res = await api.get("/jobs");
      setJobs(res.data);
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
    }
  };

  const handleJobAdded = (newJob) => {
    // Add newly created job without refreshing whole list
    setJobs(prev => [...prev, newJob]);
  };

  const handleRun = async (id) => {
    await api.post(`/jobs/${id}/run`);
    fetchJobs();
  };

  const handleDelete = async (id) => {
    await api.delete(`/jobs/${id}`);
    fetchJobs();
  };

  const handleToggle = async (id, status) => {
    const newStatus = status === "paused" ? "active" : "paused";
    await api.put(`/jobs/${id}/status`, { status: newStatus });
    fetchJobs();
  };

  const handleViewLogs = (id) => {
    setSelectedJobId(id);
    setShowLogs(true);
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  return (
    <div className="job-list">

    <h2>🕒 Scheduled Jobs</h2>

    <AddJob onJobAdded={handleJobAdded} />

    {/* Render Jobs */}
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

    {/* Logs Modal */}
    {showLogs && (
      <JobRuns jobId={selectedJobId} onClose={() => setShowLogs(false)} />
    )}
    </div>
  );
}
