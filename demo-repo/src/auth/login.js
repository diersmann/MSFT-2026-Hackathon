const SESSION_TTL_MINUTES = 30;

const sessions = new Map();

export function createSession(userId) {
  const token = `${userId}-${Date.now()}`;
  sessions.set(token, { userId, createdAt: Date.now() });
  return token;
}

export function resolveSession(token) {
  const session = sessions.get(token);
  if (!session) return null;
  const ageMinutes = (Date.now() - session.createdAt) / 60000;
  if (ageMinutes > SESSION_TTL_MINUTES) {
    sessions.delete(token);
    return null;
  }
  return session;
}

export function login(username, password) {
  if (!username || !password) return { ok: false, error: 'missing credentials' };
  return { ok: true, token: createSession(username) };
}
