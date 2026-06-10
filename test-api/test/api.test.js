const request = require('supertest');
const app = require('../src/index');
const BetterSqlite3 = require('better-sqlite3');

let todosDB;

// Create a temporary SQLite database for testing
beforeAll(() => {
  todosDB = new BetterSqlite3(':memory:');
  todosDB.prepare('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL)').run();
  todosDB.prepare('CREATE TABLE todos (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, title TEXT, completed BOOLEAN)').run();
});

beforeEach(() => {
  todosDB.prepare('DELETE FROM users').run();
  todosDB.prepare('DELETE FROM todos').run();
});

afterAll(() => {
  todosDB.close();
});

describe('API endpoints', () => {
  test('POST /api/register - success', async () => {
    const response = await request(app)
      .post('/api/register')
      .send({
        username: 'testuser',
        password: 'password123'
      });
    expect(response.status).toBe(201);
    expect(response.body.message).toBe('User registered successfully');
  });

  test('POST /api/register - duplicate username', async () => {
    await request(app)
      .post('/api/register')
      .send({
        username: 'testuser',
        password: 'password123'
      });
    const response = await request(app)
      .post('/api/register')
      .send({
        username: 'testuser',
        password: 'password456'
      });
    expect(response.status).toBe(400);
    expect(response.body[0]).toContain('username must be unique');
  });

  test('POST /api/login - success', async () => {
    await request(app)
      .post('/api/register')
      .send({
        username: 'testuser',
        password: 'password123'
      });
    const response = await request(app)
      .post('/api/login')
      .send({
        username: 'testuser',
        password: 'password123'
      });
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('token');
  });

  test('POST /api/login - wrong password', async () => {
    await request(app)
      .post('/api/register')
      .send({
        username: 'testuser',
        password: 'password123'
      });
    const response = await request(app)
      .post('/api/login')
      .send({
        username: 'testuser',
        password: 'wrong_password'
      });
    expect(response.status).toBe(401);
  });

  test('GET /api/todos - requires auth', async () => {
    const response = await request(app)
      .get('/api/todos');
    expect(response.status).toBe(401);
  });

  test('POST /api/todos - create and retrieve', async () => {
    await request(app)
      .post('/api/register')
      .send({
        username: 'testuser',
        password: 'password123'
      });
    const loginResponse = await request(app)
      .post('/api/login')
      .send({
        username: 'testuser',
        password: 'password123'
      });

    const token = loginResponse.body.token;

    // Create a todo
    const createResponse = await request(app)
      .post('/api/todos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Test Todo',
        completed: false
      });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.message).toBe('Todo created successfully');

    // Retrieve todos
    const retrieveResponse = await request(app)
      .get('/api/todos')
      .set('Authorization', `Bearer ${token}`);
    expect(retrieveResponse.status).toBe(200);
    expect(retrieveResponse.body.length).toBe(1);
    expect(retrieveResponse.body[0].title).toBe('Test Todo');
  });
});