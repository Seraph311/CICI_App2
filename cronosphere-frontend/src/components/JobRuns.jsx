import { useEffect, useState } from "react";
import api from "../api";
import "./JobRuns.css";

export default function JobRuns({ jobId, onClose }) {
    const [runs, setRuns] = useState([]);

    const fetchRuns = async () => {
        try {
            const res = await api.get(`/jobs/${jobId}/runs`);
            setRuns(res.data);
        } catch (err) {
            console.error("Failed to load job runs:", err);
        }
    };

    useEffect(() => {
        fetchRuns();
    }, [jobId]);

    return (
        <div className="logs-modal">
        <div className="logs-content">
        <button className="close-btn" onClick={onClose}>✖ Close</button>
        <h2>📜 Logs for Job #{jobId}</h2>



        {runs.length === 0 && <p>No runs yet.</p>}

        {runs.map((run) => (
            <div key={run.id} className="log-entry">
            <p><strong>Run ID:</strong> {run.id}</p>
            <p><strong>Status:</strong> {run.status}</p>
            <p><strong>Started:</strong> {new Date(run.started_at).toLocaleString()}</p>
            <p><strong>Finished:</strong> {run.finished_at ? new Date(run.finished_at).toLocaleString() : "Running..."}</p>
            <pre className="log-output">{run.output || "(no output)"}</pre>
            </div>
        ))}
        </div>
        </div>
    );
}
