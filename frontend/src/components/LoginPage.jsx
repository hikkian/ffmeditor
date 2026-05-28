import { useState, useCallback } from 'react';
import { login, setStoredToken } from '../api';

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!username || !password) { setError('Enter username and password'); return; }
    setLoading(true);
    setError('');
    try {
      const data = await login(username, password);
      setStoredToken(data.token);
      onLogin(data.token);
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  }, [username, password, onLogin]);

  return (
    <div
      className="h-screen w-screen flex items-center justify-center"
      style={{ background: 'var(--color-bg-primary)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-8"
        style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
      >
        {/* Logo */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #f59e0b, #fb923c)', boxShadow: '0 4px 16px rgba(245,158,11,0.35)' }}
          >
            <svg className="w-6 h-6 text-black" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <div className="text-center">
            <h1 className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>
              FFM<span style={{ color: 'var(--color-accent)' }}>Editor</span>
            </h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>Sign in to continue</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              autoComplete="username"
              className="input-field"
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className="input-field"
              disabled={loading}
            />
          </div>

          {error && (
            <p className="text-xs py-2 px-3 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl text-sm font-bold transition-all mt-2"
            style={
              loading
                ? { background: 'rgba(245,158,11,0.12)', color: '#f59e0b', cursor: 'wait' }
                : {
                    background: 'linear-gradient(135deg, #f59e0b, #fb923c)',
                    color: '#000',
                    boxShadow: '0 4px 14px rgba(245,158,11,0.35)',
                    cursor: 'pointer',
                  }
            }
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Signing in…
              </span>
            ) : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
