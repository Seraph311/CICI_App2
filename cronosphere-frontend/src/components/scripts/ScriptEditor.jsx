import { useState, useEffect } from "react";
import api from "../../api";
import "./ScriptManager.css";

export default function ScriptEditor({ script, onSaved }) {
    const [name, setName] = useState("");
    const [content, setContent] = useState("");
    const [type, setType] = useState("bash");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (script) {
            setName(script.name);
            setContent(script.content);
            setType(script.type || "bash");
        } else {
            setName("");
            setContent("#!/bin/bash\n\n");
            setType("bash");
        }
    }, [script]);

    const save = async () => {
        if (!name.trim()) {
            alert("Script name is required");
            return;
        }

        if (!content.trim()) {
            alert("Script content is required");
            return;
        }

        setSaving(true);
        try {
            const payload = { name, content, type };
            let res;

            if (script) {
                res = await api.put(`/scripts/${script.id}`, payload);
            } else {
                res = await api.post("/scripts", payload);
            }

            alert("Script saved!");
            onSaved(res.data);
        } catch (err) {
            console.error(err);
            alert(err.response?.data?.error || "Save failed");
        } finally {
            setSaving(false);
        }
    };

    const createNew = () => {
        setName("");
        setContent("#!/bin/bash\n\n");
        setType("bash");
        onSaved(null);
    };

    return (
        <div className="script-editor">
        <h3>{script ? "Edit Script" : "Create Script"}</h3>

        <div className="form-group">
        <label>Script Name</label>
        <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Script name"
        required
        />
        </div>

        <div className="form-group">
        <label>Script Type</label>
        <select value={type} onChange={(e) => setType(e.target.value)}>
        <option value="bash">Bash Script</option>
        <option value="node">Node.js Script</option>
        </select>
        </div>

        <div className="form-group">
        <label>Content</label>
        <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="#!/bin/bash\n\n"
        rows={15}
        spellCheck="false"
        />
        <small className="hint">
        {type === "bash" ? "Use $JOB_ID, $USER_ID, $JOB_NAME, $USER_TEMP_DIR environment variables" :
            "Use process.env.JOB_ID, process.env.USER_ID, etc."}
            </small>
            </div>

            <div className="editor-actions">
            <button onClick={save} disabled={saving}>
            {saving ? "Saving..." : "💾 Save Script"}
            </button>
            {script && (
                <button onClick={createNew} className="secondary">
                ✨ Create New
                </button>
            )}
            </div>
            </div>
    );
}
