import { useState } from "react";
import api from "../api";
import "./AddJob.css";

export default function AddJob({ onJobAdded }) {
    const [name, setName] = useState("");
    const [command, setCommand] = useState("");

    const [month, setMonth] = useState("");
    const [day, setDay] = useState("");
    const [weekday, setWeekday] = useState("");
    const [time, setTime] = useState("");

    const [advanced, setAdvanced] = useState(false);
    const [manualCron, setManualCron] = useState("");

    const [showCommandModal, setShowCommandModal] = useState(false);

    // --- CRON DESCRIPTION PARSER ---
    const describeCron = (cron) => {
        if (!cron || !cron.trim()) return "";

        const parts = cron.trim().split(/\s+/);
        if (parts.length !== 5) return "Invalid CRON format";

        const [min, hour, day, mon, wk] = parts;

        const describeField = (value, name, max) => {
            if (value === "*") return `every ${name}`;
            if (value.includes("*/")) return `every ${value.replace("*/", "")} ${name}`;
            if (value.includes(",")) return `${name}s ${value}`;
            if (value.includes("-")) return `${name}s ${value}`;
            return `${name} ${value}`;
        };

        const minuteDesc = describeField(min, "minute", 59);
        const hourDesc = describeField(hour, "hour", 23);
        const dayDesc = describeField(day, "day", 31);
        const monthDesc = describeField(mon, "month", 12);

        const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        let weekdayDesc =
        wk === "*"
        ? "every day"
        : wk.includes(",") || wk.includes("-")
        ? `on weekdays ${wk}`
        : `on ${weekdays[parseInt(wk)] || wk}`;

        return `${minuteDesc}, ${hourDesc}, ${dayDesc}, ${monthDesc}, ${weekdayDesc}`;
    };

    const buildCron = () => {
        let min = "*";
        let hr = "*";

        if (time) {
            const [h, m] = time.split(":");
            hr = h;
            min = m;
        }

        return `${min} ${hr} ${day || "*"} ${month || "*"} ${weekday || "*"}`;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        const finalSchedule = advanced ? manualCron : buildCron();

        try {
            const res = await api.post("/jobs", {
                name,
                command,
                schedule: finalSchedule,
            });

            onJobAdded(res.data);

            setName("");
            setCommand("");
            setMonth("");
            setDay("");
            setWeekday("");
            setTime("");
            setManualCron("");

        } catch (err) {
            console.error("Failed to add job:", err);
            alert(err.response?.data?.error || "Failed to add job");
        }
    };

    return (
        <div>
        <form onSubmit={handleSubmit} className="add-job-form">

        <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Job name"
        required
        />

        <button
        type="button"
        className="edit-command-btn"
        onClick={() => setShowCommandModal(true)}
        >
        ✏️ Edit Command
        </button>

        <div className="command-preview">
        <strong>Command:</strong>
        <pre>{command || "(empty)"}</pre>
        </div>

        {/* MODE SWITCH */}
        <div className="mode-switch">
        <label>
        <input
        type="radio"
        checked={!advanced}
        onChange={() => setAdvanced(false)}
        />{" "}
        Basic
        </label>

        <label style={{ marginLeft: "20px" }}>
        <input
        type="radio"
        checked={advanced}
        onChange={() => setAdvanced(true)}
        />{" "}
        Advanced (Manual CRON)
        </label>
        </div>

        {/* BASIC */}
        {!advanced && (
            <>
            <label className="section-label">Choose date & time:</label>

            <div className="schedule-container">

            <div className="row">
            <div className="field">
            <label>Month</label>
            <select value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">*</option>
            {[...Array(12)].map((_, i) => (
                <option key={i} value={i + 1}>{i + 1}</option>
            ))}
            </select>
            </div>

            <div className="field">
            <label>Day</label>
            <select value={day} onChange={(e) => setDay(e.target.value)}>
            <option value="">*</option>
            {[...Array(31)].map((_, i) => (
                <option key={i} value={i + 1}>{i + 1}</option>
            ))}
            </select>
            </div>
            </div>

            <div className="row">
            <div className="field wide">
            <label>Time (HH:MM)</label>
            <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            />
            </div>
            </div>

            <div className="row">
            <div className="field">
            <label>Weekday</label>
            <select value={weekday} onChange={(e) => setWeekday(e.target.value)}>
            <option value="">*</option>
            {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d, i) => (
                <option key={i} value={i}>{d}</option>
            ))}
            </select>
            </div>
            </div>

            </div>

            <div className="cron-preview">
            <small>Schedule: <code>{buildCron()}</code></small>
            </div>
            </>
        )}

        {/* ADVANCED */}
        {advanced && (
            <div className="advanced-input">
            <label>Manual CRON Expression</label>
            <textarea
            value={manualCron}
            placeholder="*/5 * * * *"
            onChange={(e) => setManualCron(e.target.value)}
            style={{ width: "100%", height: "80px" }}
            required
            />

            {/* CRON DESCRIPTION */}
            {manualCron.trim() && (
                <div className="cron-preview" style={{ marginTop: "8px" }}>
                <small>
                Description: <em>{describeCron(manualCron)}</em>
                </small>
                </div>
            )}
            </div>
        )}

        <button type="submit">➕ Add Job</button>
        </form>

        {showCommandModal && (
            <div className="cmd-modal">
            <div className="cmd-content">
            <h3>✏️ Edit Command</h3>

            <textarea
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="Enter shell command here..."
            />

            <div className="cmd-actions">
            <button onClick={() => setShowCommandModal(false)}>Close</button>
            </div>
            </div>
            </div>
        )}
        </div>
    );
}
