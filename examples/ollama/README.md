# Ollama + Vector Search Example

This example demonstrates how to use libSQL vector search with a local database and Ollama.

## Install Dependencies

```bash
npm i
```

## Install Ollama

[Download Ollama](https://ollama.com/download) and install it.

## Running

Make sure Ollama is running with the model `mistral`:

```bash
ollama run mistral
```

Execute the example:

```bash
node index.mjs
```

This will setup a local SQLite database, generate embeddings using Ollama, and insert the data with embeddings, and then query the results using the vector similarity search function.
