import { useState } from "react";
import ScriptList from "./scripts/ScriptList";
import ScriptEditor from "./scripts/ScriptEditor";

export default function ScriptManager() {
    const [selected, setSelected] = useState(null);

    return (
        <div>
            <h2>Script Manager</h2>

            <div style={{ display: "flex", gap: "20px" }}>
                <div style={{ flex: 1 }}>
                    <ScriptList onSelect={setSelected} />
                </div>

                <div style={{ flex: 2 }}>
                    <ScriptEditor
                        script={selected}
                        onSaved={() => setSelected(null)}
                    />
                </div>
            </div>
        </div>
    );
}
