import axios from 'axios';

const API_BASE = "https://cronosphere-backend.onrender.com/api";

const api = axios.create({
    baseURL: API_BASE,
});

api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

export default api;
