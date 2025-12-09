import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import api from './api';
import Login from './components/Login';
import Register from './components/Register';
import JobList from './components/JobList';
import AddJobModal from "./components/AddJobModal";
import ScriptManager from "./components/ScriptManager";
import './App.css';

function ProtectedRoute({ children }) {
  const token = localStorage.getItem('token');
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [reloadCounter, setReloadCounter] = useState(0);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const raw = localStorage.getItem('user');
    if (raw) setUser(JSON.parse(raw));
  }, []);

    const handleLogin = ({ user, token }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      setUser(user);
    };

    const handleLogout = () => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      setUser(null);
    };

    const handleJobAdded = (job) => {
      setShowAddModal(false);
      setReloadCounter((c) => c + 1);
    };

    return (
      <BrowserRouter>
      <div className="app-shell">
      <header className="app-header">
      <h1>⚙️ Cronosphere</h1>
      <div>
      {user ? (
        <>
        <span style={{ marginRight: 12 }}>👤 {user.username}</span>
        <button onClick={handleLogout} style={{ marginLeft: 8 }}>Logout</button>
        </>
      ) : (
        <>
        <a href="/login" style={{ marginRight: 8 }}>Login</a>
        <a href="/register">Register</a>
        </>
      )}
      </div>
      </header>

      <main className="App">
      <Routes>
      <Route path="/" element={
        <ProtectedRoute>
        <div className="dashboard">
        <JobList onAddClick={() => setShowAddModal(true)} reloadCounter={reloadCounter} />
        <AddJobModal visible={showAddModal} onClose={() => setShowAddModal(false)} onJobAdded={handleJobAdded} />
        </div>
        </ProtectedRoute>
      } />

      <Route path="/login" element={<Login onLogin={handleLogin} />} />
      <Route path="/register" element={<Register onRegister={handleLogin} />} />
      <Route path="/scripts" element={
        <ProtectedRoute>
        <ScriptManager />
        </ProtectedRoute>
      } />
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </main>
      </div>
      </BrowserRouter>
    );
}
