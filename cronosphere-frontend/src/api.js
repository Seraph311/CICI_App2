// src/api.js
import axios from 'axios';

const API_BASE = 'http://localhost:3000/api';

const api = axios.create({
    baseURL: API_BASE,
});

// attach token automatically
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

export default api;
