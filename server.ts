import express from 'express';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import * as readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const rootPath = path.dirname(path.dirname(__filename));
const EVENTS_FILE = path.join(process.cwd(), 'events.jsonl');

// Fail fast if an old-format todo.json exists to avoid silent data loss.
if (fs.existsSync(path.join(process.cwd(), 'todo.json'))) {
  console.error(
    'ERROR: Found todo.json in legacy format.\n' +
    'Remove or rename it before starting the server.\n' +
    'The new format uses events.jsonl.'
  );
  process.exit(1);
}

// Load all events from events.jsonl (create empty file if absent).
async function loadEvents(): Promise<object[]> {
  if (!fs.existsSync(EVENTS_FILE)) {
    fs.writeFileSync(EVENTS_FILE, '');
    return [];
  }
  const events: object[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(EVENTS_FILE),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      console.error(`Malformed line in events.jsonl: ${trimmed}`);
      process.exit(1);
    }
  }
  return events;
}

// Validate that a value looks like a TodoEvent.
function isValidEvent(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const ev = e as Record<string, unknown>;
  return (
    typeof ev['eid'] === 'string' &&
    typeof ev['type'] === 'string' &&
    typeof ev['at'] === 'number' &&
    typeof ev['device_id'] === 'string' &&
    typeof ev['task_id'] === 'string' &&
    (ev['parent_eid'] === null || typeof ev['parent_eid'] === 'string')
  );
}

const app = express();
const server = http.createServer(app);

app.use(express.json({ limit: '4mb' }));

// Static files
app.get('/', (_req, res) => res.sendFile(rootPath + '/index.html'));
app.get('/index.css', (_req, res) => res.sendFile(rootPath + '/index.css'));
app.get('/client.js', (_req, res) => res.sendFile(rootPath + '/client.js'));
app.get('/engine.js', (_req, res) => res.sendFile(rootPath + '/generated/src/engine.js'));
app.get('/humanize-duration.js', (_req, res) => {
  res.sendFile(rootPath + '/node_modules/humanize-duration/humanize-duration.js');
});

// GET /api/events — return all stored events
app.get('/api/events', async (_req, res) => {
  try {
    const events = await loadEvents();
    res.json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to read events' });
  }
});

// POST /api/events — append new events (client sends only events server doesn't have)
app.post('/api/events', async (req, res) => {
  const incoming = req.body;
  if (!Array.isArray(incoming)) {
    res.status(400).json({ error: 'Body must be an array of events' });
    return;
  }
  for (const e of incoming) {
    if (!isValidEvent(e)) {
      res.status(400).json({ error: 'Invalid event structure', event: e });
      return;
    }
  }

  // Dedup against existing events before appending.
  const existing = await loadEvents();
  const knownEids = new Set((existing as Array<{ eid: string }>).map(e => e.eid));
  const newEvents = (incoming as Array<{ eid: string }>).filter(e => !knownEids.has(e.eid));

  if (newEvents.length > 0) {
    const lines = newEvents.map(e => JSON.stringify(e)).join('\n') + '\n';
    fs.appendFileSync(EVENTS_FILE, lines);
  }

  res.json({ accepted: newEvents.length });
});

const PORT = parseInt(process.env['PORT'] ?? '3000', 10);
server.listen(PORT, () => {
  console.log(`todolium server listening on port ${PORT}`);
});
