import axios from 'axios';

const TOKEN_KEY = 'ffm-auth-token';

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 120000,
});

// Attach token to every request
api.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) config.headers['Authorization'] = `Bearer ${token}`;
  return config;
});

// On 401, clear token and reload to show login
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      setStoredToken(null);
      window.location.reload();
    }
    return Promise.reject(err);
  },
);

export async function uploadFile(file, onProgress) {
  const formData = new FormData();
  formData.append('file', file);

  const res = await api.post('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (onProgress && e.total) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    },
  });
  return res.data;
}

export async function startConvert(payload) {
  const res = await api.post('/convert', payload);
  return res.data;
}

export async function startMerge(payload) {
  const res = await api.post('/merge', payload);
  return res.data;
}

export async function startTimelineExport(payload) {
  const res = await api.post('/timeline/export', payload);
  return res.data;
}

export async function getJobStatus(jobId) {
  const res = await api.get(`/jobs/${jobId}`);
  return res.data;
}

export async function cancelJob(jobId) {
  const res = await api.delete(`/jobs/${jobId}`);
  return res.data;
}

export async function getFileWaveform(fileId, bars = 160) {
  const res = await api.get(`/files/${fileId}/waveform`, {
    params: { bars },
  });
  return res.data;
}

export function getDownloadUrl(jobId) {
  return `/api/v1/download/${jobId}`;
}

export async function deleteFile(fileId) {
  const res = await api.delete(`/files/${fileId}`);
  return res.data;
}

export async function login(username, password) {
  const res = await api.post('/auth/login', { username, password });
  return res.data;
}

export async function getMe() {
  const res = await api.get('/auth/me');
  return res.data;
}

export async function getMetricsSystem() {
  const res = await api.get('/metrics/system/current');
  return res.data;
}

export async function getMetricsOperations() {
  const res = await api.get('/metrics/operations');
  return res.data;
}

export async function getMetricsSummary() {
  const res = await api.get('/metrics/summary');
  return res.data;
}

export default api;
