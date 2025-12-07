import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import api from './api';
import Login from './components/Login';
import Register from './components/Register';
import JobList from './components/JobList';
import AddJobModal from "./components/AddJobModal";
import './App.css';

function ProtectedRoute({ children }) {
  const token = localStorage.getItem('token');
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {

  const [showAddModal, setShowAddModal] = useState(false);
  const [reloadCounter, setReloadCounter] = useState(0); // used to signal JobList to refresh

  const [user, setUser] = useState(null);

  useEffect(() => {
    // If token exists, try to fetch profile
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

    // Called when AddJobModal successfully creates a job
    const handleJobAdded = (job) => {
      // close modal and bump the reload counter so JobList reloads
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
        <button onClick={handleLogout}>Logout</button>
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
        {/* JobList receives reloadCounter so it refreshes when changed */}
        <JobList onAddClick={() => setShowAddModal(true)} reloadCounter={reloadCounter} />
        <AddJobModal visible={showAddModal} onClose={() => setShowAddModal(false)} onJobAdded={handleJobAdded} />
        </div>
        </ProtectedRoute>
      } />

      <Route path="/login" element={<Login onLogin={handleLogin} />} />
      <Route path="/register" element={<Register onRegister={handleLogin} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </main>
      </div>
      </BrowserRouter>
    );
}
