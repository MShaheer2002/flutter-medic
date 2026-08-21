import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Placeholder entry point — proves the toolchain (npm workspaces, tsc, MCP SDK) wires up.
// No tools registered yet: tool routing, session state, and evidence engine land in Phase 1+.
const server = new McpServer({ name: "flutter-medic", version: "0.0.1" });

console.log(`${server.constructor.name} constructed — toolchain OK.`);
