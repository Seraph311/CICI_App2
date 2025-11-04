import { useEffect, useState } from "react";
import api from "../api";
import JobItem from "./JobItem";

export default function JobList() {
  const [jobs, setJobs] = useState([]);

  const fetchJobs = async () => {
    try {
      const res = await api.get("/jobs");
      setJobs(res.data);
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
    }
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

  useEffect(() => {
    fetchJobs();
  }, []);

  return (
    <div className="job-list">
    <h2>🕒 Scheduled Jobs</h2>
    {jobs.map((job) => (
      <JobItem
      key={job.id}
      job={job}
      onRun={handleRun}
      onDelete={handleDelete}
      onToggle={handleToggle}
      />
    ))}
    </div>
  );
}
