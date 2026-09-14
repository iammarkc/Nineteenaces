const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { URL } = require('url');

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const DEFAULT_ACCOUNTS = {
  admin: {
    username: 'admin',
    name: 'System Administrator',
    email: 'admin@system.com',
    password: 'Admin123!',
    role: 'Developer',
    permissions: ['dashboard', 'analytics', 'reports', 'inventory', 'attendance', 'attendanceReport', 'settings'],
    office: '',
    inventoryAccess: ['Rizal', 'Cebu'],
    disabled: false
  },
  testuser: {
    username: 'testuser',
    name: 'Test User',
    email: 'testuser@system.com',
    password: 'Test123!',
    role: 'User',
    permissions: ['dashboard'],
    office: 'Rizal',
    inventoryAccess: ['Rizal'],
    disabled: false
  },
  demo: {
    username: 'demo',
    name: 'Demo User',
    email: 'demo@system.com',
    password: 'Demo123!',
    role: 'User',
    permissions: ['dashboard'],
    office: 'Cebu',
    inventoryAccess: ['Cebu'],
    disabled: false
  }
};

async function ensureAccountsFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(ACCOUNTS_FILE);
  } catch (error) {
    await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(DEFAULT_ACCOUNTS, null, 2), 'utf8');
  }
}

async function loadAccounts() {
  await ensureAccountsFile();
  const content = await fs.readFile(ACCOUNTS_FILE, 'utf8');
  return JSON.parse(content || '{}');
}

async function saveAccounts(accounts) {
  await ensureAccountsFile();
  await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf8');
}

function sanitizeAccount(account) {
  return {
    username: account.username,
    name: account.name,
    email: account.email,
    role: account.role,
    permissions: Array.isArray(account.permissions) ? account.permissions : [],
    office: account.office || '',
    inventoryAccess: Array.isArray(account.inventoryAccess) ? account.inventoryAccess : [],
    disabled: Boolean(account.disabled)
  };
}

function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendJson(response, statusCode, payload) {
  setCorsHeaders(response);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(payload));
}

async function handleApiLogin(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, message: 'Method not allowed.' });
    return;
  }

  let body = '';
  request.on('data', chunk => {
    body += chunk;
  });

  request.on('end', async () => {
    try {
      const payload = body ? JSON.parse(body) : {};
      const usernameOrEmail = String(payload.usernameOrEmail || '').trim();
      const password = String(payload.password || '');

      if (!usernameOrEmail || !password) {
        sendJson(response, 400, { ok: false, message: 'Username and password are required.' });
        return;
      }

      const accounts = await loadAccounts();
      const normalizedInput = usernameOrEmail.toLowerCase();
      const matchedKey = Object.keys(accounts).find((key) => {
        const account = accounts[key];
        return account && (
          account.username.toLowerCase() === normalizedInput ||
          account.email.toLowerCase() === normalizedInput
        );
      });

      if (!matchedKey) {
        sendJson(response, 401, { ok: false, message: 'Invalid credentials.' });
        return;
      }

      const account = accounts[matchedKey];

      if (account.disabled) {
        sendJson(response, 403, { ok: false, message: 'This account has been disabled.' });
        return;
      }

      if (account.password !== password) {
        sendJson(response, 401, { ok: false, message: 'Invalid credentials.' });
        return;
      }

      const safeAccounts = {};
      Object.keys(accounts).forEach((key) => {
        safeAccounts[key] = sanitizeAccount(accounts[key]);
      });

      sendJson(response, 200, {
        ok: true,
        account: sanitizeAccount(account),
        accounts: safeAccounts
      });
    } catch (error) {
      console.error('Login error:', error);
      sendJson(response, 500, { ok: false, message: 'Server error while processing login.' });
    }
  });
}

async function handleApiAccounts(request, response) {
  if (request.method !== 'GET') {
    sendJson(response, 405, { ok: false, message: 'Method not allowed.' });
    return;
  }

  try {
    const accounts = await loadAccounts();
    const safeAccounts = {};
    Object.keys(accounts).forEach((key) => {
      safeAccounts[key] = sanitizeAccount(accounts[key]);
    });

    sendJson(response, 200, { ok: true, accounts: safeAccounts });
  } catch (error) {
    console.error('Accounts fetch error:', error);
    sendJson(response, 500, { ok: false, message: 'Unable to load accounts.' });
  }
}

async function serveStaticFile(response, filePath) {
  try {
    const resolvedPath = path.resolve(ROOT_DIR, filePath);
    const normalizedPath = resolvedPath.startsWith(ROOT_DIR) ? resolvedPath : path.join(ROOT_DIR, 'index.html');
    const fileContent = await fs.readFile(normalizedPath);
    const ext = path.extname(normalizedPath).toLowerCase();
    setCorsHeaders(response);
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream'
    });
    response.end(fileContent);
  } catch (error) {
    setCorsHeaders(response);
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

async function main() {
  await ensureAccountsFile();

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const pathname = requestUrl.pathname;

    if (request.method === 'OPTIONS') {
      setCorsHeaders(response);
      response.writeHead(204);
      response.end();
      return;
    }

    if (pathname === '/api/login') {
      await handleApiLogin(request, response);
      return;
    }

    if (pathname === '/api/accounts') {
      await handleApiAccounts(request, response);
      return;
    }

    let filePath = pathname === '/' ? '/index.html' : pathname;
    if (filePath.startsWith('/')) {
      filePath = filePath.slice(1);
    }

    await serveStaticFile(response, filePath);
  });

  server.listen(PORT, HOST, () => {
    console.log(`Shared backend login server is running on http://localhost:${PORT}`);
  });
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
