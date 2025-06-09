const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_this_secret';
const CONFIG_PATH = path.join(__dirname, 'config.json');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

function requireLogin(req, res, next) {
  if (req.session.loggedIn) {
    return next();
  }
  res.redirect('/login');
}

app.get('/login', (req, res) => {
  const form = `<!DOCTYPE html>
  <html><body>
    <h1>Admin Login</h1>
    <form method="post" action="/login">
      <input type="text" name="username" placeholder="Username" required><br>
      <input type="password" name="password" placeholder="Password" required><br>
      <button type="submit">Login</button>
    </form>
    ${req.query.error ? '<p style="color:red">Invalid credentials</p>' : ''}
  </body></html>`;
  res.send(form);
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.loggedIn = true;
    return res.redirect('/admin');
  }
  res.redirect('/login?error=1');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.get('/admin', requireLogin, (req, res) => {
  let config = {};
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    config = JSON.parse(raw);
  } catch (err) {
    config = { error: 'Failed to read config: ' + err.message };
  }
  const form = `<!DOCTYPE html>
  <html><body>
    <h1>Config Editor</h1>
    <form method="post" action="/admin">
      <textarea name="config" rows="20" cols="60">${JSON.stringify(config, null, 2)}</textarea><br>
      <button type="submit">Save</button>
    </form>
    <p><a href="/logout">Logout</a></p>
  </body></html>`;
  res.send(form);
});

app.post('/admin', requireLogin, (req, res) => {
  try {
    const newCfg = JSON.parse(req.body.config);
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(newCfg, null, 2));
    res.redirect('/admin');
  } catch (err) {
    res.status(400).send('Invalid JSON: ' + err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Admin panel running at http://localhost:${PORT}`);
});
