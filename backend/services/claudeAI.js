/**
 * Claude AI Service
 * Used for competitor discovery via Claude Sonnet 4.6
 */

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

async function callClaude(prompt, options = {}) {
  const { maxTokens = 8000, model = 'claude-sonnet-4-6' } = options;

  if (!CLAUDE_API_KEY) {
    throw new Error('CLAUDE_API_KEY not configured');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Claude API error: ${data.error?.message || JSON.stringify(data)}`);
  }

  const text = data.content?.[0]?.text || '';
  console.log(`🤖 Claude (${data.model}) — ${data.usage?.input_tokens} in / ${data.usage?.output_tokens} out tokens`);
  return text;
}

function parseClaudeJSON(text) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  return JSON.parse(text);
}

module.exports = { callClaude, parseClaudeJSON };
