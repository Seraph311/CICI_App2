import { useState } from 'react';
import api from '../api';
import { useNavigate } from 'react-router-dom';
import "./Auth.css";

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post('/auth/login', { username, password });
      const { user, token } = res.data;
      onLogin({ user, token });
      nav('/');
    } catch (err) {
      alert(err.response?.data?.error || 'Login failed');
    }
  };

  return (
    <div className="auth-container">
    <h2 className="auth-title">Login</h2>

    <form className="auth-form" onSubmit={submit}>
    <input
    className="auth-input"
    type="text"
    placeholder="Username"
    value={username}
    onChange={e => setUsername(e.target.value)}
    required
    />

    <input
    className="auth-input"
    type="password"
    placeholder="Password"
    value={password}
    onChange={e => setPassword(e.target.value)}
    required
    />

    <button className="auth-button" type="submit">Sign In</button>
    </form>

    <div className="auth-link">
    <a href="/register">Create an account</a>
    </div>
    </div>
  );
}
