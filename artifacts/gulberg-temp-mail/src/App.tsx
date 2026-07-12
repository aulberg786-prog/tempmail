import { useCallback, useEffect, useRef, useState } from 'react';

const MAILTM = 'https://api.mail.tm';

interface Message {
  id: string;
  from?: { address?: string } | string;
  subject?: string;
  createdAt?: string;
  date?: string;
}

interface OpenMail {
  subject: string;
  from: string;
  date: string;
  body: string | null;
  loading: boolean;
  error: boolean;
}

type StatusType = 'idle' | 'generating' | 'ok' | 'error';

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeHtml(html: string) {
  const forbidden =
    /<(script|iframe|object|embed|form|input|button|link|meta)[^>]*>[\s\S]*?<\/\1>|<(script|iframe|object|embed|form|input|button|link|meta)[^>]*\/?>/gi;
  const onEvents = /\s+on\w+="[^"]*"/gi;
  const jsProto = /href\s*=\s*["']?\s*javascript:/gi;
  return html.replace(forbidden, '').replace(onEvents, '').replace(jsProto, 'href="about:blank"');
}

function formatDate(dateStr?: string) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return String(dateStr);
  }
}

function getInitial(from = '') {
  const clean = String(from).replace(/<.*?>/, '').trim();
  return (clean[0] || '?').toUpperCase();
}

function hashColor(str = '') {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 28%)`;
}

function fromAddress(from: Message['from']): string {
  if (!from) return '?';
  return typeof from === 'string' ? from : from.address || '?';
}

async function tmFetch(path: string, token: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers as Record<string, string> || {}) };
  if (token && !headers['Authorization']) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${MAILTM}${path}`, { ...opts, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`mail.tm ${path} -> ${res.status}: ${body}`);
  }
  return res.json();
}

function Toast({ message, type }: { message: string; type: 'info' | 'error' | 'success' }) {
  const colors = { info: '#6366f1', error: '#ef4444', success: '#4ade80' };
  return (
    <div
      className="fixed bottom-6 right-6 z-[9999] max-w-xs rounded-xl px-4.5 py-3 text-sm font-medium shadow-2xl animate-slide-up"
      style={{
        background: 'rgba(15,12,41,0.95)',
        border: `1px solid ${colors[type]}`,
        color: '#e2e8f0',
        backdropFilter: 'blur(12px)',
      }}
    >
      {message}
    </div>
  );
}

export default function App() {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<StatusType>('idle');
  const [countdown, setCountdown] = useState(10);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [openMail, setOpenMail] = useState<OpenMail | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'info' | 'error' | 'success' } | null>(null);

  const tokenRef = useRef(token);
  tokenRef.current = token;

  const showToast = useCallback((message: string, type: 'info' | 'error' | 'success' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const checkEmails = useCallback(async (manual = false) => {
    const currentToken = tokenRef.current;
    if (!currentToken) return;
    setIsRefreshing((prev) => {
      if (prev) return prev;
      return true;
    });
    try {
      const data = await tmFetch('/messages?page=1', currentToken);
      setMessages(data['hydra:member'] || []);
      if (manual) setCountdown(10);
    } catch (err) {
      console.error('Failed to fetch messages:', err);
      if (manual) showToast('Failed to refresh. Check your connection.', 'error');
    } finally {
      setIsRefreshing(false);
    }
  }, [showToast]);

  // Account creation goes through our Express server (/api/tempmail/generate)
  // to avoid browser-side CORS/rate-limits when hitting mail.tm directly.
  // The server returns { email, token }; message polling then goes straight
  // to mail.tm from the browser using that token.
  const generateNewEmail = useCallback(async () => {
    let attempt = 0;

    const tryGenerate = async (): Promise<void> => {
      setStatus('generating');
      if (attempt === 0) {
        setEmail('');
        setToken('');
        setMessages([]);
      }

      try {
        const res = await fetch('/api/tempmail/generate', { method: 'POST' });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Server error ${res.status}`);
        }
        const { email: address, token: newToken } = await res.json();

        setEmail(address);
        setToken(newToken);
        setCountdown(10);
        setStatus('ok');
      } catch (err) {
        attempt++;
        const delay = Math.min(20000, 3000 * attempt);
        console.warn(`Generate attempt ${attempt} failed (${(err as Error).message}). Retrying in ${delay}ms`);
        setStatus('error');
        setTimeout(tryGenerate, delay);
      }
    };

    await tryGenerate();
  }, []);

  useEffect(() => {
    generateNewEmail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch inbox as soon as we have a token
  useEffect(() => {
    if (token) checkEmails(false);
  }, [token, checkEmails]);

  // Auto-refresh + countdown ticking
  useEffect(() => {
    if (!token) return;
    const refreshInterval = setInterval(() => {
      checkEmails(false);
      setCountdown(10);
    }, 10000);
    const countdownInterval = setInterval(() => {
      setCountdown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => {
      clearInterval(refreshInterval);
      clearInterval(countdownInterval);
    };
  }, [token, checkEmails]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMail(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const copyEmail = useCallback(async () => {
    if (!email) return;
    const doShow = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    try {
      await navigator.clipboard.writeText(email);
      doShow();
    } catch {
      const ta = document.createElement('textarea');
      ta.value = email;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        doShow();
      } catch {
        // ignore
      }
      document.body.removeChild(ta);
    }
  }, [email]);

  const readEmail = useCallback(async (id: string) => {
    setOpenMail({ subject: 'Loading...', from: '', date: '', body: null, loading: true, error: false });
    try {
      const msg = await tmFetch(`/messages/${id}`, tokenRef.current);
      const from = fromAddress(msg.from);
      const body = msg.html?.[0]
        ? sanitizeHtml(msg.html[0])
        : msg.text
          ? `<pre style="white-space:pre-wrap;word-break:break-word;font-family:inherit">${escapeHtml(msg.text)}</pre>`
          : '<em style="color:#94a3b8">No content</em>';
      setOpenMail({
        subject: msg.subject || '(no subject)',
        from,
        date: msg.createdAt || '',
        body,
        loading: false,
        error: false,
      });
    } catch (err) {
      console.error('Failed to read message:', err);
      setOpenMail({ subject: '', from: '', date: '', body: null, loading: false, error: true });
    }
  }, []);

  const statusColors: Record<StatusType, string> = {
    idle: 'bg-slate-500',
    generating: 'bg-yellow-400',
    ok: 'bg-green-400',
    error: 'bg-red-400',
  };
  const statusLabels: Record<StatusType, string> = {
    idle: 'Idle',
    generating: 'Generating…',
    ok: 'Live',
    error: 'Error',
  };

  const pct = countdown / 10;
  const ringOffset = 100 - pct * 100;

  return (
    <div className="tm-body relative overflow-x-hidden">
      <div className="bg-orb bg-orb-1"></div>
      <div className="bg-orb bg-orb-2"></div>
      <div className="bg-orb bg-orb-3"></div>

      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Header */}
        <header className="glass sticky top-0 z-50 border-b border-white/10">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl btn-primary flex items-center justify-center text-xl shadow-lg">
                📧
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-white leading-tight tracking-tight">
                  Gulberg AI Temp Mail
                </h1>
                <p className="text-xs text-indigo-300/70 hidden sm:block">Instant · Private · Disposable</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="flex items-center gap-1.5 glass-inner rounded-lg px-2.5 py-1.5"
                title="Auto-refresh countdown"
              >
                <svg width="20" height="20" viewBox="0 0 36 36" className="flex-shrink-0">
                  <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(99,102,241,0.2)" strokeWidth="3" />
                  <circle
                    className="countdown-ring"
                    cx="18"
                    cy="18"
                    r="16"
                    fill="none"
                    stroke="#6366f1"
                    strokeWidth="3"
                    strokeLinecap="round"
                    style={{ strokeDashoffset: ringOffset }}
                  />
                </svg>
                <span className="text-xs font-mono text-indigo-300 w-5 text-right">{countdown}</span>
              </div>
              <div className="hidden sm:block w-px h-6 bg-white/10"></div>
              <span className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400">
                <span className={`w-2 h-2 rounded-full inline-block ${statusColors[status]}`}></span>
                <span>{statusLabels[status]}</span>
              </span>
            </div>
          </div>
        </header>

        {/* Ad banner top */}
        <div className="max-w-4xl mx-auto w-full px-4 pt-4">
          <div className="ad-placeholder h-16 sm:h-20">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            <span>Advertisement · 728×90</span>
          </div>
        </div>

        {/* Main content */}
        <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-6 space-y-5 animate-fade-in">
          {/* Email generator card */}
          <div className="glass rounded-2xl p-5 sm:p-7 space-y-5">
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse-slow shadow-[0_0_8px_#4ade80]"></div>
              <span className="text-sm font-semibold text-green-300">Active Temporary Address</span>
            </div>

            <div className="glass-dark rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="email-display select-all">
                  {email || (
                    <span className="dot-flashing">
                      <span></span>
                      <span></span>
                      <span></span>
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0 w-full sm:w-auto">
                <div className="relative flex-1 sm:flex-none">
                  <button
                    onClick={copyEmail}
                    className="btn-primary w-full sm:w-auto text-white text-sm font-semibold px-4 py-2.5 rounded-lg flex items-center justify-center gap-2"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy
                  </button>
                  <div className={`copy-tooltip ${copied ? 'show' : ''}`}>✓ Copied!</div>
                </div>
                <button
                  onClick={generateNewEmail}
                  title="Generate new address"
                  className="btn-secondary text-white text-sm font-semibold px-3 py-2.5 rounded-lg flex items-center gap-1.5"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span className="hidden sm:inline">New</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                No signup required
              </span>
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Auto-refreshes every 10 seconds
              </span>
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Powered by mail.tm
              </span>
            </div>
          </div>

          {/* Inbox card */}
          <div className="glass rounded-2xl overflow-hidden">
            <div className="px-5 sm:px-7 py-4 border-b border-white/10 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
                <h2 className="text-base font-semibold text-white">Inbox</h2>
                <span className="tm-badge bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  {messages.length}
                </span>
              </div>
              <button
                onClick={() => checkEmails(true)}
                disabled={isRefreshing}
                className="btn-secondary text-white text-sm font-medium px-3.5 py-2 rounded-lg flex items-center gap-2 disabled:opacity-60"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            </div>

            <div className="divide-y divide-white/5 min-h-[200px]">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                  <div className="w-16 h-16 rounded-2xl glass-inner flex items-center justify-center text-3xl">📭</div>
                  <p className="text-slate-400 font-medium">No messages yet...</p>
                  <p className="text-slate-500 text-sm max-w-xs">
                    Emails sent to your address will appear here automatically.
                  </p>
                </div>
              ) : (
                messages.map((msg) => {
                  const from = fromAddress(msg.from);
                  const subject = msg.subject || '(no subject)';
                  const date = msg.createdAt || msg.date || '';
                  return (
                    <div
                      key={msg.id}
                      className="inbox-row unread px-5 sm:px-7 py-4 flex items-start gap-4"
                      role="button"
                      tabIndex={0}
                      onClick={() => readEmail(msg.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') readEmail(msg.id);
                      }}
                    >
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0 mt-0.5"
                        style={{ background: hashColor(from) }}
                      >
                        {getInitial(from)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold text-white text-sm truncate">{from}</span>
                          <span className="text-xs text-slate-500 flex-shrink-0 whitespace-nowrap">
                            {formatDate(date)}
                          </span>
                        </div>
                        <p className="text-sm text-slate-300 font-medium truncate mt-0.5">{subject}</p>
                      </div>
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-slate-600 flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </main>

        {/* Ad banner bottom */}
        <div className="max-w-4xl mx-auto w-full px-4 pb-4">
          <div className="ad-placeholder h-16 sm:h-20">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            <span>Advertisement · 728×90</span>
          </div>
        </div>

        {/* Footer */}
        <footer className="glass border-t border-white/10 mt-auto">
          <div className="max-w-4xl mx-auto px-4 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-slate-500">
            <div className="flex items-center gap-2">
              <span>📧</span>
              <span className="font-semibold text-slate-400">Gulberg AI Temp Mail</span>
              <span>· Free &amp; Private Disposable Email</span>
            </div>
            <div className="flex items-center gap-4">
              <span>
                Powered by{' '}
                <a href="https://mail.tm" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 transition-colors">
                  mail.tm
                </a>
              </span>
              <span>&copy; {new Date().getFullYear()}</span>
            </div>
          </div>
        </footer>
      </div>

      {/* Email read modal */}
      {openMail && (
        <div
          className="tm-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpenMail(null);
          }}
        >
          <div className="glass tm-modal-panel rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10 flex items-start gap-3">
              <button
                onClick={() => setOpenMail(null)}
                className="btn-secondary text-white text-sm font-medium px-3 py-2 rounded-lg flex items-center gap-1.5 flex-shrink-0 mt-0.5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span className="hidden sm:inline">Back</span>
              </button>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-white text-base leading-snug truncate">{openMail.subject}</h3>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-slate-400">
                  <span>
                    From: <span className="text-slate-300">{openMail.from}</span>
                  </span>
                  <span className="text-slate-500">{formatDate(openMail.date)}</span>
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <div className="email-body-container">
                {openMail.error ? (
                  <p className="text-red-400 text-center py-8">⚠ Failed to load email. Please try again.</p>
                ) : openMail.loading || openMail.body === null ? (
                  <div className="flex items-center justify-center py-8 gap-2 text-slate-400">
                    <div className="dot-flashing">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                    <span>Loading email...</span>
                  </div>
                ) : (
                  <div dangerouslySetInnerHTML={{ __html: openMail.body }} />
                )}
              </div>
            </div>
            <div className="px-5 py-3 border-t border-white/10 flex justify-end">
              <button
                onClick={() => setOpenMail(null)}
                className="btn-danger text-white text-sm font-medium px-4 py-2 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}
