import { useState, useEffect } from "react";
import api from "../../api";
import "./ScriptManager.css";

// Frontend validation patterns (subset for performance)
const FORBIDDEN_PATTERNS = [
];

const NODE_FORBIDDEN_PATTERNS = [
];

function validateScript(content, type = 'bash') {
  if (!content) return "Script content is required";


  return null;
}

export default function ScriptEditor({ script, onSaved }) {
    const [name, setName] = useState("");
    const [content, setContent] = useState("");
    const [type, setType] = useState("bash");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (script) {
            setName(script.name || "");
            setContent(script.content || "");
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

        // Frontend validation
        const validationError = validateScript(content, type);
        if (validationError) {
            alert(`Validation Error: ${validationError}\n\nPlease remove any dangerous operations like sudo, rm -rf, eval(), etc.`);
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

    const handleTypeChange = (newType) => {
        setType(newType);
        // Update default content based on type
        if (!content.trim() || content === "#!/bin/bash\n\n") {
            if (newType === 'node') {
                setContent("#!/usr/bin/env node\n\nconsole.log('Node.js script');");
            } else {
                setContent("#!/bin/bash\n\necho 'Bash script'");
            }
        }
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
        <select value={type} onChange={(e) => handleTypeChange(e.target.value)}>
        <option value="bash">Bash Script</option>
        <option value="node">Node.js Script</option>
        </select>
        </div>

        <div className="form-group">
        <label>Content</label>
        <textarea
        className="terminal-editor"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={type === "bash"
          ? "#!/bin/bash\n\n# Your script here\n# Use environment variables: $JOB_ID, $USER_ID, $JOB_NAME, $USER_TEMP_DIR\n# WARNING: Dangerous commands like sudo, rm -rf are blocked"
          : "#!/usr/bin/env node\n\n// Your script here\n// Use environment variables: process.env.JOB_ID, process.env.USER_ID, etc.\n// WARNING: Dangerous operations like child_process, eval() are blocked"
        }
        rows={15}
        spellCheck="false"
        />
        <small className="hint">
        {type === "bash"
          ? "Allowed: echo, cat, ls, grep, etc. | Blocked: sudo, rm -rf, eval, exec, systemctl, etc."
          : "Allowed: console.log, basic operations | Blocked: child_process, eval, process.exit, etc."
        }
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
