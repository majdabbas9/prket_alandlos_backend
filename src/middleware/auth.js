const logger = require('../utils/logger').getLogger(__filename);

const ADMIN_BACKEND_URL = process.env.ADMIN_BACKEND_URL || 'http://localhost:5001';

async function authMiddleware(req, res, next) {
  // Bypass validation in unit tests only: JEST_WORKER_ID is set by Jest itself, so a deployment
  // that is misconfigured with NODE_ENV=test still checks tokens
  if (process.env.NODE_ENV === 'test' && process.env.JEST_WORKER_ID !== undefined) {
    req.user = { username: 'test-admin', role: 'admin' };
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Auth validation failed: Authorization token is missing or malformed');
    return res.status(401).json({
      success: false,
      error: 'Authorization token is missing or malformed',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const response = await fetch(`${ADMIN_BACKEND_URL}/auth/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ token }),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      logger.warn({ error: result.message }, 'Auth validation failed: Invalid token');
      return res.status(401).json({
        success: false,
        error: result.message || 'Invalid authorization token',
      });
    }

    // Every write route is admin-only; a valid token for any other role is not enough
    if (!result.data || result.data.role !== 'admin') {
      logger.warn({ user: result.data && result.data.username }, 'Auth failed: not an admin');
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    // Attach decoded user info to request
    req.user = result.data;
    next();
  } catch (error) {
    logger.error({ error: error.message }, 'Error calling validation API');
    return res.status(500).json({
      success: false,
      error: 'Internal server error validating token',
    });
  }
}

module.exports = authMiddleware;
