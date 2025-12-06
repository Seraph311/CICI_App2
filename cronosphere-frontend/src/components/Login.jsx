import { useState } from 'react';
import api from '../api';
import { useNavigate } from 'react-router-dom';

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
    <div className="auth-form">
      <h2>Login</h2>
      <form onSubmit={submit}>
        <input value={username} onChange={e => setUsername(e.target.value)} placeholder="username" required />
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="password" required />
        <button type="submit">Login</button>
      </form>
    </div>
  );
}
