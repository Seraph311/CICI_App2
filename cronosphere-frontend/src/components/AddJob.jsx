import { useState } from "react";
import api from "../api";

export default function AddJob({ onJobAdded }) {
    const [name, setName] = useState("");
    const [command, setCommand] = useState("");
    const [schedule, setSchedule] = useState("");

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const res = await api.post("/jobs", { name, command, schedule });
            onJobAdded(res.data); // update JobList
            setName(""); setCommand(""); setSchedule("");
        } catch (err) {
            console.error("Failed to add job:", err);
            alert(err.response?.data?.error || "Failed to add job");
        }
    };

    return (
        <form onSubmit={handleSubmit} className="add-job-form">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Job name" required />
        <input value={command} onChange={e => setCommand(e.target.value)} placeholder="Command" required />
        <input value={schedule} onChange={e => setSchedule(e.target.value)} placeholder="Cron schedule" required />
        <button type="submit">➕ Add Job</button>
        </form>
    );
}
