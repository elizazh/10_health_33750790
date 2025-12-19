// index.js
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const path = require("path");
const bcrypt = require("bcrypt");
const db = require("./db");

const app = express();
const PORT = 8000;
const BASE_PATH = "/usr/417";

// view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// middleware
app.use(express.urlencoded({ extended: true }));

// sessions
app.use(
  session({
    secret: process.env.SESSION_SECRET || "coursework-secret",
    resave: false,
    saveUninitialized: false,
  })
);

// router
const router = express.Router();

// basePath/currentUser available in ALL views
router.use((req, res, next) => {
  res.locals.basePath = req.baseUrl || "";
  res.locals.currentUser = req.session.user || null;
  next();
});

// HOME
router.get("/", async (req, res) => {
  if (!req.session.user) return res.render("index", { logs: [] });

  try {
    const [logs] = await db.query(
      "SELECT * FROM daily_logs WHERE user_id = ? ORDER BY log_date DESC LIMIT 7",
      [req.session.user.user_id]
    );
    return res.render("index", { logs });
  } catch (err) {
    console.error(err);
    return res.status(500).send("Database error");
  }
});

// ABOUT
router.get("/about", (req, res) => res.render("about"));

// REGISTER
router.get("/register", (req, res) => res.render("register", { error: null }));

router.post("/register", async (req, res) => {
  const { username, display_name, password } = req.body;
  if (!username || !display_name || !password) {
    return res.render("register", { error: "All fields required." });
  }

  try {
    const [existing] = await db.query("SELECT * FROM users WHERE username = ?", [username]);
    if (existing.length) return res.render("register", { error: "Username already taken." });

    const hash = await bcrypt.hash(password, 12);
    const [result] = await db.query(
      "INSERT INTO users (username, password_hash, display_name, created_at) VALUES (?, ?, ?, NOW())",
      [username, hash, display_name]
    );

    req.session.user = { user_id: result.insertId, username, display_name };
    return res.redirect(req.baseUrl || "/");
  } catch (err) {
    console.error(err);
    return res.render("register", { error: "Registration failed." });
  }
});

// LOGIN
router.get("/login", (req, res) => res.render("login", { error: null }));

router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const [users] = await db.query("SELECT * FROM users WHERE username = ?", [username]);
    if (!users.length) return res.render("login", { error: "Invalid credentials." });

    const user = users[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.render("login", { error: "Invalid credentials." });

    req.session.user = {
      user_id: user.user_id,
      username: user.username,
      display_name: user.display_name,
    };

    return res.redirect(req.baseUrl || "/");
  } catch (err) {
    console.error(err);
    return res.render("login", { error: "Login failed." });
  }
});

// LOGOUT
router.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect(req.baseUrl || "/"));
});

// DAILY CHECK-IN
router.get("/daily-check-in", (req, res) => {
  if (!req.session.user) return res.redirect((req.baseUrl || "") + "/login");
  return res.render("daily-check-in", { error: null, success: null });
});

router.post("/daily-check-in", async (req, res) => {
  if (!req.session.user) return res.redirect((req.baseUrl || "") + "/login");

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

  try {
    await db.query(
      `INSERT INTO daily_logs
       (user_id, log_date, sleep_hours, movement_minutes, mood_score, energy_score, craving_level, cycle_day, notes)
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

    return res.render("daily-check-in", { error: null, success: "Saved ✅" });
  } catch (err) {
    console.error(err);
    return res.render("daily-check-in", { error: "Could not save log.", success: null });
  }
});

// RECIPES (SEARCH)
router.get("/recipes", async (req, res) => {
  const search = req.query.q || "";

  try {
    let recipes;
    if (search) { 
      const like = `%${search}%`;
      [recipes] = await db.query(
        "SELECT * FROM recipes WHERE title LIKE ? OR summary LIKE ? OR main_tag LIKE ?",
        [like, like, like]
      );
    } else {
      [recipes] = await db.query("SELECT * FROM recipes");
    }

    return res.render("recipes", { recipes, search });
  } catch (err) {
    console.error(err);
    return res.status(500).send("Recipe error");
  }
});

// static assets both ways
app.use(express.static(path.join(__dirname, "public")));
app.use(BASE_PATH, express.static(path.join(__dirname, "public")));

// mount router both ways
app.use("/", router);
app.use(BASE_PATH, router);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Listening on http://0.0.0.0:${PORT}/ and ${BASE_PATH}/`);
});
