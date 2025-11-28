# Atomic Agents

> The open source alternative to Amazon Bedrock AgentCore
> 
> 90% cheaper • Deploy anywhere • No vendor lock-in

[⭐ Star this repo] [🐛 Report Bug] [💡 Request Feature]

---

## 🎯 Why Atomic Agents?

Amazon just launched Bedrock AgentCore. It's great, but:
- ❌ Expensive (standard LLM costs + AWS markup)
- ❌ AWS lock-in (can't deploy elsewhere)
- ❌ Closed source (can't see or modify code)

Atomic Agents solves all three:
- ✅ **90% cheaper** via TDLN compression
- ✅ **Deploy anywhere** (AWS, GCP, Azure, self-hosted)
- ✅ **Open source** (MIT license)

Plus features Bedrock doesn't have:
- 🔒 **Structural governance** (policy gates)
- 📜 **Cryptographic audit trail** (immutable ledger)
- 📊 **Complete dashboard** (included, no extra setup)
- 💰 **Explicit cost modes** (mechanic vs genius)

---

## 🚀 Quick Start

### Option 1: Docker (Easiest)
```bash
docker pull danvoulez/atomic-agents
docker run -p 3000:3000 danvoulez/atomic-agents
```

### Option 2: From Source
```bash
git clone https://github.com/danvoulez/Atomic-Agents.git
cd Atomic-Agents
npm install
npm run dev
```

Open http://localhost:3000

---

## 💡 Core Concepts

### TDLN (Translation-Deterministic Language Network)
Compresses natural language → structured format → 90% token savings

**Example:**
