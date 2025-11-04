import axios from "axios";

const API_BASE = "http://localhost:3000/api"; // adjust if needed
const API_KEY = "secret123";

const api = axios.create({
    baseURL: API_BASE,
    headers: {
        "x-api-key": API_KEY,
    },
});

export default api;
