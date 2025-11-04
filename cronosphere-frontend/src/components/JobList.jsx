import { useEffect, useState } from "react";
import api from "../api";
import JobItem from "./JobItem";

export default function JobList() {
  const [jobs, setJobs] = useState([]);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [schedule, setSchedule] = useState("");

  const fetchJobs = async () => {
    try {
      const res = await api.get("/jobs");
      setJobs(res.data);
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
    }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post("/jobs", { name, command, schedule });
      setJobs([res.data, ...jobs]); // prepend new job
      setName(""); setCommand(""); setSchedule("");
    } catch (err) {
      console.error("Failed to add job:", err);
      alert(err.response?.data?.error || "Failed to add job");
    }
  };

  const handleRun = async (id) => {
    await api.post(`/jobs/${id}/run`);
    fetchJobs();
  };

  const handleDelete = async (id) => {
    if (!confirm("Are you sure you want to delete this job?")) return;
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

    {/* Add Job Form */}
    <form onSubmit={handleAdd} className="add-job-form">
    <input
    value={name}
    onChange={(e) => setName(e.target.value)}
    placeholder="Job name"
    required
    />
    <input
    value={command}
    onChange={(e) => setCommand(e.target.value)}
    placeholder="Command"
    required
    />
    <input
    value={schedule}
    onChange={(e) => setSchedule(e.target.value)}
    placeholder="Cron schedule"
    required
    />
    <button type="submit">➕ Add Job</button>
    </form>

    {/* Job List */}
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
