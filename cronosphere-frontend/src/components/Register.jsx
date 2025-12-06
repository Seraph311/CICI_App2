import { useState } from 'react';
import api from '../api';
import { useNavigate } from 'react-router-dom';
import "./Auth.css";

export default function Register({ onRegister }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post('/auth/register', { username, password });
      const { user, token } = res.data;
      onRegister({ user, token });
      nav('/');
    } catch (err) {
      alert(err.response?.data?.error || 'Register failed');
    }
  };

  return (
    <div className="auth-container">
    <h2 className="auth-title">Register</h2>

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

    <button className="auth-button" type="submit">Create Account</button>
    </form>

    <div className="auth-link">
    <a href="/login">Already have an account?</a>
    </div>
    </div>
  );
}
