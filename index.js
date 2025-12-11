const express = require('express');
const session = require('express-session');
const path = require('path');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt');
const db = require('./db');

dotenv.config();

const app = express();
const PORT = 8000;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'pcos-lifestyle-secret',
    resave: false,
    saveUninitialized: false,
  })
);

// Make currentUser available in all templates
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

// Home / dashboard
app.get('/', async (req, res) => {
  try {
    if (!req.session.user) {
      return res.render('index', { logs: [] });
    }

    const [rows] = await db.query(
      'SELECT * FROM daily_logs WHERE user_id = ? ORDER BY log_date DESC LIMIT 7',
      [req.session.user.user_id]
    );

    res.render('index', { logs: rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading home page');
  }
});

// About page
app.get('/about', (req, res) => {
  res.render('about');
});

// Register
app.get('/register', (req, res) => {
  res.render('register', { error: null });
});

app.post('/register', async (req, res) => {
  const { username, display_name, password } = req.body;

  if (!username || !display_name || !password) {
    return res.render('register', { error: 'All fields are required.' });
  }

  // Basic password validation: at least 8 chars, lower, upper, digit, special
  const pwdOk =
    password.length >= 8 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password);

  if (!pwdOk) {
    return res.render('register', {
      error:
        'Password must be at least 8 characters and include lowercase, uppercase, a number and a special character.',
    });
  }

  try {
    const [existing] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
    if (existing.length > 0) {
      return res.render('register', { error: 'Username already taken.' });
    }

    const hash = await bcrypt.hash(password, 12);

    const [result] = await db.query(
      'INSERT INTO users (username, password_hash, display_name, created_at) VALUES (?, ?, ?, NOW())',
      [username, hash, display_name]
    );

    req.session.user = {
      user_id: result.insertId,
      username,
      display_name,
    };

    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(500).render('register', { error: 'Error creating user.' });
  }
});

// Login
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.render('login', { error: 'Please enter username and password.' });
  }

  try {
    const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
    if (rows.length === 0) {
      return res.render('login', { error: 'Invalid credentials.' });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.render('login', { error: 'Invalid credentials.' });
    }

    req.session.user = {
      user_id: user.user_id,
      username: user.username,
      display_name: user.display_name,
    };

    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(500).render('login', { error: 'Error logging in.' });
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// Daily PCOS check-in
app.get('/daily-check-in', requireLogin, (req, res) => {
  res.render('daily_check_in', { error: null, success: null });
});

app.post('/daily-check-in', requireLogin, async (req, res) => {
  const {
    log_date,
    sleep_hours,
    movement_minutes,
    mood_score,
    energy_score,
    craving_level,
    cycle_day,
    notes,
  } = req.body;

  if (!log_date) {
    return res.render('daily_check_in', { error: 'Date is required.', success: null });
  }

  try {
    // Upsert by user + date
    const [existing] = await db.query(
      'SELECT log_id FROM daily_logs WHERE user_id = ? AND log_date = ?',
      [req.session.user.user_id, log_date]
    );

    if (existing.length > 0) {
      await db.query(
        `UPDATE daily_logs
         SET sleep_hours = ?, movement_minutes = ?, mood_score = ?, energy_score = ?,
             craving_level = ?, cycle_day = ?, notes = ?
         WHERE log_id = ?`,
        [
          sleep_hours || null,
          movement_minutes || null,
          mood_score || null,
          energy_score || null,
          craving_level || null,
          cycle_day || null,
          notes || null,
          existing[0].log_id,
        ]
      );
    } else {
      await db.query(
        `INSERT INTO daily_logs
         (user_id, log_date, sleep_hours, movement_minutes, mood_score, energy_score,
          craving_level, cycle_day, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.session.user.user_id,
          log_date,
          sleep_hours || null,
          movement_minutes || null,
          mood_score || null,
          energy_score || null,
          craving_level || null,
          cycle_day || null,
          notes || null,
        ]
      );
    }

    res.render('daily_check_in', { error: null, success: 'Check-in saved.' });
  } catch (err) {
    console.error(err);
    res.status(500).render('daily_check_in', { error: 'Error saving check-in.', success: null });
  }
});

// Recipes + search (DB search)
app.get('/recipes', async (req, res) => {
  const search = (req.query.q || '').trim();

  try {
    let rows;
    if (search) {
      const like = '%' + search + '%';
      [rows] = await db.query(
        `SELECT * FROM recipes
         WHERE title LIKE ? OR summary LIKE ? OR main_tag LIKE ?
         ORDER BY title`,
        [like, like, like]
      );
    } else {
      [rows] = await db.query('SELECT * FROM recipes ORDER BY title');
    }

    res.render('recipes', { recipes: rows, search });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading recipes');
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`PCOS Lifestyle Coach running on http://localhost:${PORT}`);
});
