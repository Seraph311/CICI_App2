import { useEffect, useState } from "react";
import api from "../../api";
import "./ScriptManager.css";

export default function ScriptList({ onSelect }) {
    const [scripts, setScripts] = useState([]);
    const [loading, setLoading] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const res = await api.get("/scripts");
            // Ensure we have an array and each item has the expected properties
            const scriptsData = Array.isArray(res.data) ? res.data : [];
            setScripts(scriptsData);
        } catch (err) {
            console.error("Failed to load scripts:", err);
            alert(err.response?.data?.error || "Failed to load scripts");
            setScripts([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    const handleDelete = async (id, e) => {
        e.stopPropagation();
        if (!window.confirm("Delete this script?")) return;

        try {
            await api.delete(`/scripts/${id}`);
            load(); // Reload the list
        } catch (err) {
            alert(err.response?.data?.error || "Delete failed");
        }
    };

    return (
        <div className="script-list">
        <h3>Saved Scripts</h3>

        <button className="refresh-btn" onClick={load} disabled={loading}>
        {loading ? "Loading..." : "⟳ Refresh"}
        </button>

        {loading && scripts.length === 0 ? (
            <p>Loading scripts...</p>
        ) : scripts.length === 0 ? (
            <p>No scripts saved. Create one!</p>
        ) : (
            <ul>
            {scripts.map((s) => {
                // Safely extract script properties
                const scriptId = s.id || s.Id || "";
                const scriptName = s.name || s.Name || "Unnamed Script";
                const scriptType = s.type || s.Type || "bash";
                const scriptContent = s.content || s.Content || "";
                const createdAt = s.created_at || s.createdAt || s.CreatedAt;

                return (
                    <li key={scriptId} onClick={() => onSelect(s)}>
                    <div className="script-item-header">
                    <strong>{scriptName}</strong>
                    <span className="script-type">{scriptType}</span>
                    <button
                    className="delete-btn"
                    onClick={(e) => handleDelete(scriptId, e)}
                    >
                    🗑
                    </button>
                    </div>
                    <pre className="script-preview">
                    {(scriptContent || "").slice(0, 80)}...
                    </pre>
                    <small>
                    Created: {createdAt ? new Date(createdAt).toLocaleDateString() : "Unknown"}
                    </small>
                    </li>
                );
            })}
            </ul>
        )}
        </div>
    );
}
