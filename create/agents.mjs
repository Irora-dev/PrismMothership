// Agent detection for the Mothership kit — which AI coding agent (if any) is
// driving this setup/update, detected from the environment markers each CLI
// exports. Used to tailor the wizard's handover text and to verify the right
// entry file exists for that agent. Detection is best-effort and additive:
// unknown agents fall through to "generic" and everything still works.

export const AGENTS = [
  { id: "claude", name: "Claude Code", entry: "CLAUDE.md", env: ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"] },
  { id: "codex", name: "OpenAI Codex", entry: "AGENTS.md", env: ["CODEX_SANDBOX", "OPENAI_CODEX", "CODEX_PROXY_CERT"] },
  { id: "cursor", name: "Cursor", entry: "AGENTS.md", env: ["CURSOR_TRACE_ID", "CURSOR_AGENT"] },
  { id: "trae", name: "Trae", entry: ".trae/rules/project_rules.md", env: ["TRAE_AI", "TRAE_AGENT"] },
  { id: "kimi", name: "Kimi CLI", entry: "AGENTS.md", env: ["KIMI_CLI", "KIMI_AGENT"] },
  { id: "gemini", name: "Gemini CLI", entry: "GEMINI.md", env: ["GEMINI_CLI", "GEMINI_CODE_ASSIST"] },
  { id: "windsurf", name: "Windsurf", entry: ".windsurfrules", env: ["WINDSURF_AGENT", "CASCADE_SESSION"] },
  { id: "copilot", name: "GitHub Copilot", entry: ".github/copilot-instructions.md", env: ["COPILOT_AGENT", "GITHUB_COPILOT_CLI"] },
];

/** Best-effort: which agent is running me? null = a human terminal / unknown agent. */
export function detectAgent(env = process.env) {
  for (const a of AGENTS) if (a.env.some((k) => env[k])) return a;
  return null;
}

/** One-line banner for wizard output. */
export function agentBanner(env = process.env) {
  const a = detectAgent(env);
  return a
    ? `🤖 Detected ${a.name} — entry file for future sessions: ${a.entry}`
    : "👤 No AI agent detected — running for a human (that works too).";
}
