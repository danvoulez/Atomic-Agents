/**
 * Mock LLM Server
 * 
 * Provides deterministic responses for testing the AI Coding Team.
 * Supports both OpenAI and Anthropic API formats.
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 8000;
const SCENARIOS_PATH = process.env.SCENARIOS_PATH || './scenarios';

// Load scenario responses
const scenarios = new Map();

function loadScenarios() {
  const scenariosDir = path.resolve(SCENARIOS_PATH);
  if (!fs.existsSync(scenariosDir)) {
    console.warn(`Scenarios directory not found: ${scenariosDir}`);
    return;
  }

  const files = fs.readdirSync(scenariosDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
  
  for (const file of files) {
    const content = fs.readFileSync(path.join(scenariosDir, file), 'utf-8');
    const scenario = yaml.load(content);
    if (scenario.name) {
      scenarios.set(scenario.name, scenario);
      console.log(`Loaded scenario: ${scenario.name}`);
    }
  }
  
  console.log(`Loaded ${scenarios.size} scenarios`);
}

// Request counter for deterministic responses
let requestCounter = 0;

// Default responses for different scenarios
const defaultResponses = {
  bug_fix: {
    steps: [
      {
        thought: "I need to understand the bug first. Let me read the relevant file.",
        tool_calls: [{ name: "read_file", arguments: { path: "src/utils.ts" } }]
      },
      {
        thought: "I can see the bug. The function uses + instead of *. Let me apply a patch.",
        tool_calls: [{ name: "apply_patch", arguments: { patch: "--- a/src/utils.ts\n+++ b/src/utils.ts\n@@ -1,3 +1,3 @@\n-  return x + y;\n+  return x * y;", description: "Fix multiplication bug" } }]
      },
      {
        thought: "Now I need to run the tests to verify the fix.",
        tool_calls: [{ name: "run_tests", arguments: { scope: "all" } }]
      },
      {
        thought: "Tests passed. Let me commit the changes.",
        tool_calls: [{ name: "commit_changes", arguments: { message: "fix: correct multiplication operation in utils" } }]
      },
      {
        thought: "The bug has been fixed successfully.",
        content: "Done! I fixed the multiplication bug in src/utils.ts. The function was using + instead of *. Tests are now passing."
      }
    ]
  },
  feature_add: {
    steps: [
      {
        thought: "I need to understand the codebase first.",
        tool_calls: [{ name: "list_files", arguments: { path: "src" } }]
      },
      {
        thought: "Let me read the main file to understand the structure.",
        tool_calls: [{ name: "read_file", arguments: { path: "src/index.ts" } }]
      },
      {
        thought: "I'll create the new feature.",
        tool_calls: [{ name: "apply_patch", arguments: { patch: "...", description: "Add new feature" } }]
      },
      {
        thought: "Run tests to verify.",
        tool_calls: [{ name: "run_tests", arguments: { scope: "all" } }]
      },
      {
        thought: "Feature complete.",
        content: "Done! Added the new feature."
      }
    ]
  },
  unclear: {
    steps: [
      {
        thought: "The request is unclear. I need to ask for clarification.",
        tool_calls: [{ name: "request_human_review", arguments: { reason: "Request is ambiguous", context: "I cannot determine the exact intent" } }]
      }
    ]
  },
  escalate: {
    steps: [
      {
        thought: "This task exceeds my limits. Escalating to human.",
        tool_calls: [{ name: "request_human_review", arguments: { reason: "Task complexity exceeds mechanic mode limits" } }]
      }
    ]
  }
};

// Generate response based on scenario
function generateResponse(messages, tools, scenario) {
  const systemMessage = messages.find(m => m.role === 'system')?.content || '';
  const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || '';
  
  // Determine scenario type from messages
  let scenarioType = 'bug_fix';
  if (lastUserMessage.toLowerCase().includes('unclear') || lastUserMessage.toLowerCase().includes('ambiguous')) {
    scenarioType = 'unclear';
  } else if (lastUserMessage.toLowerCase().includes('feature') || lastUserMessage.toLowerCase().includes('add')) {
    scenarioType = 'feature_add';
  } else if (lastUserMessage.toLowerCase().includes('exceeds') || lastUserMessage.toLowerCase().includes('too large')) {
    scenarioType = 'escalate';
  }
  
  // Check for loaded scenario override
  if (scenario && scenarios.has(scenario)) {
    const loadedScenario = scenarios.get(scenario);
    if (loadedScenario.responses) {
      const stepIndex = requestCounter % loadedScenario.responses.length;
      return loadedScenario.responses[stepIndex];
    }
  }
  
  // Use default responses
  const steps = defaultResponses[scenarioType]?.steps || defaultResponses.bug_fix.steps;
  const stepIndex = requestCounter % steps.length;
  const step = steps[stepIndex];
  
  requestCounter++;
  
  return step;
}

// OpenAI-compatible chat completions endpoint
app.post('/v1/chat/completions', (req, res) => {
  const { model, messages, tools, max_tokens, temperature } = req.body;
  const scenario = req.headers['x-mock-scenario'];
  
  console.log(`[OpenAI] Request #${requestCounter} - model: ${model}, messages: ${messages.length}`);
  
  const response = generateResponse(messages, tools, scenario);
  
  // Build OpenAI-format response
  const result = {
    id: `chatcmpl-mock-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model || 'gpt-4o-mini-mock',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: response.content || null,
        tool_calls: response.tool_calls?.map((tc, i) => ({
          id: `call_mock_${Date.now()}_${i}`,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments)
          }
        }))
      },
      finish_reason: response.tool_calls ? 'tool_calls' : 'stop'
    }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150
    }
  };
  
  res.json(result);
});

// Anthropic-compatible messages endpoint
app.post('/v1/messages', (req, res) => {
  const { model, messages, tools, max_tokens } = req.body;
  const scenario = req.headers['x-mock-scenario'];
  
  console.log(`[Anthropic] Request #${requestCounter} - model: ${model}, messages: ${messages.length}`);
  
  const response = generateResponse(messages, tools, scenario);
  
  // Build Anthropic-format response
  const content = [];
  
  if (response.thought) {
    content.push({
      type: 'text',
      text: response.thought
    });
  }
  
  if (response.tool_calls) {
    for (const tc of response.tool_calls) {
      content.push({
        type: 'tool_use',
        id: `toolu_mock_${Date.now()}`,
        name: tc.name,
        input: tc.arguments
      });
    }
  }
  
  if (response.content && !response.tool_calls) {
    content.push({
      type: 'text',
      text: response.content
    });
  }
  
  const result = {
    id: `msg_mock_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content,
    model: model || 'claude-3-haiku-mock',
    stop_reason: response.tool_calls ? 'tool_use' : 'end_turn',
    usage: {
      input_tokens: 100,
      output_tokens: 50
    }
  };
  
  res.json(result);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    scenarios: scenarios.size,
    requests: requestCounter 
  });
});

// Reset counter (useful for deterministic testing)
app.post('/reset', (req, res) => {
  requestCounter = 0;
  res.json({ status: 'reset', counter: requestCounter });
});

// Set scenario for next request
app.post('/scenario/:name', (req, res) => {
  const { name } = req.params;
  if (scenarios.has(name)) {
    res.json({ status: 'ok', scenario: name });
  } else {
    res.status(404).json({ error: `Scenario not found: ${name}` });
  }
});

// List available scenarios
app.get('/scenarios', (req, res) => {
  res.json({
    scenarios: Array.from(scenarios.keys()),
    defaults: Object.keys(defaultResponses)
  });
});

// Initialize and start
loadScenarios();

app.listen(PORT, () => {
  console.log(`Mock LLM server running on port ${PORT}`);
  console.log(`Scenarios path: ${path.resolve(SCENARIOS_PATH)}`);
});

