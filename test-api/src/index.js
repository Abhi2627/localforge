const express    = require('express')
const cors       = require('cors')
const bcrypt     = require('bcryptjs')
const jwt        = require('jsonwebtoken')
const Database   = require('better-sqlite3')
const { z }      = require('zod')

const app = express()
app.use(cors())
app.use(express.json())

// ── Database setup ────────────────────────────────────────────────────────────
const db = new Database('./todos.db')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT    UNIQUE NOT NULL,
    password TEXT    NOT NULL
  );
  CREATE TABLE IF NOT EXISTS todos (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL,
    title     TEXT    NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`)

const JWT_SECRET = process.env.JWT_SECRET || 'localforge-dev-secret'

// ── Validation schemas ────────────────────────────────────────────────────────
const AuthSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
})

const TodoSchema = z.object({
  title:     z.string().min(1),
  completed: z.boolean().optional().default(false),
})

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' })
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}

// ── Auth routes ───────────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const result = AuthSchema.safeParse(req.body)
  if (!result.success) return res.status(400).json({ errors: result.error.issues })
  const { username, password } = result.data
  try {
    const hash = await bcrypt.hash(password, 10)
    db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hash)
    res.status(201).json({ message: 'User registered successfully' })
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Username taken' })
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/login', async (req, res) => {
  const result = AuthSchema.safeParse(req.body)
  if (!result.success) return res.status(400).json({ errors: result.error.issues })
  const { username, password } = result.data
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }
  const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' })
  res.json({ token })
})

// ── Todos routes ──────────────────────────────────────────────────────────────
app.get('/api/todos', requireAuth, (req, res) => {
  const todos = db.prepare('SELECT * FROM todos WHERE user_id = ?').all(req.user.userId)
  res.json(todos)
})

app.post('/api/todos', requireAuth, (req, res) => {
  const result = TodoSchema.safeParse(req.body)
  if (!result.success) return res.status(400).json({ errors: result.error.issues })
  const { title, completed } = result.data
  const info = db.prepare('INSERT INTO todos (user_id, title, completed) VALUES (?, ?, ?)').run(req.user.userId, title, completed ? 1 : 0)
  res.status(201).json({ id: info.lastInsertRowid, title, completed })
})

app.put('/api/todos/:id', requireAuth, (req, res) => {
  const result = TodoSchema.safeParse(req.body)
  if (!result.success) return res.status(400).json({ errors: result.error.issues })
  const { title, completed } = result.data
  const info = db.prepare('UPDATE todos SET title = ?, completed = ? WHERE id = ? AND user_id = ?').run(title, completed ? 1 : 0, req.params.id, req.user.userId)
  if (info.changes === 0) return res.status(404).json({ error: 'Todo not found' })
  res.json({ message: 'Updated' })
})

app.delete('/api/todos/:id', requireAuth, (req, res) => {
  const info = db.prepare('DELETE FROM todos WHERE id = ? AND user_id = ?').run(req.params.id, req.user.userId)
  if (info.changes === 0) return res.status(404).json({ error: 'Todo not found' })
  res.status(204).send()
})

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: err.message })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Todos API running on http://localhost:${PORT}`))
