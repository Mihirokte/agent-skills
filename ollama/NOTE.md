# Ollama

- **Install location:** `C:\Users\rentk\AppData\Local\Programs\Ollama\` (present on this machine).
- **User data:** `C:\Users\rentk\.ollama` exists. A shallow directory listing returned no visible files from the inventory script (the folder may be empty, reparse-point, or permission-filtered).

Ollama is a **local LLM runtime**; it is not an MCP server by default. Apps (Cursor, Continue, custom scripts) may call it via HTTP on the default port when the daemon runs.

No `Modelfile` or model manifest was copied into `agent-skills`. To inventory models, run `ollama list` while the service is up and paste or snapshot the output separately.
