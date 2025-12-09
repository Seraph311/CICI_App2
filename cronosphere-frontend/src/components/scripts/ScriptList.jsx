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
            setScripts(res.data || []);
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
            {scripts.map((s) => (
                <li key={s.id} onClick={() => onSelect(s)}>
                <div className="script-item-header">
                <strong>{s.name}</strong>
                <span className="script-type">{s.type}</span>
                <button
                className="delete-btn"
                onClick={(e) => handleDelete(s.id, e)}
                >
                🗑
                </button>
                </div>
                <pre className="script-preview">{s.content.slice(0, 80)}...</pre>
                <small>Created: {new Date(s.created_at).toLocaleDateString()}</small>
                </li>
            ))}
            </ul>
        )}
        </div>
    );
}
