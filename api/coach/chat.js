// Adapt Coach — Mistral proxy
// Receives a chat request from the browser, injects system prompt + tool definitions,
// streams Mistral's response straight back. The browser executes any tool calls
// against its local planState and sends a follow-up request with the tool result.
//
// Edge runtime so we get streaming SSE without buffering.

export const config = {
  runtime: 'edge',
};

const MISTRAL_URL = 'https://api.mistral.ai/v1/chat/completions';
const DEFAULT_MODEL = 'mistral-small-latest';
const TOOL_MODEL = 'mistral-large-latest';
const MAX_OUTPUT_TOKENS = 800;

// Per-IP rate limit: simple in-memory map. Resets on cold start.
// For prototype scale this is plenty; replace with a KV-backed counter when public.
const _rate = new Map(); // key: ip|date, value: count
const DAILY_CAP = 50;

function rateLimitOk(ip) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `${ip}|${day}`;
  const n = _rate.get(key) || 0;
  if (n >= DAILY_CAP) return false;
  _rate.set(key, n + 1);
  return true;
}

export default async function handler(req) {
  // Only POST
  if (req.method !== 'POST') {
    return jsonError(405, 'Method not allowed');
  }
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    return jsonError(500, 'Server misconfigured: MISTRAL_API_KEY env var missing.');
  }

  // Parse body
  let body;
  try {
    body = await req.json();
  } catch (e) {
    return jsonError(400, 'Invalid JSON body');
  }
  const { messages, context, model, temperature } = body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError(400, '`messages` array is required');
  }

  // Rate limit
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anon';
  if (!rateLimitOk(ip)) {
    return jsonError(429, `Daily limit reached (${DAILY_CAP} messages). Resets at midnight UTC.`);
  }

  // Build the message list with our system prompt + context
  const systemPrompt = buildSystemPrompt(context);
  const fullMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.filter(m => m.role !== 'system'),
  ];

  // Default to Small for chat. Switch to Large when the AI has invoked a tool
  // (the next round-trip benefits from better reasoning to interpret the tool result).
  const lastMsg = messages[messages.length - 1];
  const isToolFollowup = lastMsg && lastMsg.role === 'tool';
  const chosenModel = model || (isToolFollowup ? TOOL_MODEL : DEFAULT_MODEL);

  // Forward to Mistral
  const upstream = await fetch(MISTRAL_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: chosenModel,
      messages: fullMessages,
      tools: TOOL_DEFINITIONS,
      tool_choice: 'auto',
      stream: true,
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: typeof temperature === 'number' ? temperature : 0.4,
    }),
  });

  if (!upstream.ok) {
    let errBody = '';
    try { errBody = await upstream.text(); } catch (e) {}
    return jsonError(upstream.status, `Mistral ${upstream.status}: ${errBody.slice(0, 250)}`);
  }

  // Pipe the SSE stream back to the client unchanged.
  // The browser parses the chunks, accumulates content + tool_calls, and re-renders.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Adapt-Model': chosenModel,
    },
  });
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── System prompt ─────────────────────────────────────────────────────
// Keep it tight. The model is small — long prompts dilute focus.
// Specific rules at the top, persona second, examples last.
function buildSystemPrompt(context) {
  const ctx = context && typeof context === 'object' ? context : {};
  const ctxJson = safeJsonStringify(ctx, 6000); // cap the context payload

  return `You are Adapt's AI coach for endurance athletes (running, cycling, triathlon).

CORE RULES — follow always:
1. Speak like a thoughtful coach, not a chatbot. Direct, concise, warm.
2. Use REAL numbers from the user's data when relevant. Don't invent numbers.
3. When the user asks you to change the plan ("move Wed to Thu", "I'm sick", etc.), CALL THE APPROPRIATE TOOL. Don't just describe what you'd do — execute it.
4. Default to Zone 2 / aerobic-base advice unless context clearly calls for intensity.
5. Cite research only when it adds clarity, in plain language, max one citation per response.
6. If you're uncertain, say so. Don't bluff.
7. Length: 1-3 sentences for simple Q&A. Longer only if the user asked for depth or you're explaining a tool action you took.
8. Never recommend training through pain. If the user mentions injury, suggest flagInjury and cross-training alternatives.
9. Never give medical diagnosis. For pain or unusual symptoms, say "talk to a healthcare professional."

PERSONA: Direct, caring, evidence-based. Think experienced coach, not Alexa. Use second person ("you"). Avoid "I'd recommend" filler — just say what to do.

USER'S CURRENT STATE (live from app):
${ctxJson}

When you call a tool, the app applies the change and returns a result. Then continue with a brief confirmation of what changed and why.`;
}

function safeJsonStringify(obj, maxChars) {
  try {
    const s = JSON.stringify(obj, null, 0);
    if (s.length <= maxChars) return s;
    // Truncate gracefully if too large
    return s.slice(0, maxChars) + '... [context truncated]';
  } catch (e) {
    return '{}';
  }
}

// ─── Tool definitions ──────────────────────────────────────────────────
// These MUST match the tool names the browser knows how to execute.
// (See the executeTool function in adapt-prototype.html.)
const DAYS_ENUM = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'moveSession',
      description: 'Move a scheduled training session from one day of this week to another. The session on the destination day swaps back to the origin day.',
      parameters: {
        type: 'object',
        properties: {
          fromDay: { type: 'string', enum: DAYS_ENUM, description: 'Day to move session FROM' },
          toDay: { type: 'string', enum: DAYS_ENUM, description: 'Day to move session TO' },
          reason: { type: 'string', description: 'Brief reason for the move (one sentence)' },
        },
        required: ['fromDay', 'toDay'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'shortenSession',
      description: 'Reduce a planned session\'s duration on a given day. Use when the user has limited time or wants an easier day.',
      parameters: {
        type: 'object',
        properties: {
          day: { type: 'string', enum: DAYS_ENUM },
          newMinutes: { type: 'number', description: 'New duration in minutes' },
          newName: { type: 'string', description: 'Optional updated session name' },
          newMeta: { type: 'string', description: 'Optional updated session description' },
          reason: { type: 'string' },
        },
        required: ['day', 'newMinutes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'swapDiscipline',
      description: 'Change the discipline (run/bike/swim/strength/etc.) of a session for a given day. Use when the user can\'t do the originally-prescribed discipline.',
      parameters: {
        type: 'object',
        properties: {
          day: { type: 'string', enum: DAYS_ENUM },
          newType: { type: 'string', enum: ['run', 'bike', 'swim', 'strength', 'brick', 'mobility', 'rest', 'quality'] },
          newName: { type: 'string' },
          newMeta: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['day', 'newType'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flagInjury',
      description: 'Flag a body area as injured/sore. The plan will adapt to protect it.',
      parameters: {
        type: 'object',
        properties: {
          area: { type: 'string', description: 'Body part (e.g. "knee", "calf", "lower back")' },
          severity: { type: 'string', enum: ['low', 'moderate', 'high'] },
          notes: { type: 'string' },
        },
        required: ['area', 'severity'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'addRestWeek',
      description: 'Insert a recovery week into the training arc, typically after 3-4 build weeks.',
      parameters: {
        type: 'object',
        properties: {
          afterWeekIndex: { type: 'number', description: 'Insert rest week after which existing week index (0-based)' },
          reason: { type: 'string' },
        },
        required: ['afterWeekIndex'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'adjustVolume',
      description: 'Scale weekly volume up or down across one or more weeks of the plan arc.',
      parameters: {
        type: 'object',
        properties: {
          fromWeekIndex: { type: 'number' },
          toWeekIndex: { type: 'number' },
          percentChange: { type: 'number', description: 'e.g. -15 to cut 15%, +10 to add 10%' },
          reason: { type: 'string' },
        },
        required: ['fromWeekIndex', 'toWeekIndex', 'percentChange'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'completeSession',
      description: 'Mark a session as completed (with optional RPE).',
      parameters: {
        type: 'object',
        properties: {
          day: { type: 'string', enum: DAYS_ENUM },
          rpe: { type: 'number', description: '1-10 perceived effort' },
          notes: { type: 'string' },
        },
        required: ['day'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'skipSession',
      description: 'Mark a session as skipped (deliberate rest, illness, etc.).',
      parameters: {
        type: 'object',
        properties: {
          day: { type: 'string', enum: DAYS_ENUM },
          reason: { type: 'string' },
        },
        required: ['day'],
      },
    },
  },
];
