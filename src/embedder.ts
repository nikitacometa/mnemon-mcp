/**
 * Embedding provider abstraction for optional vector search.
 *
 * BYOK (Bring Your Own Key) — user configures provider via env vars:
 *   MNEMON_EMBEDDING_PROVIDER   — "openai" | "ollama" (default: unset = disabled)
 *   MNEMON_EMBEDDING_API_KEY    — API key (required for OpenAI)
 *   MNEMON_EMBEDDING_MODEL      — model name (defaults per provider)
 *   MNEMON_EMBEDDING_DIMENSIONS — vector dimensions (default: 1024)
 *   MNEMON_OLLAMA_URL           — Ollama API URL (default: http://localhost:11434)
 */

export interface Embedder {
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  readonly dimensions: number;
  readonly provider: string;
  readonly model: string;
}

class OpenAIEmbedder implements Embedder {
  readonly provider = "openai";
  readonly dimensions: number;
  private readonly apiKey: string;
  readonly model: string;
  private readonly baseUrl: string;

  constructor() {
    const key = process.env["MNEMON_EMBEDDING_API_KEY"] ?? process.env["OPENAI_API_KEY"];
    if (!key) {
      throw new Error(
        "MNEMON_EMBEDDING_API_KEY or OPENAI_API_KEY required for OpenAI embeddings"
      );
    }
    this.apiKey = key;
    this.model = process.env["MNEMON_EMBEDDING_MODEL"] ?? "text-embedding-3-small";
    this.dimensions = parseInt(process.env["MNEMON_EMBEDDING_DIMENSIONS"] ?? "1024", 10);
    this.baseUrl = process.env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1";
  }

  async embed(text: string): Promise<Float32Array> {
    const [result] = await this.embedBatch([text]);
    return result!;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: this.dimensions,
        encoding_format: "float",
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI embeddings API error ${response.status}: ${body}`);
    }

    const json = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index to maintain input order
    const sorted = json.data.sort((a, b) => a.index - b.index);
    return sorted.map((d) => new Float32Array(d.embedding));
  }
}

class OllamaEmbedder implements Embedder {
  readonly provider = "ollama";
  readonly dimensions: number;
  readonly model: string;
  private readonly baseUrl: string;

  constructor() {
    this.model = process.env["MNEMON_EMBEDDING_MODEL"] ?? "nomic-embed-text";
    this.dimensions = parseInt(process.env["MNEMON_EMBEDDING_DIMENSIONS"] ?? "768", 10);
    this.baseUrl = process.env["MNEMON_OLLAMA_URL"] ?? "http://localhost:11434";
  }

  async embed(text: string): Promise<Float32Array> {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: text }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama embeddings error ${response.status}: ${body}`);
    }

    const json = (await response.json()) as { embeddings: number[][] };
    return new Float32Array(json.embeddings[0]!);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama embeddings error ${response.status}: ${body}`);
    }

    const json = (await response.json()) as { embeddings: number[][] };
    return json.embeddings.map((e) => new Float32Array(e));
  }
}

/**
 * Create an embedder based on env vars. Returns null if no provider configured.
 * Non-fatal — logs warning and returns null on configuration errors.
 */
export function createEmbedder(): Embedder | null {
  const provider = process.env["MNEMON_EMBEDDING_PROVIDER"];
  if (!provider || provider === "none") return null;

  switch (provider) {
    case "openai":
      return new OpenAIEmbedder();
    case "ollama":
      return new OllamaEmbedder();
    default:
      throw new Error(
        `Unknown MNEMON_EMBEDDING_PROVIDER: "${provider}". Supported: openai, ollama`
      );
  }
}
