import { useState } from 'react';
import api from '../api';
import { useNavigate } from 'react-router-dom';

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
    <div className="auth-form">
      <h2>Register</h2>
      <form onSubmit={submit}>
        <input value={username} onChange={e => setUsername(e.target.value)} placeholder="username" required />
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="password" required />
        <button type="submit">Register</button>
      </form>
    </div>
  );
}
